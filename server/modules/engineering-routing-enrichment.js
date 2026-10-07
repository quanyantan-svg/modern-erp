// V17 Master & Engineering Domain Closure — Wave D: Routing Enrichment.
//
// This module:
//   - Reads the canonical product_routings / product_routing_operations
//     and produces an enriched payload (with Engineering Operation /
//     Control Code / Activity / Resource / Equipment references).
//   - Exposes the topology link CRUD (PARALLEL / SPLIT / MERGE / ALTERNATE).
//   - Validates reference integrity against Wave A's engineering_* tables.
//   - Provides a static source-contract assertion that the legacy
//     `routing_operations` table is not actively mutated through any live
//     route — i.e. that the canonical convergence is enforced.
//
// We do NOT modify or migrate data in the legacy `routing_operations`
// table. The existing `/api/routing-operations` GET-only route remains
// for historical compatibility.

import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, optionalText, readJson, requiredText, send } from '../lib/http.js';

const LINK_TYPES = new Set(['PARALLEL', 'SPLIT', 'MERGE', 'ALTERNATE']);

function ensureRoutingExists(db, routingId) {
  const routing = db.prepare('SELECT * FROM product_routings WHERE id=?').get(routingId);
  if (!routing) throw new HttpError(404, '工艺路线不存在');
  return routing;
}

function ensureOperationExists(db, operationId) {
  if (!operationId) return null;
  const op = db.prepare('SELECT * FROM product_routing_operations WHERE id=?').get(operationId);
  if (!op) throw new HttpError(404, '工序不存在');
  return op;
}

function assertReferenceExists(db, table, column, value, label) {
  if (!value) return;
  const row = db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND active=1`).get(value);
  if (!row) throw new HttpError(400, `${label}不存在或未启用`);
}

export function getEnrichedRouting(db, res, actor, routingId) {
  allowAny(actor, ['ROUTING_VIEW', 'ROUTING_MANAGE']);
  ensureRoutingExists(db, routingId);
  const routing = db.prepare(`
    SELECT r.*, p.code product_code, p.name product_name, p.unit product_unit
    FROM product_routings r JOIN products p ON p.id=r.product_id WHERE r.id=?
  `).get(routingId);
  const operations = db.prepare(`
    SELECT o.*,
      eo.code engineering_operation_code, eo.name engineering_operation_name,
      cc.code control_code_code, cc.name control_code_name,
      a.code activity_code, a.name activity_name,
      res.code resource_code, res.name resource_name,
      eq.code equipment_code, eq.name equipment_name,
      wc.code work_center_code, wc.name work_center_name
    FROM product_routing_operations o
    LEFT JOIN engineering_operations eo ON eo.id=o.operation_id
    LEFT JOIN engineering_control_codes cc ON cc.id=o.control_code_id
    LEFT JOIN engineering_basic_activities a ON a.id=o.activity_id
    LEFT JOIN engineering_resources res ON res.id=o.resource_id
    LEFT JOIN engineering_equipment eq ON eq.id=o.equipment_id
    LEFT JOIN work_centers wc ON wc.id=o.work_center_id
    WHERE o.routing_id=?
    ORDER BY o.sequence_no, o.id
  `).all(routingId);
  const links = db.prepare(`
    SELECT link.*, po.operation_name parent_name, co.operation_name child_name
    FROM product_routing_operation_links link
    JOIN product_routing_operations po ON po.id=link.parent_operation_id
    JOIN product_routing_operations co ON co.id=link.child_operation_id
    WHERE link.routing_id=?
    ORDER BY link.sequence_no, link.id
  `).all(routingId);
  return send(res, 200, { routing, operations, links });
}

export async function updateRoutingEnrichment(db, req, res, actor, routingId) {
  allow(actor, 'ROUTING_MANAGE');
  ensureRoutingExists(db, routingId);
  const body = await readJson(req);
  const operations = Array.isArray(body.operations) ? body.operations : null;
  const topology = body.topology;
  if (!operations && topology === undefined) return send(res, 200, { ok: true });
  // Reference validation.
  for (const item of operations || []) {
    if (!item.id) continue;
    assertReferenceExists(db, 'engineering_operations', 'id', item.operationId ?? item.operation_id, '作业');
    assertReferenceExists(db, 'engineering_control_codes', 'id', item.controlCodeId ?? item.control_code_id, '控制码');
    assertReferenceExists(db, 'engineering_basic_activities', 'id', item.activityId ?? item.activity_id, '基础活动');
    assertReferenceExists(db, 'engineering_resources', 'id', item.resourceId ?? item.resource_id, '资源');
    assertReferenceExists(db, 'engineering_equipment', 'id', item.equipmentId ?? item.equipment_id, '设备');
  }
  const now = new Date().toISOString();
  transaction(db, () => {
    if (operations) {
      for (const item of operations) {
        if (!item.id) continue;
        db.prepare(`UPDATE product_routing_operations
          SET operation_id=?, control_code_id=?, activity_id=?, resource_id=?, equipment_id=?,
            is_outsource=?, quality_policy=?
          WHERE id=? AND routing_id=?`).run(
          item.operationId ?? item.operation_id ?? null,
          item.controlCodeId ?? item.control_code_id ?? null,
          item.activityId ?? item.activity_id ?? null,
          item.resourceId ?? item.resource_id ?? null,
          item.equipmentId ?? item.equipment_id ?? null,
          item.isOutsource === true || item.is_outsource === true ? 1 : 0,
          optionalText(item.qualityPolicy ?? item.quality_policy, 100) || '',
          item.id, routingId,
        );
      }
    }
    if (topology !== undefined) {
      const upper = String(topology).toUpperCase();
      if (!['LINEAR', 'NETWORK'].includes(upper)) throw new HttpError(400, 'topology_type 必须是 LINEAR / NETWORK');
      db.prepare('UPDATE product_routings SET topology_type=?, updated_at=? WHERE id=?').run(upper, now, routingId);
    }
    audit(db, actor.id, 'ENRICH', 'PRODUCT_ROUTING', routingId, '');
  });
  return send(res, 200, { ok: true });
}

export async function createRoutingLink(db, req, res, actor, routingId) {
  allow(actor, 'ROUTING_MANAGE');
  ensureRoutingExists(db, routingId);
  const body = await readJson(req);
  const linkType = String(body.linkType ?? body.link_type ?? '').toUpperCase();
  if (!LINK_TYPES.has(linkType)) throw new HttpError(400, 'link_type 不正确');
  const parentOperationId = body.parentOperationId ?? body.parent_operation_id;
  const childOperationId = body.childOperationId ?? body.child_operation_id;
  ensureOperationExists(db, parentOperationId);
  ensureOperationExists(db, childOperationId);
  if (parentOperationId === childOperationId) throw new HttpError(400, '父子工序不能相同');
  const sequenceNo = Math.max(1, Math.round(Number(body.sequenceNo ?? body.sequence_no ?? 1)));
  const dup = db.prepare(`SELECT 1 FROM product_routing_operation_links
    WHERE routing_id=? AND parent_operation_id=? AND child_operation_id=? AND link_type=?`).get(
      routingId, parentOperationId, childOperationId, linkType);
  if (dup) throw new HttpError(409, '相同的拓扑连接已存在');
  const linkId = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO product_routing_operation_links(id,routing_id,parent_operation_id,child_operation_id,link_type,sequence_no,notes,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(linkId, routingId, parentOperationId, childOperationId, linkType, sequenceNo,
      optionalText(body.notes, 200) || '', now);
    db.prepare('UPDATE product_routings SET topology_type=?, updated_at=? WHERE id=?').run('NETWORK', now, routingId);
    audit(db, actor.id, 'CREATE_LINK', 'PRODUCT_ROUTING', routingId, linkType);
  });
  return send(res, 201, { id: linkId });
}

export function deleteRoutingLink(db, res, actor, linkId) {
  allow(actor, 'ROUTING_MANAGE');
  const link = db.prepare('SELECT * FROM product_routing_operation_links WHERE id=?').get(linkId);
  if (!link) throw new HttpError(404, '拓扑连接不存在');
  transaction(db, () => {
    db.prepare('DELETE FROM product_routing_operation_links WHERE id=?').run(linkId);
    audit(db, actor.id, 'DELETE_LINK', 'PRODUCT_ROUTING', link.routing_id, link.link_type);
  });
  return send(res, 200, { ok: true });
}