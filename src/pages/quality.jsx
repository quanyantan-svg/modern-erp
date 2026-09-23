import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Empty, Loading, Modal, Panel, Toolbar, can } from '../components/ui.jsx';

const STATUS_LABEL = { DRAFT: '草稿', PENDING: '旧版待检验', COMPLETED: '已完成', CANCELLED: '已取消' };
const RESULT_LABEL = { PASS: '合格', FAIL: '不合格' };
const DISPOSITIONS = { iqc: [['HOLD', '暂扣'], ['REWORK', '返工'], ['REJECT_TO_SUPPLIER', '退供应商']], oqc: [['HOLD', '暂扣'], ['REWORK', '返工'], ['SCRAP_REVIEW', '报废评审']] };
const badge = (status, result) => result === 'FAIL' || status === 'CANCELLED' ? 'danger' : result === 'PASS' || status === 'COMPLETED' ? 'success' : 'draft';

function QualityPage({ user, notify, kind }) {
  const upper = kind.toUpperCase();
  const partyField = kind === 'iqc' ? 'supplier_name' : 'customer_name';
  const [items, setItems] = useState([]); const [status, setStatus] = useState(''); const [selected, setSelected] = useState(null); const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); api(`/api/${kind}${status ? `?status=${status}` : ''}`).then((data) => setItems(data.inspections || [])).catch((error) => notify(error.message, 'error')).finally(() => setLoading(false)); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);
  const open = (id) => api(`/api/${kind}/${id}`).then((data) => setSelected(data.inspection)).catch((error) => notify(error.message, 'error'));
  return <Panel title={`${upper} ${kind === 'iqc' ? '来料检验' : '出货检验'}`}>
    <Toolbar action={<span className="muted">请从{kind === 'iqc' ? '采购入库草稿' : '销售出库草稿'}创建检验单</span>}/>
    <div className="filters"><label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="DRAFT">草稿</option><option value="COMPLETED">已完成</option><option value="CANCELLED">已取消</option></select></label></div>
    <div className="table-wrap"><table><thead><tr><th>检验单号</th><th>来源单据</th><th>{kind === 'iqc' ? '供应商' : '客户'}</th><th>检验员</th><th>送检数量</th><th>状态</th><th>结果</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td className="mono">{item[`${kind}_no`]}</td><td>{item.authoritative ? item.source_document_no : <Badge type="danger">旧版 / 未关联</Badge>}</td><td>{item[partyField]}</td><td>{item.inspector_name || '—'}</td><td>{item.total_quantity}</td><td><Badge type={badge(item.status, item.result)}>{STATUS_LABEL[item.status] || item.status}</Badge></td><td>{item.result ? <Badge type={badge(item.status, item.result)}>{RESULT_LABEL[item.result]}</Badge> : '—'}</td><td><button className="row-action" onClick={() => open(item.id)}>查看</button></td></tr>)}
    </tbody></table>{loading ? <Loading/> : !items.length && <Empty text="暂无检验记录"/>}</div>
    {selected && <QualityModal
      kind={kind}
      inspection={selected}
      canManage={can(user, `${upper}_MANAGE`)}
      notify={notify}
      onClose={() => { setSelected(null); load(); }}
    />}
  </Panel>;
}

function QualityModal({ kind, inspection, canManage, notify, onClose }) {
  const isDraft = ['DRAFT', 'PENDING'].includes(inspection.status) && inspection.authoritative;
  const [form, setForm] = useState({ inspection_date: inspection.inspection_date || new Date().toISOString().slice(0, 10), inspection_type: inspection.inspection_type || 'NORMAL', sample_quantity: inspection.sample_quantity || inspection.total_quantity, passed_quantity: inspection.qualified_quantity || 0, failed_quantity: inspection.reject_quantity || 0, result: inspection.result || 'PASS', defect_reason: inspection.defect_reason || '', disposition: inspection.disposition || '', remark: inspection.remark || '' });
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const save = async () => { try { await api(`/api/${kind}/${inspection.id}`, { method: 'PATCH', body: form }); notify('检验信息已保存'); onClose(); } catch (error) { notify(error.message, 'error'); } };
  const complete = async () => { try { await api(`/api/${kind}/${inspection.id}/complete`, { method: 'POST', body: { ...form, inspection_quantity: inspection.total_quantity } }); notify(form.result === 'PASS' ? '检验已完成：合格' : '检验已完成：不合格'); onClose(); } catch (error) { notify(error.message, 'error'); } };
  const cancel = async () => { try { await api(`/api/${kind}/${inspection.id}/cancel`, { method: 'POST', body: {} }); notify('检验草稿已取消'); onClose(); } catch (error) { notify(error.message, 'error'); } };
  return <Modal title={`${kind.toUpperCase()} 检验单 ${inspection[`${kind}_no`]}`} onClose={onClose} wide>
    {!inspection.authoritative && <div className="notice danger">LEGACY / UNLINKED INSPECTION（旧版未关联检验，仅供读取，不能满足质量门禁）</div>}
    <div className="detail-grid"><div><span>来源订单</span><strong className="mono">{inspection.source_order_no || '—'}</strong></div><div><span>来源单据</span><strong className="mono">{inspection.source_document_no || '未关联'}</strong></div><div><span>状态</span><strong>{STATUS_LABEL[inspection.status] || inspection.status}</strong></div><div><span>{kind === 'iqc' ? '供应商' : '客户'}</span><strong>{inspection.supplier_name || inspection.customer_name}</strong></div><div><span>仓库</span><strong>{inspection.source_warehouse_code ? `${inspection.source_warehouse_code} - ${inspection.source_warehouse_name}` : '—'}</strong></div><div><span>{kind === 'iqc' ? '收货日期' : '发货日期'}</span><strong>{inspection.source_business_date || '—'}</strong></div><div><span>检验员</span><strong>{inspection.inspector_name || '—'}</strong></div></div>
    <h4>来源明细（只读）</h4><table className="line-table"><thead><tr><th>产品</th><th>规格</th><th>数量</th><th>仓库</th><th>批次</th></tr></thead><tbody>{inspection.items.map((item) => <tr key={item.id}><td>{item.product_code} - {item.product_name}</td><td>{item.specification || '—'}</td><td>{item.snapshot_quantity ?? item.quantity} {item.unit}</td><td>{item.snapshot_warehouse_id || '—'}</td><td>{item.snapshot_batch_no || '—'}</td></tr>)}</tbody></table>
    <h4>检验信息</h4><div className="form-grid">
      <label>检验日期<input type="date" disabled={!isDraft} value={form.inspection_date} onChange={(e) => set('inspection_date', e.target.value)}/></label><label>检验类型<select disabled={!isDraft} value={form.inspection_type} onChange={(e) => set('inspection_type', e.target.value)}><option value="NORMAL">常规</option><option value="SAMPLING">抽样</option><option value="FULL">全检</option></select></label><label>抽样数量<input type="number" min="0" disabled={!isDraft} value={form.sample_quantity} onChange={(e) => set('sample_quantity', Number(e.target.value))}/></label><label>检验结果<select disabled={!isDraft} value={form.result} onChange={(e) => set('result', e.target.value)}><option value="PASS">合格</option><option value="FAIL">不合格</option></select></label><label>合格数量<input type="number" min="0" disabled={!isDraft} value={form.passed_quantity} onChange={(e) => set('passed_quantity', Number(e.target.value))}/></label><label>不合格数量<input type="number" min="0" disabled={!isDraft} value={form.failed_quantity} onChange={(e) => set('failed_quantity', Number(e.target.value))}/></label>
      {form.result === 'FAIL' && <><label className="full">缺陷原因<input disabled={!isDraft} value={form.defect_reason} onChange={(e) => set('defect_reason', e.target.value)}/></label><label>处置方式<select disabled={!isDraft} value={form.disposition} onChange={(e) => set('disposition', e.target.value)}><option value="">请选择</option>{DISPOSITIONS[kind].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>}
      <label className="full">备注<input disabled={!isDraft} value={form.remark} onChange={(e) => set('remark', e.target.value)}/></label>
    </div><div className="form-actions"><button type="button" className="secondary" onClick={onClose}>关闭</button>{isDraft && canManage && <><button type="button" className="danger-button" onClick={cancel}>取消检验</button><button type="button" className="secondary" onClick={save}>保存</button><button type="button" className="approve-button" onClick={complete}>完成检验</button></>}</div>
  </Modal>;
}

export function IQCInspections(props) { return <QualityPage {...props} kind="iqc"/>; }
export function OQCInspections(props) { return <QualityPage {...props} kind="oqc"/>; }
