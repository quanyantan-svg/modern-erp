import { id } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, readJson, send } from '../lib/http.js';

// ============ Contacts ============

export async function listContacts(db, res, actor, url) {
  allowAny(actor, ['CRM_VIEW', 'CRM_MANAGE', 'CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE']);
  const customerId = url.searchParams.get('customerId') || '';
  const supplierId = url.searchParams.get('supplierId') || '';
  let sql = `SELECT c.*, cu.name customerName, s.name supplierName, u.name creatorName
    FROM contacts c
    LEFT JOIN customers cu ON cu.id=c.customer_id
    LEFT JOIN suppliers s ON s.id=c.supplier_id
    LEFT JOIN users u ON u.id=c.creator_id
    WHERE 1=1`;
  const params = [];
  if (customerId) { sql += ` AND c.customer_id=?`; params.push(customerId); }
  if (supplierId) { sql += ` AND c.supplier_id=?`; params.push(supplierId); }
  sql += ` ORDER BY c.created_at DESC`;
  const contacts = db.prepare(sql).all(...params);
  return send(res, 200, { contacts });
}

export async function createContact(db, req, res, actor) {
  allow(actor, 'CRM_MANAGE');
  const body = await readJson(req);
  const { customer_id, supplier_id, name, gender, position, phone, mobile, email, wechat, birthday, remark, is_primary } = body;
  const now = new Date().toISOString();
  const contactId = id();
  
  db.prepare(`INSERT INTO contacts(id,customer_id,supplier_id,name,gender,position,phone,mobile,email,wechat,birthday,remark,is_primary,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    contactId, customer_id || null, supplier_id || null, name, gender || null, position || '', phone || '', mobile || '', email || '', wechat || '', birthday || '', remark || '', is_primary ? 1 : 0, actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'CONTACT', contactId, `新增联系人 ${name}`);
  return send(res, 200, { id: contactId });
}

export async function updateContact(db, req, res, actor, contactId) {
  allow(actor, 'CRM_MANAGE');
  const body = await readJson(req);
  const { name, gender, position, phone, mobile, email, wechat, birthday, remark, is_primary } = body;
  const now = new Date().toISOString();
  
  db.prepare(`UPDATE contacts SET name=?,gender=?,position=?,phone=?,mobile=?,email=?,wechat=?,birthday=?,remark=?,is_primary=?,updated_at=? WHERE id=?`).run(
    name, gender, position, phone, mobile, email, wechat, birthday, remark, is_primary ? 1 : 0, now, contactId
  );
  
  audit(db, actor.id, 'UPDATE', 'CONTACT', contactId, `更新联系人 ${name}`);
  return send(res, 200, { ok: true });
}

export async function deleteContact(db, req, res, actor, contactId) {
  allow(actor, 'CRM_MANAGE');
  const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(contactId);
  if (!contact) throw new HttpError(404, '联系人不存在');
  db.prepare('DELETE FROM contacts WHERE id=?').run(contactId);
  audit(db, actor.id, 'DELETE', 'CONTACT', contactId, `删除联系人 ${contact.name}`);
  return send(res, 200, { ok: true });
}

// ============ Customer Followups ============

export async function listFollowups(db, res, actor, url) {
  allowAny(actor, ['CRM_VIEW', 'CRM_MANAGE']);
  const customerId = url.searchParams.get('customerId') || '';
  let sql = `SELECT f.*, cu.name customerName, u.name handlerName, creator.name creatorName
    FROM customer_followups f
    LEFT JOIN customers cu ON cu.id=f.customer_id
    LEFT JOIN users u ON u.id=f.handler_id
    LEFT JOIN users creator ON creator.id=f.creator_id
    WHERE 1=1`;
  const params = [];
  if (customerId) { sql += ` AND f.customer_id=?`; params.push(customerId); }
  sql += ` ORDER BY f.followup_date DESC, f.created_at DESC`;
  const followups = db.prepare(sql).all(...params);
  return send(res, 200, { followups });
}

export async function createFollowup(db, req, res, actor) {
  allow(actor, 'CRM_MANAGE');
  const body = await readJson(req);
  const { customer_id, followup_type, followup_date, content, next_plan, next_date, handler_id } = body;
  const now = new Date().toISOString();
  const followupId = id();
  
  db.prepare(`INSERT INTO customer_followups(id,customer_id,followup_type,followup_date,content,next_plan,next_date,handler_id,creator_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    followupId, customer_id, followup_type, followup_date, content, next_plan || '', next_date || '', handler_id || actor.id, actor.id, now
  );
  
  audit(db, actor.id, 'CREATE', 'CUSTOMER_FOLLOWUP', followupId, `新增客户跟进 ${content.slice(0, 20)}`);
  return send(res, 200, { id: followupId });
}

// ============ Sales Activities ============

export async function listSalesActivities(db, res, actor, url) {
  allowAny(actor, ['CRM_VIEW', 'CRM_MANAGE']);
  const status = url.searchParams.get('status') || '';
  let sql = `SELECT sa.*, u.name creatorName FROM sales_activities sa LEFT JOIN users u ON u.id=sa.creator_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND sa.status=?`; params.push(status); }
  sql += ` ORDER BY sa.start_date DESC`;
  const activities = db.prepare(sql).all(...params);
  return send(res, 200, { activities });
}

export async function createSalesActivity(db, req, res, actor) {
  allow(actor, 'CRM_MANAGE');
  const body = await readJson(req);
  const { activity_type, title, content, start_date, end_date, location, budget_cents, participants, status, result } = body;
  const now = new Date().toISOString();
  const activityId = id();
  const seq = String(db.prepare('SELECT COUNT(*) cnt FROM sales_activities WHERE start_date LIKE ?').get(start_date.slice(0, 7) + '%').cnt + 1).padStart(4, '0');
  const activityNo = `SA-${start_date.replace(/-/g,'')}-${seq}`;
  
  db.prepare(`INSERT INTO sales_activities(id,activity_no,activity_type,title,content,start_date,end_date,location,budget_cents,actual_cost_cents,participants,status,result,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`).run(
    activityId, activityNo, activity_type, title, content, start_date, end_date || '', location || '', budget_cents || 0, participants || '', status || 'PLANNING', result || '', actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'SALES_ACTIVITY', activityId, `新建销售活动 ${title}`);
  return send(res, 200, { id: activityId, activity_no: activityNo });
}

export async function updateSalesActivity(db, req, res, actor, activityId) {
  allow(actor, 'CRM_MANAGE');
  const body = await readJson(req);
  const { title, content, start_date, end_date, location, budget_cents, actual_cost_cents, participants, status, result } = body;
  const now = new Date().toISOString();
  
  db.prepare(`UPDATE sales_activities SET title=?,content=?,start_date=?,end_date=?,location=?,budget_cents=?,actual_cost_cents=?,participants=?,status=?,result=?,updated_at=? WHERE id=?`).run(
    title, content, start_date, end_date || '', location || '', budget_cents || 0, actual_cost_cents || 0, participants || '', status, result || '', now, activityId
  );
  
  audit(db, actor.id, 'UPDATE', 'SALES_ACTIVITY', activityId, `更新销售活动 ${title}`);
  return send(res, 200, { ok: true });
}

export async function deleteSalesActivity(db, req, res, actor, activityId) {
  allow(actor, 'CRM_MANAGE');
  const activity = db.prepare('SELECT * FROM sales_activities WHERE id=?').get(activityId);
  if (!activity) throw new HttpError(404, '活动不存在');
  db.prepare('DELETE FROM sales_activities WHERE id=?').run(activityId);
  audit(db, actor.id, 'DELETE', 'SALES_ACTIVITY', activityId, `删除销售活动 ${activity.title}`);
  return send(res, 200, { ok: true });
}
// ============ Projects ============

export async function listProjects(db, res, actor, url) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const status = url.searchParams.get('status') || '';
  let sql = `SELECT p.*, c.name customerName, u.name managerName, creator.name creatorName
    FROM projects p
    LEFT JOIN customers c ON c.id=p.customer_id
    LEFT JOIN users u ON u.id=p.manager_id
    LEFT JOIN users creator ON creator.id=p.creator_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND p.status=?`; params.push(status); }
  sql += ` ORDER BY p.created_at DESC`;
  const projects = db.prepare(sql).all(...params);
  return send(res, 200, { projects });
}

export async function createProject(db, req, res, actor) {
  allow(actor, 'PROJECT_MANAGE');
  const body = await readJson(req);
  const { project_no, name, description, project_type, customer_id, start_date, end_date, budget_cents, manager_id, remark } = body;
  const now = new Date().toISOString();
  const projectId = id();
  const seq = String(db.prepare('SELECT COUNT(*) cnt FROM projects WHERE start_date LIKE ?').get(start_date.slice(0, 7) + '%').cnt + 1).padStart(4, '0');
  const projectNo = project_no || `PRJ-${start_date.replace(/-/g,'')}-${seq}`;
  
  db.prepare(`INSERT INTO projects(id,project_no,name,description,project_type,customer_id,start_date,end_date,status,budget_cents,manager_id,remark,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    projectId, projectNo, name, description, project_type, customer_id || null, start_date, end_date || null, 'PLANNING', budget_cents || 0, manager_id, remark || '', actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'PROJECT', projectId, `新建项目 ${name}`);
  return send(res, 200, { id: projectId, project_no: projectNo });
}

export async function updateProject(db, req, res, actor, projectId) {
  allow(actor, 'PROJECT_MANAGE');
  const body = await readJson(req);
  const { name, description, project_type, customer_id, start_date, end_date, status, budget_cents, manager_id, remark } = body;
  const now = new Date().toISOString();
  
  db.prepare(`UPDATE projects SET name=?,description=?,project_type=?,customer_id=?,start_date=?,end_date=?,status=?,budget_cents=?,manager_id=?,remark=?,updated_at=? WHERE id=?`).run(
    name, description, project_type, customer_id || null, start_date, end_date || null, status, budget_cents || 0, manager_id, remark || '', now, projectId
  );
  
  audit(db, actor.id, 'UPDATE', 'PROJECT', projectId, `更新项目 ${name}`);
  return send(res, 200, { ok: true });
}

export async function getProjectDetail(db, res, actor, projectId) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const project = db.prepare(`SELECT p.*, c.name customerName, u.name managerName FROM projects p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN users u ON u.id=p.manager_id WHERE p.id=?`).get(projectId);
  if (!project) throw new HttpError(404, '项目不存在');
  project.tasks = db.prepare(`SELECT t.*, u.name assigneeName FROM project_tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=? ORDER BY t.created_at`).all(projectId);
  project.timesheets = db.prepare(`SELECT ts.*, u.name userName FROM project_timesheets ts LEFT JOIN users u ON u.id=ts.user_id WHERE ts.project_id=? ORDER BY ts.work_date DESC LIMIT 100`).all(projectId);
  return send(res, 200, { project });
}

// ============ Project Tasks ============

export async function listProjectTasks(db, res, actor, url) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const projectId = url.searchParams.get('projectId') || '';
  let sql = `SELECT t.*, p.name projectName, u.name assigneeName
    FROM project_tasks t
    LEFT JOIN projects p ON p.id=t.project_id
    LEFT JOIN users u ON u.id=t.assignee_id
    WHERE 1=1`;
  const params = [];
  if (projectId) { sql += ` AND t.project_id=?`; params.push(projectId); }
  sql += ` ORDER BY t.priority DESC, t.created_at`;
  const tasks = db.prepare(sql).all(...params);
  return send(res, 200, { tasks });
}

export async function createProjectTask(db, req, res, actor) {
  allow(actor, 'PROJECT_MANAGE');
  const body = await readJson(req);
  const { project_id, parent_id, name, description, priority, planned_start, planned_end, assignee_id, estimated_hours } = body;
  const now = new Date().toISOString();
  const taskId = id();
  const seq = String(db.prepare('SELECT COUNT(*) cnt FROM project_tasks WHERE project_id=?').get(project_id).cnt + 1).padStart(3, '0');
  const taskNo = `TASK-${seq}`;
  
  db.prepare(`INSERT INTO project_tasks(id,project_id,parent_id,task_no,name,description,priority,status,planned_start,planned_end,assignee_id,estimated_hours,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    taskId, project_id, parent_id || null, taskNo, name, description, priority || 'MEDIUM', 'PENDING', planned_start || null, planned_end || null, assignee_id || null, estimated_hours || 0, actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'PROJECT_TASK', taskId, `新建任务 ${name}`);
  return send(res, 200, { id: taskId, task_no: taskNo });
}

export async function updateProjectTask(db, req, res, actor, taskId) {
  allow(actor, 'PROJECT_MANAGE');
  const body = await readJson(req);
  const { name, description, priority, status, planned_start, planned_end, actual_start, actual_end, progress, assignee_id, estimated_hours } = body;
  const now = new Date().toISOString();
  
  db.prepare(`UPDATE project_tasks SET name=?,description=?,priority=?,status=?,planned_start=?,planned_end=?,actual_start=?,actual_end=?,progress=?,assignee_id=?,estimated_hours=?,updated_at=? WHERE id=?`).run(
    name, description, priority, status, planned_start || null, planned_end || null, actual_start || null, actual_end || null, progress || 0, assignee_id || null, estimated_hours || 0, now, taskId
  );
  
  audit(db, actor.id, 'UPDATE', 'PROJECT_TASK', taskId, `更新任务 ${name}`);
  return send(res, 200, { ok: true });
}

// ============ Project Timesheets ============

export async function listTimesheets(db, res, actor, url) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const projectId = url.searchParams.get('projectId') || '';
  const userId = url.searchParams.get('userId') || '';
  const startDate = url.searchParams.get('startDate') || '';
  const endDate = url.searchParams.get('endDate') || '';
  
  let sql = `SELECT ts.*, p.name projectName, t.name taskName, u.name userName
    FROM project_timesheets ts
    LEFT JOIN projects p ON p.id=ts.project_id
    LEFT JOIN project_tasks t ON t.id=ts.task_id
    LEFT JOIN users u ON u.id=ts.user_id
    WHERE 1=1`;
  const params = [];
  if (projectId) { sql += ` AND ts.project_id=?`; params.push(projectId); }
  if (userId) { sql += ` AND ts.user_id=?`; params.push(userId); }
  if (startDate) { sql += ` AND ts.work_date>=?`; params.push(startDate); }
  if (endDate) { sql += ` AND ts.work_date<=?`; params.push(endDate); }
  sql += ` ORDER BY ts.work_date DESC, ts.created_at DESC`;
  
  const timesheets = db.prepare(sql).all(...params);
  return send(res, 200, { timesheets });
}

export async function createTimesheet(db, req, res, actor) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const body = await readJson(req);
  const { project_id, task_id, user_id, work_date, hours, description, billable } = body;
  const now = new Date().toISOString();
  const tsId = id();
  
  db.prepare(`INSERT INTO project_timesheets(id,project_id,task_id,user_id,work_date,hours,description,billable,creator_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    tsId, project_id, task_id || null, user_id || actor.id, work_date, hours, description || '', billable ? 1 : 0, actor.id, now
  );
  
  audit(db, actor.id, 'CREATE', 'TIMESHEET', tsId, `记录工时 ${hours}h`);
  return send(res, 200, { id: tsId });
}

export async function deleteTimesheet(db, req, res, actor, tsId) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const ts = db.prepare('SELECT * FROM project_timesheets WHERE id=?').get(tsId);
  if (!ts) throw new HttpError(404, '工时记录不存在');
  db.prepare('DELETE FROM project_timesheets WHERE id=?').run(tsId);
  audit(db, actor.id, 'DELETE', 'TIMESHEET', tsId, `删除工时记录`);
  return send(res, 200, { ok: true });
}
// ============ Notifications ============

export async function listNotifications(db, res, actor) {
  allow(actor, 'DASHBOARD_VIEW');
  const notifications = db.prepare(`SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(actor.id);
  const unreadCount = db.prepare('SELECT COUNT(*) cnt FROM notifications WHERE user_id=? AND is_read=0').get(actor.id).cnt;
  return send(res, 200, { notifications, unreadCount });
}

export async function markNotificationRead(db, req, res, actor) {
  allow(actor, 'DASHBOARD_VIEW');
  const body = await readJson(req);
  const { notificationId } = body;
  if (notificationId) {
    db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(notificationId, actor.id);
  } else {
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(actor.id);
  }
  return send(res, 200, { ok: true });
}

export function createNotification(db, userId, title, content, type = 'INFO', sourceType = null, sourceId = null) {
  const now = new Date().toISOString();
  const nid = id();
  db.prepare('INSERT INTO notifications(id,user_id,title,content,type,source_type,source_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(nid, userId, title, content, type, sourceType, sourceId, now);
}

// ============ Approval Workflows ============

export async function listWorkflows(db, res, actor) {
  allowAny(actor, ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE']);
  const workflows = db.prepare('SELECT w.*, u.name creatorName FROM approval_workflows w LEFT JOIN users u ON u.id=w.creator_id ORDER BY w.created_at DESC').all();
  return send(res, 200, { workflows });
}

export async function createWorkflow(db, req, res, actor) {
  allow(actor, 'WORKFLOW_MANAGE');
  const body = await readJson(req);
  const { name, entity_type, steps } = body;
  const now = new Date().toISOString();
  const wfId = id();
  
  db.prepare('INSERT INTO approval_workflows(id,name,entity_type,steps,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(wfId, name, entity_type, JSON.stringify(steps || []), actor.id, now, now);
  
  audit(db, actor.id, 'CREATE', 'WORKFLOW', wfId, `创建审批流程 ${name}`);
  return send(res, 200, { id: wfId });
}

export async function listApprovalRecords(db, res, actor, url) {
  allowAny(actor, ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE']);
  const entityType = url.searchParams.get('entityType') || '';
  const entityId = url.searchParams.get('entityId') || '';
  
  let sql = `SELECT ar.*, u.name approverName FROM approval_records ar LEFT JOIN users u ON u.id=ar.approver_id WHERE 1=1`;
  const params = [];
  if (entityType) { sql += ` AND ar.entity_type=?`; params.push(entityType); }
  if (entityId) { sql += ` AND ar.entity_id=?`; params.push(entityId); }
  sql += ` ORDER BY ar.created_at DESC`;
  
  const records = db.prepare(sql).all(...params);
  return send(res, 200, { records });
}
