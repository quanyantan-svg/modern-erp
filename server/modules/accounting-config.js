// V2 Wave 5A — Accounting Configuration Decomposition.
//
// Coherent responsibility: Accounting Configuration Dictionaries.
// Specifically:
//   - currencies;
//   - voucher words;
//   - voucher templates.
//
// Extracted verbatim from server/modules/extended.js. Wave 5A is a
// structural migration only — handler bodies, SQL, permissions,
// response shapes, and HTTP semantics remain byte-equivalent to the
// baseline implementation. No schema / frontend / deployment change.

import { id } from '../db.js';
import { allow, allowAny, readJson, send } from '../lib/http.js';

// ============ 币种管理 ============

export function listCurrencies(db, res, actor) {
  allowAny(actor, ["CURRENCY_VIEW", "CURRENCY_MANAGE"]);
  const currencies = db.prepare("SELECT * FROM currencies ORDER BY is_base DESC, code").all();
  return send(res, 200, { currencies });
}

// ============ 凭证字管理 ============

export function listVoucherWords(db, res, actor) {
  allowAny(actor, ["VOUCHER_WORDS_VIEW", "VOUCHER_WORDS_MANAGE"]);
  const words = db.prepare("SELECT * FROM voucher_words ORDER BY prefix").all();
  return send(res, 200, { voucherWords: words });
}

export async function createVoucherWord(db, req, res, actor) {
  allow(actor, "VOUCHER_WORDS_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const wordId = id();
  db.prepare("INSERT INTO voucher_words(id,code,name,prefix,current_no,created_at) VALUES(?,?,?,?,0,?)").run(wordId, body.code, body.name, body.prefix, now);
  return send(res, 201, { id: wordId });
}

// ============ 凭证模板 ============

export function listVoucherTemplates(db, res, actor, url) {
  allowAny(actor, ["VOUCHER_TEMPLATES_VIEW", "VOUCHER_TEMPLATES_MANAGE"]);
  const category = url.searchParams.get("category") || "";
  let sql = "SELECT t.*, u.display_name creator_name FROM voucher_templates t LEFT JOIN users u ON u.id=t.creator_id WHERE 1=1";
  const params = [];
  if (category) { sql += " AND t.category=?"; params.push(category); }
  sql += " ORDER BY t.template_code";
  const templates = db.prepare(sql).all(...params).map(t => ({ ...t, entries: JSON.parse(t.entries_json) }));
  return send(res, 200, { templates });
}
