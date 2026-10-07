// V17 Master & Engineering Domain Closure — Wave C: Configurable BOM.
//
// Provides a preview / validate contract for Engineering-side configurable
// BOM (selectable / replaceable / modifiable component flags).
//
// IMPORTANT: This module does NOT create a second source of BOM truth.
// It reads the canonical `boms` + `bom_items` rows from Wave B and produces
// a derived preview material list according to the customer's choices.
// We do NOT persist derived BOMs as new versions; that is deferred to a
// future Domain Closure.

import { allow, allowAny, readJson, send } from '../lib/http.js';

const VALID_FLAGS = ['is_selectable', 'is_replaceable', 'is_modifiable'];

function loadConfigurableBom(db, bomId) {
  const bom = db.prepare('SELECT * FROM boms WHERE id=?').get(bomId);
  if (!bom) return null;
  const items = db.prepare(`
    SELECT bi.id, bi.product_id, bi.quantity, bi.scrap_rate, bi.line_no,
      bi.is_selectable, bi.is_replaceable, bi.is_modifiable, bi.config_group, bi.config_constraint,
      p.code, p.name, p.unit
    FROM bom_items bi JOIN products p ON p.id=bi.product_id
    WHERE bi.bom_id=? ORDER BY bi.line_no
  `).all(bomId);
  return { ...bom, items };
}

function loadBomItemsForProduct(db, productId) {
  // Find the effective BOM for the parent product (no purpose filter —
  // configurable BOM preview works on whichever BOM is currently
  // ACTIVE+APPROVED).
  const bom = db.prepare(`SELECT * FROM boms WHERE product_id=? AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1`).get(productId);
  if (!bom) return null;
  return loadConfigurableBom(db, bom.id);
}

// Preview: given a bomId and a set of choices {lineNo: chosenProductId},
// produce the resolved material list.
export async function previewConfigurableBom(db, req, res, actor) {
  allow(actor, 'ENGINEERING_CONFIGURABLE_VIEW');
  const body = await readJson(req);
  const bomId = body.bomId ?? body.bom_id;
  if (!bomId) return send(res, 400, { error: '缺少 bomId' });
  const bom = loadConfigurableBom(db, bomId);
  if (!bom) return send(res, 404, { error: 'BOM 不存在' });
  const choices = body.choices || {};
  const warnings = [];
  const items = [];
  for (const item of bom.items) {
    const key = String(item.line_no);
    const chosen = choices[key];
    if (chosen && chosen !== item.product_id) {
      // Replaceable: allow substitution if a different product was chosen
      // and at least one of is_replaceable / is_selectable is enabled.
      if (!item.is_replaceable && !item.is_selectable) {
        warnings.push(`第 ${item.line_no} 行不允许替换或选择`);
        items.push(item);
        continue;
      }
      const sub = db.prepare('SELECT id, code, name, unit FROM products WHERE id=? AND active=1').get(chosen);
      if (!sub) {
        warnings.push(`第 ${item.line_no} 行选择的物料 ${chosen} 不存在`);
        items.push(item);
        continue;
      }
      items.push({ ...item, product_id: sub.id, product_code: sub.code, product_name: sub.name });
    } else {
      items.push(item);
    }
    if (item.is_modifiable && body.modifications && body.modifications[key]) {
      const m = body.modifications[key];
      if (Number.isFinite(Number(m.quantity)) && Number(m.quantity) > 0) {
        items[items.length - 1].quantity = Number(m.quantity);
      }
    }
  }
  return send(res, 200, { bom_id: bomId, items, warnings });
}

// Validate: ensure the proposed choices respect required vs optional groups.
export async function validateConfigurableBom(db, req, res, actor) {
  allowAny(actor, ['ENGINEERING_CONFIGURABLE_VIEW', 'ENGINEERING_BOM_VIEW']);
  const body = await readJson(req);
  const bomId = body.bomId ?? body.bom_id;
  if (!bomId) return send(res, 400, { error: '缺少 bomId' });
  const bom = loadConfigurableBom(db, bomId);
  if (!bom) return send(res, 404, { error: 'BOM 不存在' });
  const choices = body.choices || {};
  const groups = new Map();
  for (const item of bom.items) {
    if (!item.config_group) continue;
    if (!groups.has(item.config_group)) groups.set(item.config_group, []);
    groups.get(item.config_group).push(item);
  }
  const errors = [];
  for (const [group, items] of groups) {
    const chosen = items.filter((it) => choices[String(it.line_no)]).length;
    const optional = items.every((it) => it.is_selectable);
    if (!optional && chosen === 0) {
      errors.push(`配置组 ${group} 至少选择一项`);
    }
  }
  return send(res, 200, { ok: errors.length === 0, errors });
}