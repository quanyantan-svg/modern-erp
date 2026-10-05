// V2 Stage 3 / Wave 5B — canonical owner for the manufacturing
// reference-data routes that backed the legacy BOM-bound workflow
// (work centres / routing operations on the pre-M10
// `routing_operations` table).
//
// The four handlers in this module were extracted verbatim from
// `server/modules/extended.js` during the Wave 5B decomposition and
// preserve their original SQL, permission gates, response shapes,
// and (for createWorkCenter) audit write. `/api/product-routings/*`
// and `product_routings` / `product_routing_operations` continue to
// live under `server/modules/product-routing.js` and are NOT touched
// by this wave. `/api/labor-records`, production orders, manufacturing
// execution, WIP / production cost, BOM handlers, IQC / OQC,
// inventory, planning / MRP, and supplier evaluations remain on
// legacy `handleApi` branches at the current V2 boundary.

import { id } from '../db.js';
import { audit } from '../lib/audit.js';
import { allow, allowAny, readJson, send } from '../lib/http.js';

// ============ 工作中心 ============

export function listWorkCenters(db, res, actor) {
  allowAny(actor, ["WORK_CENTERS_VIEW", "WORK_CENTERS_MANAGE"]);
  const centers = db.prepare("SELECT * FROM work_centers ORDER BY code").all();
  return send(res, 200, { workCenters: centers });
}

export async function createWorkCenter(db, req, res, actor) {
  allow(actor, "WORK_CENTERS_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const wcId = id();
  const capacity = Math.max(0, Math.round(Number(body.dailyCapacityMinutes ?? body.daily_capacity_minutes ?? (Number(body.capacity_hours || 8) * 60))));
  const laborRate = Math.max(0, Math.round(Number(body.laborRateCentsPerHour ?? body.labor_rate_cents_per_hour ?? 0)));
  const overheadRate = Math.max(0, Math.round(Number(body.overheadRateCentsPerHour ?? body.overhead_rate_cents_per_hour ?? 0)));
  db.prepare("INSERT INTO work_centers(id,code,name,type,capacity_hours,efficiency,unit_cost_cents,daily_capacity_minutes,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(wcId, body.code, body.name, body.type || "ASSEMBLY", capacity / 60, body.efficiency || 100, body.unit_cost_cents || 0, capacity, laborRate, overheadRate, now);
  audit(db, actor.id, 'CREATE', 'WORK_CENTER', wcId, `${body.code} 能力 ${capacity} 分钟`);
  return send(res, 201, { id: wcId });
}

// ============ 工序管理 ============

export function listRoutingOperations(db, res, actor, url) {
  allowAny(actor, ["ROUTING_VIEW", "ROUTING_MANAGE"]);
  const bomId = url.searchParams.get("bom_id");
  let sql = "SELECT r.*, w.code wc_code, w.name wc_name, b.version bom_version, p.code product_code, p.name product_name FROM routing_operations r JOIN work_centers w ON w.id=r.work_center_id JOIN boms b ON b.id=r.bom_id JOIN products p ON p.id=b.product_id";
  const params = [];
  if (bomId) { sql += " WHERE r.bom_id=?"; params.push(bomId); }
  sql += " ORDER BY r.bom_id, r.operation_no";
  const operations = db.prepare(sql).all(...params);
  return send(res, 200, { operations });
}

export async function createRoutingOperation(db, req, res, actor) {
  allow(actor, "ROUTING_MANAGE");
  const body = await readJson(req);
  const opId = id();
  db.prepare("INSERT INTO routing_operations(id,bom_id,operation_no,work_center_id,work_time_minutes,setup_time_minutes,wait_time_minutes,move_time_minutes,description) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(opId, body.bom_id, body.operation_no || 1, body.work_center_id, body.work_time_minutes || 0, body.setup_time_minutes || 0, body.wait_time_minutes || 0, body.move_time_minutes || 0, body.description || "");
  return send(res, 201, { id: opId });
}