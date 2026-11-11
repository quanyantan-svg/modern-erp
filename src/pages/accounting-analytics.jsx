// Accounting & Analytics — 域级工作面集合.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4
// Design:    docs/design/accounting-analytics.md §31.0.3 / §31.1 / §31.4 / §31.6 / §31.7
//
// Design §31.0.3 assigns the five new domain routes to this one page. Each
// exported screen is bound to exactly one route key, so a route never has two
// active executable screens:
//
//   accounting-events        → AccountingEvents        (AA-W1)
//   accounting-reconciliation → AccountingReconciliation (AA-W1)
//   accounting-reports        → AccountingReports       (AA-W4)
//   accounting-costing        → InventoryCosting        (AA-W6)
//   management-accounting     → ManagementAccounting    (AA-W7)
//
// Every surface follows LIST → DETAIL → EDITOR: the list is the entry point,
// a record opens its detail sheet and every write happens in a modal editor.
//
// The browser never computes an authoritative amount. Balances, formula
// results, reconciliation differences and closure preconditions all come from
// the server; the browser only renders them.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, FormActions, Modal, can, money } from '../components/ui.jsx';
import {
  BusinessAction, BusinessContentSection, BusinessPageHeader, BusinessPageShell,
  CompactRecord, CompactRecordList, HelpDisclosure, InlineAlert, StatusChip,
} from '../components/design-system.jsx';

function currentPeriod() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

function periodOrEmpty(period) {
  return /^\d{4}-\d{2}$/.test(period || '') ? period : '';
}

const EVENT_STATUS_LABELS = {
  PENDING: '待生成',
  GENERATED: '已生成',
  SKIPPED: '已跳过',
  FAILED: '生成失败',
  REVERSED: '已冲回',
};

const RECONCILIATION_STATUS_LABELS = {
  PASS: '通过',
  FAIL: '存在差异',
  WARN: '需关注',
};

const SEVERITY_LABELS = { BLOCKING: '阻断', WARNING: '警告', INFO: '提示' };

// ---------------------------------------------------------------------------
// AA-W1 — 会计事件台账
// ---------------------------------------------------------------------------

export function AccountingEvents({ user, notify }) {
  const [events, setEvents] = useState([]);
  const [ungenerated, setUngenerated] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [filters, setFilters] = useState({ status: '', sourceType: '', period: currentPeriod(), keyword: '' });
  const [detail, setDetail] = useState(null);
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.sourceType) params.set('source_type', filters.sourceType);
      if (filters.period) params.set('period', filters.period);
      if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim());
      const query = params.toString();
      const [eventResult, ungeneratedResult, subjectResult] = await Promise.all([
        api(`/api/accounting/events${query ? `?${query}` : ''}`),
        api(`/api/accounting/events/ungenerated${query ? `?${query}` : ''}`).catch(() => ({ events: [] })),
        api('/api/accounting/subjects'),
      ]);
      setEvents(eventResult.events || []);
      setUngenerated(ungeneratedResult.events || []);
      setSubjects(subjectResult.subjects || []);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  const canRepair = can(user, 'ACCOUNTING_EVENTS_REPAIR');
  const canManageSubjects = can(user, 'ACCOUNTING_SUBJECTS_MANAGE');
  const canRunBatch = can(user, 'ACCOUNTING_RULE_RUN');

  const act = async (path, body, message) => {
    try {
      await api(path, { method: 'POST', body });
      await load();
      notify(message);
      return true;
    } catch (err) {
      notify(err.message || '操作未完成', 'error');
      return false;
    }
  };

  return (
    <BusinessPageShell>
      <BusinessPageHeader
        title="会计事件台账"
        context="业务事实 ↔ 凭证 · 未生成清单 · 受控修复 · 会计科目"
        help={<HelpDisclosure summary="事件与凭证的关系"><p>每个应生成凭证的业务事实在台账上恰有一条事件记录，业务单据与凭证双向可导航。生成失败会留下稳定错误码；修复只能重试、跳过或恢复，三者都写审计，跳过的事件不会静默消失。</p></HelpDisclosure>}
        primaryAction={canRunBatch ? (
          <BusinessAction hierarchy="primary" onClick={() => act('/api/accounting/events/batch-generate', { period: periodOrEmpty(filters.period) }, '批量生成已执行')}>批量生成凭证</BusinessAction>
        ) : null}
        secondaryActions={[
          <span key="filters" className="inline-actions">
            <input aria-label="事件状态" placeholder="状态" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} />
            <input aria-label="来源类型" placeholder="来源类型" value={filters.sourceType} onChange={(event) => setFilters({ ...filters, sourceType: event.target.value })} />
            <input aria-label="事件期间" type="month" value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })} />
            <input aria-label="事件关键字" placeholder="来源单号 / 事件类型" value={filters.keyword} onChange={(event) => setFilters({ ...filters, keyword: event.target.value })} />
          </span>,
        ]}
      />
      {error ? <InlineAlert tone="danger" title="加载失败">{error}</InlineAlert> : null}

      <BusinessContentSection title="未生成与异常">
        <CompactRecordList data-testid="accounting-event-ungenerated">
          {ungenerated.map((event) => (
            <CompactRecord
              key={event.id}
              title={`${event.event_type} · ${event.source_type}`}
              subtitle={`${event.source_id}${event.source_item_id ? ` / ${event.source_item_id}` : ''}`}
              status={<StatusChip status={event.status}>{EVENT_STATUS_LABELS[event.status] || event.status}</StatusChip>}
              metadata={[
                { label: '期间', value: event.period },
                { label: '业务日期', value: event.business_date },
                { label: '错误码', value: event.last_error_code || '—' },
                { label: '错误信息', value: event.last_error_message || '—' },
              ]}
              action={<BusinessAction onClick={() => setDetail(event)}>查看并修复</BusinessAction>}
            />
          ))}
        </CompactRecordList>
        {!ungenerated.length ? <Empty title="没有待处理的事件" text="当前筛选条件下没有应生成但未生成、或生成失败的业务事实。" /> : null}
      </BusinessContentSection>

      <BusinessContentSection title="会计事件">
        <CompactRecordList data-testid="accounting-events">
          {events.map((event) => (
            <CompactRecord
              key={event.id}
              title={`${event.event_type} · ${event.source_type}`}
              subtitle={`${event.source_id}${event.source_item_id ? ` / ${event.source_item_id}` : ''}`}
              status={<StatusChip status={event.status}>{EVENT_STATUS_LABELS[event.status] || event.status}</StatusChip>}
              metadata={[
                { label: '期间', value: event.period },
                { label: '凭证', value: event.voucher_id || '未生成' },
                { label: '尝试次数', value: event.attempt_count },
                { label: '错误码', value: event.last_error_code || '—' },
              ]}
              action={<BusinessAction onClick={() => setDetail(event)}>打开详情</BusinessAction>}
            />
          ))}
        </CompactRecordList>
        {!events.length ? <Empty title="暂无会计事件" text="业务事实进入受控流程后会在这里留下唯一事件记录。" /> : null}
      </BusinessContentSection>

      <BusinessContentSection
        title="会计科目"
        action={canManageSubjects ? <BusinessAction onClick={() => setEditor({ mode: 'subject' })}>新建科目</BusinessAction> : null}
      >
        <CompactRecordList data-testid="accounting-subjects">
          {subjects.map((subject) => (
            <CompactRecord
              key={subject.id}
              title={`${subject.code} ${subject.name}`}
              subtitle={`${subject.type} · ${subject.direction}`}
              status={<StatusChip status={subject.active ? 'ACTIVE' : 'INACTIVE'}>{subject.active ? '启用' : '停用'}</StatusChip>}
              metadata={[{ label: '上级科目', value: subject.parent_id || '—' }]}
              action={canManageSubjects ? (
                <span className="inline-actions">
                  <BusinessAction onClick={() => setEditor({ mode: 'subject', subject })}>编辑</BusinessAction>
                  {subject.active ? (
                    <BusinessAction onClick={() => act(`/api/accounting/subjects/${subject.id}/deactivate`, {}, '科目已停用')}>停用</BusinessAction>
                  ) : null}
                </span>
              ) : null}
            />
          ))}
        </CompactRecordList>
        {!subjects.length ? <Empty title="暂无会计科目" text="科目是凭证分录的必填维度，编码必须唯一。" /> : null}
      </BusinessContentSection>

      {detail ? (
        <EventDetailSheet
          event={detail}
          canRepair={canRepair}
          notify={notify}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); load(); }}
        />
      ) : null}
      {editor ? (
        <SubjectEditorSheet
          value={editor}
          notify={notify}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); notify('会计科目已保存'); }}
        />
      ) : null}
    </BusinessPageShell>
  );
}

function EventDetailSheet({ event, canRepair, notify, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [skipReason, setSkipReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await api(`/api/accounting/events/${event.id}`);
        if (!cancelled) setDetail(result.event || null);
      } catch {
        if (!cancelled) setDetail(null);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [event.id]);

  const current = detail || event;

  const act = async (path, body, message) => {
    try {
      await api(path, { method: 'POST', body });
      notify(message);
      onChanged();
    } catch (err) {
      notify(err.message || '操作未完成', 'error');
    }
  };

  return (
    <Modal title="会计事件详情" onClose={onClose} wide>
      <BusinessContentSection title="事件与来源">
        <CompactRecordList>
          <CompactRecord
            title={`${current.event_type} · ${current.source_type}`}
            subtitle={`${current.source_id}${current.source_item_id ? ` / ${current.source_item_id}` : ''}`}
            status={<StatusChip status={current.status}>{EVENT_STATUS_LABELS[current.status] || current.status}</StatusChip>}
            metadata={[
              { label: '期间', value: current.period },
              { label: '业务日期', value: current.business_date },
              { label: '规则', value: current.rule_code || '—' },
              { label: '凭证', value: current.voucher_id || '未生成' },
              { label: '错误码', value: current.last_error_code || '—' },
              { label: '错误信息', value: current.last_error_message || '—' },
              { label: '跳过原因', value: current.skip_reason || '—' },
            ]}
          />
        </CompactRecordList>
      </BusinessContentSection>

      {current.voucher ? (
        <BusinessContentSection title="已生成凭证">
          <CompactRecordList>
            <CompactRecord
              title={current.voucher.voucher_no}
              subtitle={`${current.voucher.status} · ${current.voucher.period || '—'}`}
              metadata={[
                { label: '凭证日期', value: current.voucher.voucher_date || '—' },
                { label: '业务日期', value: current.voucher.business_date || '—' },
              ]}
            />
          </CompactRecordList>
        </BusinessContentSection>
      ) : null}

      {(current.attempts || []).length ? (
        <BusinessContentSection title="生成尝试记录">
          <CompactRecordList>
            {current.attempts.map((attempt) => (
              <CompactRecord
                key={attempt.id}
                title={`第 ${attempt.attempt_no} 次 · ${attempt.outcome}`}
                subtitle={attempt.created_at}
                metadata={[
                  { label: '错误码', value: attempt.error_code || '—' },
                  { label: '错误信息', value: attempt.error_message || '—' },
                ]}
              />
            ))}
          </CompactRecordList>
        </BusinessContentSection>
      ) : null}

      {canRepair ? (
        <BusinessContentSection title="受控修复">
          <div className="form-grid">
            <label className="full">
              跳过原因（跳过时必填，写入审计）
              <input aria-label="跳过原因" value={skipReason} onChange={(e) => setSkipReason(e.target.value)} />
            </label>
          </div>
          <div className="inline-actions">
            <BusinessAction onClick={() => act(`/api/accounting/events/${current.id}/retry`, {}, '已重试生成凭证')}>重试生成</BusinessAction>
            <BusinessAction onClick={() => act(`/api/accounting/events/${current.id}/skip`, { reason: skipReason.trim() }, '事件已跳过')}>跳过并说明原因</BusinessAction>
            {current.status === 'SKIPPED' ? (
              <BusinessAction onClick={() => act(`/api/accounting/events/${current.id}/resume`, {}, '事件已恢复')}>恢复</BusinessAction>
            ) : null}
          </div>
        </BusinessContentSection>
      ) : null}

      <FormActions onClose={onClose} saveText="关闭" />
    </Modal>
  );
}

function SubjectEditorSheet({ value, notify, onClose, onSaved }) {
  const isEdit = Boolean(value.subject);
  const [form, setForm] = useState({
    code: value.subject?.code || '',
    name: value.subject?.name || '',
    type: value.subject?.type || 'ASSET',
    direction: value.subject?.direction || 'DEBIT',
    parentId: value.subject?.parent_id || '',
  });

  const save = async (event) => {
    event.preventDefault();
    try {
      const body = {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        direction: form.direction,
        parentId: form.parentId.trim() || undefined,
      };
      if (isEdit) {
        await api(`/api/accounting/subjects/${value.subject.id}`, { method: 'PATCH', body });
      } else {
        await api('/api/accounting/subjects', { method: 'POST', body });
      }
      onSaved();
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  return (
    <Modal title={isEdit ? '编辑会计科目' : '新建会计科目'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>
          科目编码
          <input aria-label="科目编码" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required />
        </label>
        <label>
          科目名称
          <input aria-label="科目名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </label>
        <label>
          科目类型
          <select aria-label="科目类型" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            <option value="ASSET">资产</option>
            <option value="LIABILITY">负债</option>
            <option value="EQUITY">权益</option>
            <option value="REVENUE">收入</option>
            <option value="EXPENSE">费用</option>
          </select>
        </label>
        <label>
          余额方向
          <select aria-label="余额方向" value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}>
            <option value="DEBIT">借</option>
            <option value="CREDIT">贷</option>
          </select>
        </label>
        <label className="full">
          上级科目 ID
          <input aria-label="上级科目" value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })} />
        </label>
        <FormActions onClose={onClose} saveText={isEdit ? '保存修改' : '创建科目'} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AA-W1 — 业务财务对账工作台
// ---------------------------------------------------------------------------

export function AccountingReconciliation({ user, notify }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [result, setResult] = useState(null);
  const [runs, setRuns] = useState([]);
  const [checklist, setChecklist] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [reconResult, runResult, checklistResult] = await Promise.all([
        api(`/api/accounting/reconciliation?period=${encodeURIComponent(period)}`).catch(() => ({ run: null, items: [] })),
        api(`/api/accounting/reconciliation/runs?period=${encodeURIComponent(period)}`).catch(() => ({ runs: [] })),
        api(`/api/accounting/close-checklist?period=${encodeURIComponent(period)}`).catch(() => ({ checklist: [], passed: false })),
      ]);
      setResult(reconResult);
      setRuns(runResult.runs || []);
      setChecklist(checklistResult);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const run = async () => {
    try {
      await api('/api/accounting/reconciliation/run', { method: 'POST', body: { period } });
      notify('对账已执行');
      await load();
    } catch (err) {
      notify(err.message || '对账未执行', 'error');
    }
  };

  const items = result?.items || [];
  const failed = items.filter((item) => item.status !== 'PASS');

  return (
    <BusinessPageShell>
      <BusinessPageHeader
        title="业务财务对账"
        context="业务账 ↔ 总账 · 差异快照 · 期末关账检查"
        help={<HelpDisclosure summary="差异如何处理"><p>对账结果是可留痕的快照，可按期间回看。差异不会被自动静默修复：只能由有权限的人在对应业务单据上处理后重跑对账。关账检查的每一项都必须给出可定位到具体单据的原因。</p></HelpDisclosure>}
        primaryAction={can(user, 'ACCOUNTING_RECONCILIATION_VIEW') ? (
          <BusinessAction hierarchy="primary" onClick={run}>执行本期对账</BusinessAction>
        ) : null}
        secondaryActions={[
          <span key="period" className="inline-actions">
            <input aria-label="对账期间" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
          </span>,
        ]}
      />
      {error ? <InlineAlert tone="danger" title="加载失败">{error}</InlineAlert> : null}

      <BusinessContentSection title="对账差异">
        <CompactRecordList data-testid="accounting-reconciliation">
          {items.map((item) => (
            <CompactRecord
              key={item.id || item.check_code || item.checkCode}
              title={item.check_code || item.checkCode || item.code}
              subtitle={item.explanation}
              status={<StatusChip status={item.status}>{RECONCILIATION_STATUS_LABELS[item.status] || item.status}</StatusChip>}
              metadata={[
                { label: '严重级别', value: SEVERITY_LABELS[item.severity] || item.severity || '—' },
                { label: '差异金额', value: money(item.difference_cents ?? item.differenceCents ?? 0) },
              ]}
            />
          ))}
        </CompactRecordList>
        {!items.length ? <Empty title="本期尚无对账快照" text="执行本期对账后，系统会按检查项生成可留痕的结果快照。" /> : null}
        {failed.length ? (
          <InlineAlert tone="warning" title={`${failed.length} 项未通过`}>
            差异不得自动修复：请在对应业务单据上处理后重新执行对账。
          </InlineAlert>
        ) : null}
      </BusinessContentSection>

      <BusinessContentSection title="期末关账前置检查">
        <CompactRecordList data-testid="accounting-close-checklist">
          {(checklist?.checklist || []).map((entry) => (
            <CompactRecord
              key={entry.code}
              title={entry.item}
              subtitle={entry.detail}
              status={<StatusChip status={entry.passed ? 'PASS' : 'FAIL'}>{entry.passed ? '通过' : '未通过'}</StatusChip>}
            />
          ))}
        </CompactRecordList>
        {!(checklist?.checklist || []).length ? <Empty title="暂无检查项" text="检查项覆盖凭证生成完整性与各子账差异，未通过时关账会被拦截。" /> : null}
      </BusinessContentSection>

      <BusinessContentSection title="历史对账快照">
        <CompactRecordList data-testid="accounting-reconciliation-runs">
          {runs.map((row) => (
            <CompactRecord
              key={row.id}
              title={`${row.period} · ${row.status}`}
              subtitle={row.run_key}
              metadata={[
                { label: '截止日期', value: row.as_of_date || '—' },
                { label: '开始时间', value: row.started_at || '—' },
                { label: '完成时间', value: row.finished_at || '—' },
              ]}
            />
          ))}
        </CompactRecordList>
        {!runs.length ? <Empty title="暂无历史快照" text="每次对账都会留下不可变快照，可按期间回看。" /> : null}
      </BusinessContentSection>
    </BusinessPageShell>
  );
}

// ---------------------------------------------------------------------------
// AA-W4 — 报表平台
// ---------------------------------------------------------------------------

const TEMPLATE_STATUS_LABELS = { DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已归档' };
const INSTANCE_STATUS_LABELS = { DRAFT: '草稿', SUBMITTED: '待审核', APPROVED: '已审核' };
const SOURCE_KIND_LABELS = {
  GL_BALANCE: '总账科目余额',
  GL_ENTRY_SUM: '凭证分录汇总',
  AUX_BALANCE: '辅助项目余额',
  BUSINESS_AGGREGATE: '业务台账聚合',
  TEMPLATE_ITEM: '引用其它报表项目',
};

export function AccountingReports({ user, notify }) {
  const [templates, setTemplates] = useState([]);
  const [instances, setInstances] = useState([]);
  const [period, setPeriod] = useState(currentPeriod());
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const [templateResult, instanceResult] = await Promise.all([
        api('/api/accounting/report-templates'),
        api('/api/accounting/report-instances').catch(() => ({ reportInstances: [] })),
      ]);
      setTemplates(templateResult.reportTemplates || []);
      setInstances(instanceResult.reportInstances || []);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const canManage = can(user, 'REPORT_TEMPLATE_MANAGE');
  const canSubmit = can(user, 'REPORT_INSTANCE_SUBMIT');
  const canApprove = can(user, 'REPORT_INSTANCE_APPROVE');

  const act = async (path, body, message) => {
    try {
      await api(path, { method: 'POST', body });
      await load();
      notify(message);
    } catch (err) {
      notify(err.message || '操作未完成', 'error');
    }
  };

  const instanceFor = (templateId) => instances.find((row) => row.template_id === templateId) || null;

  const templateRows = useMemo(() => templates.map((template) => ({
    ...template,
    instance: instanceFor(template.id),
  })), [templates, instances]);

  return (
    <BusinessPageShell>
      <BusinessPageHeader
        title="报表平台"
        context="模板 · 行项目 · 期间实例 · 计算与审核"
        help={<HelpDisclosure summary="报表口径"><p>取数只允许白名单数据源（总账科目余额、凭证分录汇总、辅助项目余额、业务台账聚合），全部只读已过账账簿并绑定期间；公式使用本域自有受限文法，求值失败会在该行标记错误码，不会静默取 0。</p></HelpDisclosure>}
        primaryAction={canManage ? (
          <BusinessAction hierarchy="primary" onClick={() => setEditor({ mode: 'template' })}>新建报表模板</BusinessAction>
        ) : null}
        secondaryActions={[
          <span key="period" className="inline-actions">
            <input aria-label="报表期间" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
          </span>,
        ]}
      />
      {error ? <InlineAlert tone="danger" title="加载失败">{error}</InlineAlert> : null}
      <BusinessContentSection title="报表模板">
        <CompactRecordList data-testid="accounting-report-templates">
          {templateRows.map((template) => (
            <CompactRecord
              key={template.id}
              title={template.name}
              subtitle={`${template.template_code} · ${(template.items || []).length} 个报表项目`}
              status={<StatusChip status={template.status}>{TEMPLATE_STATUS_LABELS[template.status] || template.status}</StatusChip>}
              metadata={[
                { label: '版本', value: `v${template.version_no}` },
                { label: '状态', value: TEMPLATE_STATUS_LABELS[template.status] || template.status },
                { label: '期间实例', value: template.instance ? `${template.instance.period}（${INSTANCE_STATUS_LABELS[template.instance.status] || template.instance.status}）` : '未实例化' },
              ]}
              action={(
                <span className="inline-actions">
                  <BusinessAction onClick={() => setDetail(template)}>打开详情</BusinessAction>
                  {canManage && template.status === 'DRAFT' ? (
                    <BusinessAction onClick={() => act(`/api/accounting/report-templates/${template.id}/publish`, {}, '模板已发布')}>发布</BusinessAction>
                  ) : null}
                  {canSubmit && template.status === 'PUBLISHED' ? (
                    <BusinessAction onClick={() => act('/api/accounting/report-instances', { templateId: template.id, period }, '报表实例已建立')}>建立实例</BusinessAction>
                  ) : null}
                  {canSubmit && template.instance && template.instance.status === 'DRAFT' ? (
                    <BusinessAction onClick={() => act(`/api/accounting/report-instances/${template.instance.id}/compute`, {}, '报表已重算')}>重算</BusinessAction>
                  ) : null}
                  {canSubmit && template.instance && template.instance.status === 'DRAFT' ? (
                    <BusinessAction onClick={() => act(`/api/accounting/report-instances/${template.instance.id}/submit`, {}, '报表已提交')}>提交</BusinessAction>
                  ) : null}
                  {canApprove && template.instance && template.instance.status === 'SUBMITTED' ? (
                    <BusinessAction onClick={() => act(`/api/accounting/report-instances/${template.instance.id}/approve`, { approved: true }, '报表已审核')}>审核</BusinessAction>
                  ) : null}
                </span>
              )}
            />
          ))}
        </CompactRecordList>
        {!templateRows.length ? <Empty title="暂无报表模板" text="新建模板后可定义报表项目、取数来源与计算公式。" /> : null}
      </BusinessContentSection>
      {detail ? (
        <TemplateDetailSheet
          template={detail}
          period={period}
          onClose={() => setDetail(null)}
        />
      ) : null}
      {editor ? (
        <TemplateEditorSheet
          notify={notify}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); notify('报表模板已保存'); }}
        />
      ) : null}
    </BusinessPageShell>
  );
}

function TemplateDetailSheet({ template, period, onClose }) {
  const [values, setValues] = useState([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await api(`/api/accounting/report-templates/${template.id}/preview?period=${period}`);
        if (cancelled) return;
        setValues(result.preview?.items || []);
        setStatus(result.preview?.status || '');
      } catch {
        if (!cancelled) setValues([]);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [template.id, period]);

  return (
    <Modal title={`报表模板 ${template.name}`} onClose={onClose}>
      <BusinessContentSection title="报表项目">
        <CompactRecordList>
          {(template.items || []).map((item) => {
            const value = values.find((row) => row.itemCode === item.item_code);
            return (
              <CompactRecord
                key={item.id}
                title={item.name}
                subtitle={`${item.item_code} · ${SOURCE_KIND_LABELS[item.source_kind] || item.source_kind}`}
                metadata={[
                  { label: '层级 / 排序', value: `${item.level_no} / ${item.sort_no}` },
                  { label: '公式', value: item.formula_expr || '—' },
                  {
                    label: '取值',
                    value: value
                      ? (value.errorCode ? `失败：${value.errorCode}` : money(value.valueCents))
                      : '—',
                  },
                ]}
              />
            );
          })}
        </CompactRecordList>
        {status ? <p className="muted">试算状态：{status}</p> : null}
      </BusinessContentSection>
      <FormActions onClose={onClose} saveText="关闭" />
    </Modal>
  );
}

function TemplateEditorSheet({ notify, onClose, onSaved }) {
  const [form, setForm] = useState({
    templateCode: '', name: '', description: '', accountCode: '1403', measure: 'CLOSING',
  });
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/accounting/report-templates', {
        method: 'POST',
        body: {
          templateCode: form.templateCode.trim(),
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          items: [
            {
              itemCode: 'BALANCE_CLOSING',
              name: '期末余额',
              sourceKind: 'GL_BALANCE',
              sourceJson: { subjectCode: form.accountCode.trim(), measure: form.measure },
              sortNo: 1,
              levelNo: 1,
            },
          ],
        },
      });
      onSaved();
    } catch (error) {
      setBusy(false);
      notify(error.message, 'error');
    }
  };

  return (
    <Modal title="新建报表模板" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>
          模板编码
          <input aria-label="模板编码" value={form.templateCode} onChange={(event) => setForm({ ...form, templateCode: event.target.value })} required />
        </label>
        <label>
          模板名称
          <input aria-label="模板名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </label>
        <label className="full">
          说明
          <input aria-label="模板说明" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
        <label>
          会计科目
          <input aria-label="报表科目" value={form.accountCode} onChange={(event) => setForm({ ...form, accountCode: event.target.value })} />
        </label>
        <label>
          取数口径
          <select aria-label="取数口径" value={form.measure} onChange={(event) => setForm({ ...form, measure: event.target.value })}>
            <option value="CLOSING">期末余额</option>
            <option value="OPENING">期初余额</option>
            <option value="DEBIT">本期借方发生额</option>
            <option value="CREDIT">本期贷方发生额</option>
          </select>
        </label>
        <FormActions onClose={onClose} saveText={busy ? '保存中…' : '保存模板'} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AA-W6 — 存货核算深化
// ---------------------------------------------------------------------------

export function InventoryCosting({ user, notify }) {
  const [scopes, setScopes] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [provisionals, setProvisionals] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [allocationRules, setAllocationRules] = useState([]);
  const [checklist, setChecklist] = useState(null);
  const [asOfDate, setAsOfDate] = useState(currentPeriod() + '-01');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    try {
      const [scopeResult, profileResult, provisionalResult, expenseResult, ruleResult, checklistResult] = await Promise.all([
        api('/api/accounting/scopes'),
        api('/api/accounting/costing-profiles'),
        api('/api/accounting/provisional-receipts'),
        api('/api/purchase-expenses'),
        api('/api/purchase-expense-allocation-rules'),
        api(`/api/accounting/costing-close-checklist?asOfDate=${encodeURIComponent(asOfDate)}`).catch(() => null),
      ]);
      setScopes(scopeResult.accountingScopes || []);
      setProfiles(profileResult.costingProfiles || []);
      setProvisionals(provisionalResult.provisionalReceipts || []);
      setExpenses(expenseResult.purchaseExpenses || []);
      setAllocations(expenseResult.purchaseExpenseAllocations || []);
      setAllocationRules(ruleResult.purchaseExpenseAllocationRules || []);
      setChecklist(checklistResult);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, [asOfDate]);

  useEffect(() => { void load(); }, [load]);

  const canManage = can(user, 'INVENTORY_COST_MANAGE');

  return (
    <BusinessPageShell>
      <BusinessPageHeader
        title="存货核算"
        context="核算范围 · 计价方法 · 暂估 · 采购费用分摊 · 关账检查"
        help={<HelpDisclosure summary="核算与库存的边界"><p>本域不写库存数量，只负责核算口径：计价方法有确定性优先级，暂估入库必须有独立单据与暂估→正式差异调整凭证，采购费用分摊结果进入权威估值流水。核算关账在库存月结之后进行。</p></HelpDisclosure>}
        secondaryActions={[
          <span key="asOf" className="inline-actions">
            <input aria-label="核算截止日期" type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} />
          </span>,
        ]}
      />
      {error ? <InlineAlert tone="danger" title="加载失败">{error}</InlineAlert> : null}

      <BusinessContentSection title="核算范围与计价方法">
        <CompactRecordList data-testid="inventory-costing-profiles">
          {scopes.map((scope) => (
            <CompactRecord
              key={scope.id}
              title={scope.name}
              subtitle={`${scope.code} · 组织 ${scope.org_scope} / 所有者 ${scope.owner_scope}`}
              status={<StatusChip status={scope.status}>{scope.status === 'ACTIVE' ? '启用' : scope.status}</StatusChip>}
              metadata={[{ label: '核算范围 ID', value: scope.id }]}
            />
          ))}
          {profiles.map((profile) => (
            <CompactRecord
              key={profile.id}
              title={profile.product_id || profile.product_class || '默认计价方法'}
              subtitle={`${profile.valuation_method} · 优先级 ${profile.priority}`}
              status={<StatusChip status={profile.status}>{profile.status === 'ACTIVE' ? '启用' : profile.status}</StatusChip>}
              metadata={[
                { label: '适用类别', value: profile.product_class || '全部' },
                { label: '生效期间', value: `${profile.effective_from || '不限'} → ${profile.effective_to || '不限'}` },
              ]}
            />
          ))}
        </CompactRecordList>
        {!scopes.length && !profiles.length ? <Empty title="暂无核算范围与计价方法" text="计价方法按物料 / 类别 / 属性选择并有确定性优先级。" /> : null}
      </BusinessContentSection>

      <BusinessContentSection title="暂估入库">
        <CompactRecordList data-testid="inventory-costing-provisionals">
          {provisionals.map((row) => (
            <CompactRecord
              key={row.id}
              title={row.receipt_no}
              subtitle={`来源入库单 ${row.source_receipt_id} · ${row.basis}`}
              status={<StatusChip status={row.status}>{row.status === 'OPEN' ? '未结转' : row.status}</StatusChip>}
              metadata={[
                { label: '暂估金额', value: money(row.estimate_cents) },
                { label: '正式金额', value: row.adjustment ? money(row.adjustment.final_cents) : '未结转' },
                { label: '差异', value: row.adjustment ? money(row.adjustment.difference_cents) : '—' },
                { label: '差异原因', value: row.adjustment?.reason || '—' },
                { label: '结转时间', value: row.converted_at || '未结转' },
              ]}
              action={canManage && row.status === 'OPEN' ? (
                <BusinessAction onClick={() => setEditor({ mode: 'provisional', receipt: row })}>结转正式并调整差异</BusinessAction>
              ) : null}
            />
          ))}
        </CompactRecordList>
        {!provisionals.length ? <Empty title="暂无暂估入库单" text="暂估入库必须有独立单据，并形成暂估→正式的差异调整凭证。" /> : null}
      </BusinessContentSection>

      <BusinessContentSection title="采购费用与分摊">
        <CompactRecordList data-testid="inventory-costing-expenses">
          {expenses.map((row) => (
            <CompactRecord
              key={row.id}
              title={row.expense_no}
              subtitle={`${row.expense_type} · ${money(row.amount_cents)}`}
              status={<StatusChip status={row.status}>{row.status === 'REGISTERED' ? '已登记' : row.status}</StatusChip>}
              metadata={[{ label: '发生日期', value: row.incurred_date }]}
              action={canManage && row.status === 'REGISTERED' ? (
                <BusinessAction onClick={() => setEditor({ mode: 'expense', expense: row })}>分摊到存货价值</BusinessAction>
              ) : null}
            />
          ))}
          {allocationRules.map((rule) => (
            <CompactRecord
              key={rule.id}
              title={rule.name}
              subtitle={`${rule.code} · ${rule.basis_type}`}
              status={<StatusChip status={rule.status}>{rule.status === 'ACTIVE' ? '启用' : rule.status}</StatusChip>}
            />
          ))}
        </CompactRecordList>
        {!expenses.length && !allocationRules.length ? <Empty title="暂无采购费用与分摊规则" text="运费等采购费用必须可归集、按规则分摊到存货价值，并形成可审计的分摊结果。" /> : null}
        {allocations.length ? (
          <p className="muted">已产生 {allocations.length} 条分摊结果，进入权威估值流水。</p>
        ) : null}
      </BusinessContentSection>

      <BusinessContentSection title="核算关账检查">
        <CompactRecordList data-testid="inventory-costing-close-checklist">
          {(checklist?.checklist || []).map((entry) => (
            <CompactRecord
              key={entry.code}
              title={entry.code}
              subtitle={entry.message}
              status={<StatusChip status={entry.severity}>{COSTING_SEVERITY_LABELS[entry.severity] || entry.severity}</StatusChip>}
              metadata={[{ label: '影响记录', value: (entry.records || []).length }]}
            />
          ))}
        </CompactRecordList>
        {!(checklist?.checklist || []).length ? <Empty title="暂无检查项" text="核算关账检查清单会列出暂估未结转、未过账成本调整等异常，并给出可定位的原因。" /> : null}
        {checklist ? (
          <p className="muted">阻断项 {checklist.blockingCount || 0} 项，警告项 {checklist.warningCount || 0} 项。</p>
        ) : null}
      </BusinessContentSection>

      {editor ? (
        <CostingEditorSheet
          value={editor}
          allocationRules={allocationRules}
          notify={notify}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); notify('存货核算资料已保存'); }}
        />
      ) : null}
    </BusinessPageShell>
  );
}

const COSTING_SEVERITY_LABELS = { OK: '通过', BLOCKING: '阻断', WARNING: '警告', INFO: '提示' };

function CostingEditorSheet({ value, allocationRules, notify, onClose, onSaved }) {
  const isProvisional = value.mode === 'provisional';
  const [form, setForm] = useState({
    finalCents: '',
    reason: '',
    ruleId: allocationRules[0]?.id || '',
    businessDate: new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (isProvisional) {
        await api(`/api/accounting/provisional-receipts/${value.receipt.id}/adjust`, {
          method: 'POST',
          body: {
            finalCents: Number(form.finalCents || 0),
            reason: form.reason.trim(),
            businessDate: form.businessDate || undefined,
          },
        });
      } else {
        await api(`/api/purchase-expenses/${value.expense.id}/allocate`, {
          method: 'POST',
          body: { ruleId: form.ruleId, businessDate: form.businessDate || undefined },
        });
      }
      onSaved();
    } catch (error) {
      setBusy(false);
      notify(error.message, 'error');
    }
  };

  return (
    <Modal title={isProvisional ? '暂估差异调整' : '采购费用分摊'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        {isProvisional ? (
          <>
            <label>
              正式金额（分）
              <input aria-label="正式金额" type="number" step="1" value={form.finalCents} onChange={(event) => setForm({ ...form, finalCents: event.target.value })} required />
            </label>
            <label>
              业务日期
              <input aria-label="业务日期" type="date" value={form.businessDate} onChange={(event) => setForm({ ...form, businessDate: event.target.value })} />
            </label>
            <label className="full">
              差异原因
              <input aria-label="差异原因" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} required />
            </label>
          </>
        ) : (
          <>
            <label className="full">
              分摊规则
              <select aria-label="分摊规则" value={form.ruleId} onChange={(event) => setForm({ ...form, ruleId: event.target.value })} required>
                {allocationRules.map((rule) => (
                  <option key={rule.id} value={rule.id}>{rule.code} · {rule.name} · {rule.basis_type}</option>
                ))}
              </select>
            </label>
            <label>
              业务日期
              <input aria-label="业务日期" type="date" value={form.businessDate} onChange={(event) => setForm({ ...form, businessDate: event.target.value })} />
            </label>
          </>
        )}
        <FormActions onClose={onClose} saveText={busy ? '提交中…' : '提交'} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AA-W7 — 经营会计
// ---------------------------------------------------------------------------

const CLOSURE_STATUS_LABELS = { OPEN: '未关闭', CLOSED: '已关闭' };

export function ManagementAccounting({ user, notify }) {
  const [books, setBooks] = useState([]);
  const [centers, setCenters] = useState([]);
  const [prices, setPrices] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [rules, setRules] = useState([]);
  const [closures, setClosures] = useState([]);
  const [profitLoss, setProfitLoss] = useState(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [bookId, setBookId] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    try {
      const [bookResult, priceResult, ruleResult, closureResult] = await Promise.all([
        api('/api/management/books'),
        api('/api/management/internal-prices').catch(() => ({ internalSettlementPrices: [] })),
        api('/api/management/allocation-rules').catch(() => ({ allocationRules: [] })),
        api('/api/management/period-closures').catch(() => ({ operatingPeriodClosures: [] })),
      ]);
      setBooks(bookResult.managementBooks || []);
      setCenters(bookResult.profitCenters || []);
      setPrices(priceResult.internalSettlementPrices || []);
      setRules(ruleResult.allocationRules || []);
      setClosures(closureResult.operatingPeriodClosures || []);
      if (!bookId && (bookResult.managementBooks || []).length) {
        setBookId(bookResult.managementBooks[0].id);
      }
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, [bookId]);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPeriod = async () => {
      try {
        const params = new URLSearchParams({ period });
        if (bookId) params.set('managementBookId', bookId);
        const [ledgerResult, result] = await Promise.all([
          api(`/api/management/ledger?${params.toString()}`),
          api(`/api/management/profit-loss?${params.toString()}`).catch(() => null),
        ]);
        if (cancelled) return;
        setLedger(ledgerResult.operatingLedgerEntries || []);
        setProfitLoss(result);
      } catch {
        if (!cancelled) setLedger([]);
      }
    };
    void loadPeriod();
    return () => { cancelled = true; };
  }, [period, bookId]);

  const canManage = can(user, 'MANAGEMENT_ACCOUNTING_MANAGE');

  const act = async (path, body, message) => {
    try {
      await api(path, { method: 'POST', body });
      await load();
      notify(message);
    } catch (err) {
      notify(err.message || '操作未完成', 'error');
    }
  };

  const bookRows = useMemo(() => books.map((book) => ({
    ...book,
    centers: centers.filter((center) => center.management_book_id === book.id),
  })), [books, centers]);

  const closureFor = (periodKey) => closures.find((row) => row.period === periodKey) || null;

  return (
    <BusinessPageShell>
      <BusinessPageHeader
        title="经营会计"
        context="经营账簿 · 经营单元 · 内部结算 · 台账归集 · 费用分摊 · 经营损益 · 经营关账"
        help={<HelpDisclosure summary="经营损益如何与法定损益勾稽"><p>经营损益 = 经营收入 − 内部转移成本 − 分摊费用。页面同时给出与法定损益的差额，并把它显式拆成未分配、内部交易抵消与口径差异三段；存在无法解释的差额时不得关账。</p></HelpDisclosure>}
        primaryAction={canManage ? (
          <BusinessAction hierarchy="primary" onClick={() => setEditor({ mode: 'book' })}>新建经营账簿</BusinessAction>
        ) : null}
        secondaryActions={[
          <span key="period" className="inline-actions">
            <input aria-label="经营期间" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
          </span>,
          <select key="book" aria-label="经营账簿" value={bookId} onChange={(event) => setBookId(event.target.value)}>
            <option value="">全部账簿</option>
            {books.map((book) => (<option key={book.id} value={book.id}>{book.name}</option>))}
          </select>,
        ]}
      />
      {error ? <InlineAlert tone="danger" title="加载失败">{error}</InlineAlert> : null}

      <BusinessContentSection title="经营账簿与经营单元">
        <CompactRecordList data-testid="management-books">
          {bookRows.map((book) => (
            <CompactRecord
              key={book.id}
              title={book.name}
              subtitle={`${book.code} · ${book.legal_entity}`}
              status={<StatusChip status={book.status}>{book.status === 'CLOSED' ? '已关闭' : '启用中'}</StatusChip>}
              metadata={[
                { label: '经营单元', value: `${book.centers.length} 个` },
                { label: '本位币', value: book.base_currency },
                { label: '期间状态', value: closureFor(period)?.status === 'CLOSED' ? '已关闭' : '未关闭' },
              ]}
              action={canManage ? (
                <span className="inline-actions">
                  <BusinessAction onClick={() => setEditor({ mode: 'center', bookId: book.id })}>新增经营单元</BusinessAction>
                  <BusinessAction onClick={() => act('/api/management/collect', { managementBookId: book.id, period }, '经营台账已归集')}>归集台账</BusinessAction>
                  {rules.length ? (
                    <BusinessAction onClick={() => act('/api/management/allocation-runs', { managementBookId: book.id, period, ruleId: rules[0].id }, '费用分摊已执行')}>执行分摊</BusinessAction>
                  ) : null}
                  <BusinessAction onClick={() => act('/api/management/period-closures', { managementBookId: book.id, period }, '经营期间已关闭')}>经营关账</BusinessAction>
                </span>
              ) : null}
            />
          ))}
        </CompactRecordList>
        {!bookRows.length ? <Empty title="暂无经营账簿" text="经营账簿是经营会计的隔离边界：一个法人可以有多个经营账簿。" /> : null}
      </BusinessContentSection>

      {profitLoss ? (
        <BusinessContentSection title="经营损益与法定损益勾稽">
          <CompactRecordList data-testid="management-profit-loss">
            <CompactRecord
              title={`经营利润 ${money(profitLoss.operatingProfitCents)}`}
              subtitle={`经营收入 ${money(profitLoss.revenueCents)} · 内部转移 ${money(profitLoss.internalTransferCents)} · 分摊费用 ${money(profitLoss.allocatedExpenseCents)}`}
              metadata={[
                { label: '法定损益', value: money(profitLoss.legalProfitCents) },
                { label: '差额', value: money(profitLoss.differenceCents) },
                { label: '差额是否可解释', value: profitLoss.explained ? '是' : '否' },
              ]}
            />
            {(profitLoss.reconciliations || []).map((row) => (
              <CompactRecord
                key={row.code}
                title={row.label}
                subtitle={row.code}
                metadata={[{ label: '金额', value: money(row.amountCents) }]}
              />
            ))}
          </CompactRecordList>
        </BusinessContentSection>
      ) : null}

      <BusinessContentSection title="经营台账">
        <CompactRecordList data-testid="management-ledger">
          {ledger.slice(0, 50).map((entry) => (
            <CompactRecord
              key={entry.id}
              title={`${entry.account_code} ${Number(entry.debit_cents) - Number(entry.credit_cents) >= 0 ? '借' : '贷'}`}
              subtitle={`${entry.source_kind} · ${entry.source_id || ''}`}
              metadata={[
                { label: '借方', value: money(entry.debit_cents) },
                { label: '贷方', value: money(entry.credit_cents) },
                { label: '业务日期', value: entry.business_date },
              ]}
            />
          ))}
        </CompactRecordList>
        {!ledger.length ? <Empty title="该期间尚无经营台账" text="归集只取已过账事实；同一来源事实重复归集不会重复入账。" /> : null}
      </BusinessContentSection>

      <BusinessContentSection title="内部结算价格与分摊规则">
        <CompactRecordList>
          {prices.map((price) => (
            <CompactRecord
              key={price.id}
              title={price.product_id}
              subtitle={`${money(price.price_cents)} · ${price.valid_from} → ${price.valid_to || '长期'}`}
            />
          ))}
          {rules.map((rule) => (
            <CompactRecord
              key={rule.id}
              title={rule.name}
              subtitle={`${rule.code} · ${rule.basis_type}`}
            />
          ))}
        </CompactRecordList>
        {!prices.length && !rules.length ? <Empty title="暂无内部结算价与分摊规则" text="内部结算价与分摊规则决定经营口径的计量与费用归属。" /> : null}
      </BusinessContentSection>

      <BusinessContentSection title="经营期间关账">
        <CompactRecordList data-testid="management-period-closures">
          {closures.map((row) => (
            <CompactRecord
              key={row.id}
              title={`${row.period} · ${CLOSURE_STATUS_LABELS[row.status] || row.status}`}
              subtitle={row.management_book_id || ''}
              status={<StatusChip status={row.status}>{CLOSURE_STATUS_LABELS[row.status] || row.status}</StatusChip>}
              metadata={[{ label: '关账时间', value: row.closed_at || '—' }]}
              action={canManage && row.status === 'CLOSED' ? (
                <BusinessAction onClick={() => act(`/api/management/period-closures/${row.id}/reopen`, {}, '经营期间已反结账')}>受控反结账</BusinessAction>
              ) : null}
            />
          ))}
        </CompactRecordList>
        {!closures.length ? <Empty title="暂无经营期间关账记录" text="经营关账前必须完成台账归集与费用分摊，且差额必须可解释。" /> : null}
      </BusinessContentSection>

      {editor ? (
        <ManagementEditorSheet
          value={editor}
          notify={notify}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); notify('经营会计资料已保存'); }}
        />
      ) : null}
    </BusinessPageShell>
  );
}

function ManagementEditorSheet({ value, notify, onClose, onSaved }) {
  const [form, setForm] = useState({
    code: '', name: '', legalEntity: '', orgUnit: '', managementBookId: value.bookId || '',
  });
  const [busy, setBusy] = useState(false);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (value.mode === 'center') {
        await api('/api/management/profit-centers', {
          method: 'POST',
          body: {
            code: form.code.trim(),
            name: form.name.trim(),
            managementBookId: form.managementBookId,
            orgUnit: form.orgUnit.trim() || undefined,
          },
        });
      } else {
        await api('/api/management/books', {
          method: 'POST',
          body: {
            code: form.code.trim(),
            name: form.name.trim(),
            legalEntity: form.legalEntity.trim(),
          },
        });
      }
      onSaved();
    } catch (error) {
      setBusy(false);
      notify(error.message, 'error');
    }
  };

  return (
    <Modal title={value.mode === 'center' ? '新增经营单元' : '新建经营账簿'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>
          编码
          <input aria-label="编码" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required />
        </label>
        <label>
          名称
          <input aria-label="名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </label>
        {value.mode === 'center' ? (
          <>
            <label>
              所属经营账簿
              <input aria-label="所属经营账簿" value={form.managementBookId} onChange={(event) => setForm({ ...form, managementBookId: event.target.value })} required />
            </label>
            <label>
              组织单元
              <input aria-label="组织单元" value={form.orgUnit} onChange={(event) => setForm({ ...form, orgUnit: event.target.value })} />
            </label>
          </>
        ) : (
          <label className="full">
            法人主体
            <input aria-label="法人主体" value={form.legalEntity} onChange={(event) => setForm({ ...form, legalEntity: event.target.value })} required />
          </label>
        )}
        <FormActions onClose={onClose} saveText={busy ? '保存中…' : '保存'} />
      </form>
    </Modal>
  );
}
