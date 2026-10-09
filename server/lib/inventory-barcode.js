// V21 — Bounded Barcode Foundation (Wave D).
//
// Frozen by `solution.md §27.35 / §27.36` (Domain 5 Closure Design).
// Parse / master / resolution log. Does NOT create business documents.

import { transaction, id as genId } from '../db.js';
import { audit } from './audit.js';
import { HttpError, allow, allowAny, readJson, send } from './http.js';

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

function tryPatterns(barcode) {
  const patterns = [
    { type: 'product', regex: /^PRD-([A-Z0-9-]+)$/, transform: (m) => ({ product_code: m[1] }) },
    { type: 'warehouse', regex: /^WH-([A-Z0-9-]+)$/, transform: (m) => ({ warehouse_code: m[1] }) },
    { type: 'bin', regex: /^BIN-([A-Z0-9-]+)-([A-Z0-9-]+)$/, transform: (m) => ({ warehouse_code: m[1], bin_code: m[2] }) },
    { type: 'lot', regex: /^LOT-([A-Z0-9-]+)$/, transform: (m) => ({ lot_code: m[1] }) },
    { type: 'serial', regex: /^SER-([A-Z0-9-]+)$/, transform: (m) => ({ serial_number: m[1] }) },
    { type: 'container', regex: /^CTR-([A-Z0-9-]+)$/, transform: (m) => ({ container_no: m[1] }) },
    { type: 'quantity', regex: /^QTY-(\d+)$/, transform: (m) => ({ quantity: Number(m[1]) }) },
  ];
  for (const p of patterns) {
    const m = p.regex.exec(barcode);
    if (m) return { kind: p.type, fields: p.transform(m) };
  }
  return null;
}

export function parseBarcode(db, barcode) {
  ensureTable(db);
  if (!barcode || typeof barcode !== 'string') throw new HttpError(400, 'barcode 必填');
  // Lookup binding first
  const binding = db.prepare(`SELECT * FROM inventory_barcode_bindings WHERE barcode=?`).get(barcode);
  if (binding) {
    const rule = db.prepare(`SELECT * FROM inventory_barcode_rules WHERE id=?`).get(binding.rule_id);
    return {
      source: 'binding',
      ruleCode: rule?.code,
      entityType: binding.entity_type,
      entityId: binding.entity_id,
      fields: { [binding.entity_type]: binding.entity_id },
    };
  }
  // Fall back to pattern parsing
  const parsed = tryPatterns(barcode);
  if (!parsed) throw new HttpError(400, `无法解析条码 ${barcode}`);
  return { source: 'pattern', ...parsed, fields: parsed.fields };
}

export function logResolution(db, actor, barcode, resolution, source) {
  ensureTable(db);
  db.prepare(`
    INSERT INTO inventory_barcode_resolution_log(id, barcode, resolution_json, resolved_at, resolved_by, source)
    VALUES(?, ?, ?, ?, ?, ?)
  `).run(genId(), barcode, JSON.stringify(resolution), new Date().toISOString(), actor?.id || null, source);
}

export async function createBarcodeRule(db, req, res, actor) {
  allow(actor, 'INVENTORY_BARCODE_RULE_MANAGE');
  const body = await readJson(req);
  if (!body.code || !body.pattern) throw new HttpError(400, '编码与 pattern 必填');
  const id = genId();
  transaction(db, () => {
    ensureTable(db);
    db.prepare(`INSERT INTO inventory_barcode_rules(id, code, pattern, fields, active, created_at) VALUES(?, ?, ?, ?, 1, ?)`).run(id, body.code, body.pattern, JSON.stringify(body.fields || {}), new Date().toISOString());
    audit(db, actor.id, 'CREATE', 'INVENTORY_BARCODE_RULE', id, `Create barcode rule ${body.code}`);
  });
  return send(res, 201, { id, code: body.code });
}

export async function createBarcodeBinding(db, req, res, actor) {
  allow(actor, 'INVENTORY_BARCODE_RULE_MANAGE');
  const body = await readJson(req);
  if (!body.ruleId || !body.entityType || !body.entityId || !body.barcode) throw new HttpError(400, 'ruleId / entity / barcode 必填');
  const id = genId();
  transaction(db, () => {
    ensureTable(db);
    db.prepare(`INSERT INTO inventory_barcode_bindings(id, rule_id, entity_type, entity_id, barcode) VALUES(?, ?, ?, ?, ?)`).run(id, body.ruleId, body.entityType, body.entityId, body.barcode);
    audit(db, actor.id, 'CREATE', 'INVENTORY_BARCODE_BINDING', id, `Bind ${body.barcode} → ${body.entityType}:${body.entityId}`);
  });
  return send(res, 201, { id, barcode: body.barcode });
}

export function listBarcodeRules(db, res, actor) {
  allowAny(actor, ['INVENTORY_BARCODE_RULE_VIEW', 'INVENTORY_BARCODE_RULE_MANAGE']);
  ensureTable(db);
  const rules = db.prepare(`SELECT * FROM inventory_barcode_rules ORDER BY created_at DESC`).all();
  return send(res, 200, { barcodeRules: rules });
}