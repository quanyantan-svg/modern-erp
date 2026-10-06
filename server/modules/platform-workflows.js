import { id } from '../db.js';
import { audit } from '../lib/audit.js';
import { allow, allowAny, readJson, send } from '../lib/http.js';

export async function listWorkflows(db, res, actor) {
  allowAny(actor, ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE']);
  const workflows = db.prepare('SELECT w.*, u.name creatorName FROM approval_workflows w LEFT JOIN users u ON u.id=w.creator_id ORDER BY w.created_at DESC').all();
  return send(res, 200, { workflows });
}

export async function createWorkflow(db, req, res, actor) {
  allow(actor, 'WORKFLOW_MANAGE');
  const { name, entity_type, steps } = await readJson(req);
  const now = new Date().toISOString();
  const workflowId = id();
  db.prepare('INSERT INTO approval_workflows(id,name,entity_type,steps,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(workflowId, name, entity_type, JSON.stringify(steps || []), actor.id, now, now);
  audit(db, actor.id, 'CREATE', 'WORKFLOW', workflowId, `创建审批流程 ${name}`);
  return send(res, 200, { id: workflowId });
}
