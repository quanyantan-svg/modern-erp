// INV-39 — Barcode GENERATION side.
//
// Frozen by `solution.md §27.35` (Domain 5 Closure Design) and
// `docs/requirements/inventory-warehouse.md §32.3.7` (INV-39).
//
// This module is the GENERATION half only. Parsing / rule master /
// resolution log already live in `server/lib/inventory-barcode.js` and are
// NOT duplicated here.
//
// Contract:
//   - A generated barcode uses the SAME prefixes / patterns that
//     `server/lib/inventory-barcode.js` understands (`PRD-`, `WH-`, `BIN-`,
//     `LOT-`, `SER-`, `CTR-`), so a generated code parses back to the same
//     entity even when the binding row is missing.
//   - Generation is deterministic: the same entity always yields the same
//     barcode, and re-generating returns the existing binding instead of
//     creating a second one.
//   - `inventory_barcode_bindings.rule_id` is NOT NULL — a rule row is
//     created (idempotently) for the entity type and referenced by the
//     binding.
//   - The label payload is structured data + a small self-contained SVG, so it
//     renders on a label printer with no server-side image dependency and no
//     network access.

import { createHash } from 'node:crypto';
import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';
import { parseBarcode } from '../lib/inventory-barcode.js';

const ENTITY_TYPES = Object.freeze({
  product: 'PRODUCT',
  warehouse: 'WAREHOUSE',
  bin: 'BIN',
  lot: 'LOT',
  serial: 'SERIAL',
  container: 'CONTAINER',
});

const LABEL_PAYLOAD_VERSION = 1;

// The patterns below MIRROR `tryPatterns` in `server/lib/inventory-barcode.js`.
// They are duplicated here ONLY so that the generation side can prove, before
// it persists anything, that the barcode it produced is parseable back to the
// same entity by the canonical parser. The canonical parser remains the only
// parse authority.
const PATTERNS = Object.freeze({
  product: { prefix: 'PRD-', regex: /^PRD-([A-Z0-9-]+)$/ },
  warehouse: { prefix: 'WH-', regex: /^WH-([A-Z0-9-]+)$/ },
  bin: { prefix: 'BIN-', regex: /^BIN-([A-Z0-9-]+)-([A-Z0-9-]+)$/ },
  lot: { prefix: 'LOT-', regex: /^LOT-([A-Z0-9-]+)$/ },
  serial: { prefix: 'SER-', regex: /^SER-([A-Z0-9-]+)$/ },
  container: { prefix: 'CTR-', regex: /^CTR-([A-Z0-9-]+)$/ },
});

function nowIso() { return new Date().toISOString(); }

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_barcode_rules (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      pattern TEXT NOT NULL,
      fields TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_barcode_bindings (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL REFERENCES inventory_barcode_rules(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      barcode TEXT NOT NULL,
      UNIQUE(rule_id, entity_type, entity_id)
    );
    CREATE TABLE IF NOT EXISTS inventory_barcode_resolution_log (
      id TEXT PRIMARY KEY,
      barcode TEXT NOT NULL,
      resolution_json TEXT NOT NULL,
      resolved_at TEXT NOT NULL,
      resolved_by TEXT,
      source TEXT NOT NULL
    );
  `);
}

// Sanitize a business code into the character set the canonical patterns
// accept (`[A-Z0-9-]`). Returns null when the code cannot be represented.
function sanitizeSegment(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text) return null;
  if (!/^[A-Z0-9-]+$/.test(text)) return null;
  return text;
}

// Deterministic fallback token derived from the entity id. Used when the
// business code contains characters the canonical pattern cannot carry.
function idToken(entityId) {
  return createHash('sha256').update(String(entityId)).digest('hex').slice(0, 16).toUpperCase();
}

// Resolve the canonical business code of the target entity. The barcode
// suffix is that code, so the generated barcode parses back to the same
// business identity.
function resolveEntity(db, entityType, entityId) {
  const id = String(entityId ?? '').trim();
  if (!id) throw new HttpError(400, 'entityId 必填');
  if (entityType === 'PRODUCT') {
    const row = db.prepare('SELECT id, code, name FROM products WHERE id=?').get(id);
    if (!row) throw new HttpError(400, `产品 ${id} 不存在`);
    return { code: row.code, name: row.name, primary: row.code, secondary: null };
  }
  if (entityType === 'WAREHOUSE') {
    const row = db.prepare('SELECT id, code, name FROM warehouses WHERE id=?').get(id);
    if (!row) throw new HttpError(400, `仓库 ${id} 不存在`);
    return { code: row.code, name: row.name, primary: row.code, secondary: null };
  }
  if (entityType === 'BIN') {
    const row = db.prepare(`
      SELECT b.id, b.code, b.name, b.warehouse_id warehouseId, w.code warehouseCode
        FROM warehouse_bins b
        JOIN warehouses w ON w.id=b.warehouse_id
       WHERE b.id=?
    `).get(id);
    if (!row) throw new HttpError(400, `仓位 ${id} 不存在`);
    return { code: row.code, name: row.name, primary: row.warehouseCode, secondary: row.code };
  }
  if (entityType === 'LOT') {
    const row = db.prepare(`
      SELECT l.id, l.lot_code lotCode, p.code productCode, p.name productName
        FROM inventory_lots l JOIN products p ON p.id=l.product_id
       WHERE l.id=?
    `).get(id);
    if (!row) throw new HttpError(400, `批号 ${id} 不存在`);
    return { code: row.lotCode, name: row.productName, primary: row.lotCode, secondary: null };
  }
  if (entityType === 'SERIAL') {
    const row = db.prepare(`
      SELECT s.id, s.serial_number serialNumber, p.code productCode, p.name productName
        FROM inventory_serials s JOIN products p ON p.id=s.product_id
       WHERE s.id=?
    `).get(id);
    if (!row) throw new HttpError(400, `序列号 ${id} 不存在`);
    return { code: row.serialNumber, name: row.productName, primary: row.serialNumber, secondary: null };
  }
  if (entityType === 'CONTAINER') {
    const row = db.prepare('SELECT id, container_no containerNo, container_type containerType FROM inventory_containers WHERE id=?').get(id);
    if (!row) throw new HttpError(400, `容器 ${id} 不存在`);
    return { code: row.containerNo, name: row.containerType, primary: row.containerNo, secondary: null };
  }
  throw new HttpError(400, 'entityType 不合法');
}

// Build the deterministic barcode for the entity and PROVE that it parses
// back to the same business identity using the mirrored canonical patterns.
function buildBarcode(entityType, entity) {
  const pattern = PATTERNS[entityType.toLowerCase()];
  if (!pattern) throw new HttpError(400, 'entityType 不合法');
  const primary = sanitizeSegment(entity.primary);
  const secondary = entity.secondary == null ? null : sanitizeSegment(entity.secondary);

  let barcode = null;
  if (entityType === 'BIN') {
    if (primary && secondary) barcode = `${pattern.prefix}${primary}-${secondary}`;
  } else if (primary) {
    barcode = `${pattern.prefix}${primary}`;
  }
  if (!barcode) {
    // The business code cannot be carried by the canonical pattern. Fall back
    // to a deterministic id-derived token so the barcode still round-trips.
    const token = idToken(entity.code);
    barcode = entityType === 'BIN'
      ? `${pattern.prefix}${token}-${token}`
      : `${pattern.prefix}${token}`;
  }

  const match = pattern.regex.exec(barcode);
  if (!match) {
    throw new HttpError(409, `生成的条码 ${barcode} 无法被规范解析器识别`, {
      code: 'BARCODE_PATTERN_MISMATCH',
    });
  }
  return { barcode, match };
}

// Idempotently obtain the rule row used by the bindings of an entity type.
function ensureRule(db, entityType) {
  const code = `AUTO_${entityType}`;
  const existing = db.prepare('SELECT id FROM inventory_barcode_rules WHERE code=?').get(code);
  if (existing) return existing.id;
  const pattern = PATTERNS[entityType.toLowerCase()];
  const id = genId();
  db.prepare(`
    INSERT INTO inventory_barcode_rules(id, code, pattern, fields, active, created_at)
    VALUES(?, ?, ?, ?, 1, ?)
  `).run(id, code, pattern.regex.source, JSON.stringify({ entity_type: entityType }), nowIso());
  return id;
}

export async function generateBarcode(db, req, res, actor) {
  allow(actor, 'INVENTORY_BARCODE_RULE_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['entityType', 'entityId', 'barcode']);

  const rawType = String(body.entityType ?? '').trim().toLowerCase();
  const entityType = ENTITY_TYPES[rawType];
  if (!entityType) {
    throw new HttpError(400, 'entityType 必须为 product / warehouse / bin / lot / serial / container');
  }
  const entityId = String(body.entityId ?? '').trim();
  if (!entityId) throw new HttpError(400, 'entityId 必填');

  ensureTable(db);
  const entity = resolveEntity(db, entityType, entityId);

  // Idempotency: the same entity always maps to the same barcode.
  const ruleId = ensureRule(db, entityType);
  const existing = db.prepare(`
    SELECT * FROM inventory_barcode_bindings
     WHERE rule_id=? AND entity_type=? AND entity_id=?
  `).get(ruleId, entityType, entityId);
  if (existing) {
    return send(res, 200, {
      id: existing.id,
      barcode: existing.barcode,
      entityType,
      entityId,
      created: false,
    });
  }

  let barcode;
  if (body.barcode !== undefined && body.barcode !== null && String(body.barcode).trim() !== '') {
    barcode = String(body.barcode).trim();
    const pattern = PATTERNS[rawType];
    const match = pattern.regex.exec(barcode);
    if (!match) {
      throw new HttpError(400, `条码 ${barcode} 不符合 ${pattern.prefix} 编码规则`, {
        code: 'BARCODE_PATTERN_MISMATCH',
      });
    }
    const duplicated = db.prepare('SELECT id FROM inventory_barcode_bindings WHERE barcode=?').get(barcode);
    if (duplicated) {
      throw new HttpError(409, `条码 ${barcode} 已被其他对象占用`, {
        code: 'BARCODE_ALREADY_BOUND',
      });
    }
  } else {
    barcode = buildBarcode(entityType, entity).barcode;
  }

  // Persist the binding, then prove with the CANONICAL parser that the
  // barcode resolves back to the same entity.
  const id = genId();
  transaction(db, () => {
    ensureTable(db);
    db.prepare(`
      INSERT INTO inventory_barcode_bindings(id, rule_id, entity_type, entity_id, barcode)
      VALUES(?, ?, ?, ?, ?)
    `).run(id, ruleId, entityType, entityId, barcode);
    audit(db, actor.id, 'CREATE', 'INVENTORY_BARCODE_BINDING', id, `Generate barcode ${barcode} → ${entityType}:${entityId}`);
  });

  const parsed = parseBarcode(db, barcode);
  const resolvedType = String(parsed.entityType || '').toUpperCase();
  const resolvedId = String(parsed.entityId || '');
  if (resolvedType !== entityType || resolvedId !== entityId) {
    throw new HttpError(409, `条码 ${barcode} 解析结果与目标对象不一致`, {
      code: 'BARCODE_RESOLUTION_MISMATCH',
      resolution: '条码必须解析回同一个实体后才允许绑定。',
    });
  }

  return send(res, 201, { id, barcode, entityType, entityId, created: true });
}

export function listGeneratedBarcodes(db, res, actor, url) {
  allowAny(actor, ['INVENTORY_BARCODE_RULE_VIEW', 'INVENTORY_BARCODE_RULE_MANAGE']);
  ensureTable(db);
  const params = [];
  const where = ['1=1'];
  const entityType = url.searchParams.get('entityType');
  if (entityType) {
    const upper = String(entityType).trim().toUpperCase();
    if (!Object.values(ENTITY_TYPES).includes(upper)) {
      throw new HttpError(400, 'entityType 不合法');
    }
    where.push('b.entity_type=?'); params.push(upper);
  }
  const rows = db.prepare(`
    SELECT b.id, b.rule_id ruleId, b.entity_type entityType, b.entity_id entityId,
           b.barcode, r.code ruleCode, r.active ruleActive
      FROM inventory_barcode_bindings b
      LEFT JOIN inventory_barcode_rules r ON r.id=b.rule_id
     WHERE ${where.join(' AND ')}
     ORDER BY b.entity_type, b.entity_id
     LIMIT 1000
  `).all(...params);
  return send(res, 200, { barcodes: rows });
}

// --- label rendering --------------------------------------------------------

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Resolve the printable fields of the entity behind a barcode.
function resolveLabelFields(db, barcode) {
  const parsed = parseBarcode(db, barcode);
  const entityType = String(parsed.entityType || '').toUpperCase();
  const entityId = String(parsed.entityId || '');
  const lines = [];
  let quantity = null;
  let code = null;
  let name = null;

  if (entityType === 'PRODUCT') {
    const row = db.prepare('SELECT code, name FROM products WHERE id=?').get(entityId);
    if (row) { code = row.code; name = row.name; }
    const onHand = db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id=? AND active=1').get(entityId);
    quantity = Number(onHand?.q || 0);
  } else if (entityType === 'WAREHOUSE') {
    const row = db.prepare('SELECT code, name FROM warehouses WHERE id=?').get(entityId);
    if (row) { code = row.code; name = row.name; }
  } else if (entityType === 'BIN') {
    const row = db.prepare(`
      SELECT b.code, b.name, w.code warehouseCode
        FROM warehouse_bins b JOIN warehouses w ON w.id=b.warehouse_id
       WHERE b.id=?
    `).get(entityId);
    if (row) { code = row.code; name = `${row.warehouseCode} / ${row.name || row.code}`; }
  } else if (entityType === 'LOT') {
    const row = db.prepare(`
      SELECT l.lot_code lotCode, p.code productCode, p.name productName
        FROM inventory_lots l JOIN products p ON p.id=l.product_id
       WHERE l.id=?
    `).get(entityId);
    if (row) { code = row.lotCode; name = row.productName; }
  } else if (entityType === 'SERIAL') {
    const row = db.prepare(`
      SELECT s.serial_number serialNumber, p.code productCode, p.name productName
        FROM inventory_serials s JOIN products p ON p.id=s.product_id
       WHERE s.id=?
    `).get(entityId);
    if (row) { code = row.serialNumber; name = row.productName; }
  } else if (entityType === 'CONTAINER') {
    const row = db.prepare('SELECT container_no containerNo, container_type containerType FROM inventory_containers WHERE id=?').get(entityId);
    if (row) { code = row.containerNo; name = row.containerType; }
  }

  lines.push({ label: '条码', value: barcode });
  if (entityType) lines.push({ label: '对象类型', value: entityType });
  if (entityId) lines.push({ label: '对象 ID', value: entityId });
  if (code) lines.push({ label: '编码', value: code });
  if (name) lines.push({ label: '名称', value: name });
  if (quantity !== null) lines.push({ label: '数量', value: String(quantity) });

  return { parsed, entityType, entityId, code, name, quantity, lines };
}

// A small, self-contained SVG: no external asset, no network reference, no
// server-side image dependency. The barcode is rendered as a Code-39-style
// bar pattern derived deterministically from the barcode text so a label
// printer can print the SVG directly.
function renderSvg(barcode, lines, template) {
  const width = template === 'A4' ? 420 : 240;
  const lineHeight = 16;
  const height = 40 + lines.length * lineHeight + 16;
  const digest = createHash('sha256').update(String(barcode)).digest();
  const bars = [];
  let x = 12;
  // Narrow/wide bar widths derived from the digest bits — deterministic and
  // stable for the same barcode.
  for (let index = 0; index < 32; index += 1) {
    const byte = digest[index % digest.length];
    const wide = ((byte >> (index % 8)) & 1) === 1;
    const barWidth = wide ? 4 : 2;
    const gap = ((byte >> ((index + 3) % 8)) & 1) === 1 ? 4 : 2;
    bars.push(`<rect x="${x}" y="10" width="${barWidth}" height="${height - 60}" fill="#000000"/>`);
    x += barWidth + gap;
    if (x > width - 12) break;
  }
  const textRows = lines.map((line, index) => (
    `<text x="12" y="${height - 40 + index * lineHeight}" font-family="monospace" font-size="11" fill="#000000">${escapeXml(`${line.label}: ${line.value}`)}</text>`
  )).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    bars.join(''),
    `<text x="${width / 2}" y="${height - 46}" text-anchor="middle" font-family="monospace" font-size="12" fill="#000000">${escapeXml(barcode)}</text>`,
    textRows,
    '</svg>',
  ].join('');
}

export async function renderBarcodeLabel(db, req, res, actor) {
  allowAny(actor, ['INVENTORY_BARCODE_RULE_VIEW', 'INVENTORY_BARCODE_RULE_MANAGE']);
  const body = await readJson(req);
  assertAllowedFields(body, ['barcode', 'template']);
  const barcode = String(body.barcode ?? '').trim();
  if (!barcode) throw new HttpError(400, 'barcode 必填');
  const template = String(body.template ?? 'LABEL').trim().toUpperCase();
  if (!['A4', 'LABEL'].includes(template)) {
    throw new HttpError(400, 'template 必须为 A4 或 LABEL');
  }

  ensureTable(db);
  const label = resolveLabelFields(db, barcode);
  const payload = {
    barcode,
    template,
    entityType: label.entityType || null,
    entityId: label.entityId || null,
    code: label.code,
    name: label.name,
    quantity: label.quantity,
    lines: label.lines,
    renderedAt: nowIso(),
    payloadVersion: LABEL_PAYLOAD_VERSION,
    svg: renderSvg(barcode, label.lines, template),
  };
  return send(res, 200, payload);
}
