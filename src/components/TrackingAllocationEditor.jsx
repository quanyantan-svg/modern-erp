import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { trackingPolicyOf, trackingPresentation } from '../lib/tracking.js';

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export default function TrackingAllocationEditor({ product, warehouseId, quantity, businessDate, direction = 'OUT', value = [], sourceAllocations = [], onChange, notify }) {
  const policy = trackingPolicyOf(product);
  const presentation = trackingPresentation(policy);
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);
  const inbound = direction !== 'OUT';
  const returning = direction === 'RETURN_IN';

  useEffect(() => {
    if (policy === 'NONE' || inbound || !product?.id || !warehouseId) { setAvailability(null); return; }
    let current = true;
    setLoading(true);
    const params = new URLSearchParams({ productId: product.id, warehouseId, businessDate: businessDate || new Date().toISOString().slice(0, 10) });
    api(`/api/tracking/availability?${params}`).then((result) => { if (current) setAvailability(result); }).catch((error) => notify?.(error.message, 'error')).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [policy, inbound, product?.id, warehouseId, businessDate]);

  const allocated = useMemo(() => value.reduce((sum, row) => sum + number(row.quantity || 1), 0), [value]);
  if (policy === 'NONE') return null;

  const setRows = (rows) => onChange?.(rows);
  const update = (index, patch) => setRows(value.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const remove = (index) => setRows(value.filter((_, rowIndex) => rowIndex !== index));
  const addLot = () => setRows([...value, { lotId: null, lotCode: '', quantity: '', manufactureDate: '', expiryDate: '', supplierLotReference: '' }]);

  const serialText = value.map((row) => row.serialNumber || '').filter(Boolean).join('\n');
  const setInboundSerials = (text) => setRows(text.split(/[\n,;\s]+/).map((serialNumber) => serialNumber.trim()).filter(Boolean).map((serialNumber) => ({ serialNumber, quantity: 1 })));
  const toggleSerial = (serial, checked) => setRows(checked
    ? [...value, { serialId: serial.id, serialNumber: serial.serial_number, quantity: 1 }]
    : value.filter((row) => row.serialId !== serial.id));

  return <section className="tracking-editor" aria-label={`${presentation.shortLabel}分配`}>
    <header><div><strong>库存跟踪 · {presentation.shortLabel}</strong><small>{inbound ? '请录入本次将创建或接收的身份' : '只能选择当前仓库可用身份'}</small></div><span className={allocated === number(quantity) ? 'tracking-count complete' : 'tracking-count'}>已分配 {allocated} / {number(quantity)}</span></header>
    {loading && <p className="dim">正在载入可用身份…</p>}
    {policy === 'LOT' && returning && <div className="tracking-lot-list">
      {sourceAllocations.map((lot) => <div className="tracking-lot-row" key={lot.lotId || lot.lotCode}>
        <label className="tracking-source-lot"><input type="checkbox" checked={value.some((row) => row.lotId === lot.lotId)} onChange={(event) => setRows(event.target.checked ? [...value, { lotId: lot.lotId, lotCode: lot.lotCode, quantity: lot.quantity }] : value.filter((row) => row.lotId !== lot.lotId))}/><span>{lot.lotCode}</span></label>
        <input aria-label="退回批次数量" type="number" min="0.01" max={lot.quantity} step="0.01" disabled={!value.some((row) => row.lotId === lot.lotId)} value={value.find((row) => row.lotId === lot.lotId)?.quantity ?? ''} onChange={(event) => setRows(value.map((row) => row.lotId === lot.lotId ? { ...row, quantity: event.target.value } : row))}/>
        <small>原单 {lot.quantity}</small>
      </div>)}
    </div>}
    {policy === 'LOT' && !returning && <div className="tracking-lot-list">
      {value.map((row, index) => <div className="tracking-lot-row" key={`${row.lotId || row.lotCode}-${index}`}>
        {inbound ? <input aria-label="批次号" value={row.lotCode || ''} onChange={(event) => update(index, { lotCode: event.target.value, lotId: null })} placeholder="批次号"/>
          : <select aria-label="选择批次" value={row.lotId || ''} onChange={(event) => { const lot = availability?.lots?.find((item) => item.id === event.target.value); update(index, { lotId: event.target.value, lotCode: lot?.lot_code || '' }); }}><option value="">选择可用批次</option>{(availability?.lots || []).map((lot) => <option key={lot.id} value={lot.id}>{lot.lot_code} · 可用 {lot.available_quantity}</option>)}</select>}
        <input aria-label="批次数量" type="number" min="0.01" step="0.01" value={row.quantity ?? ''} onChange={(event) => update(index, { quantity: event.target.value })} placeholder="数量"/>
        {inbound && <input aria-label="生产日期" type="date" value={row.manufactureDate || ''} onChange={(event) => update(index, { manufactureDate: event.target.value })}/>}
        <button type="button" className="remove" onClick={() => remove(index)}>×</button>
      </div>)}
      <button type="button" className="secondary" onClick={addLot}>＋ 添加批次</button>
      {!inbound && availability && <small>当前仓库可用：{availability.availableQuantity}</small>}
    </div>}
    {policy === 'SERIAL' && inbound && !returning && <label className="tracking-serial-entry">序列号（每行一个，也可粘贴逗号分隔内容）<textarea value={serialText} onChange={(event) => setInboundSerials(event.target.value)} rows={Math.min(6, Math.max(3, number(quantity)))}/></label>}
    {policy === 'SERIAL' && returning && <div className="tracking-serial-list">{sourceAllocations.map((serial) => <label key={serial.serialId} className="tracking-serial-option"><input type="checkbox" checked={value.some((row) => row.serialId === serial.serialId)} onChange={(event) => toggleSerial({ id: serial.serialId, serial_number: serial.serialNumber }, event.target.checked)}/><span>{serial.serialNumber}</span><small>原单身份</small></label>)}</div>}
    {policy === 'SERIAL' && !inbound && <div className="tracking-serial-list">{(availability?.serials || []).map((serial) => <label key={serial.id} className={serial.available ? 'tracking-serial-option' : 'tracking-serial-option disabled'}><input type="checkbox" disabled={!serial.available} checked={value.some((row) => row.serialId === serial.id)} onChange={(event) => toggleSerial(serial, event.target.checked)}/><span>{serial.serial_number}</span><small>{serial.lifecycle_state}</small></label>)}{availability && !(availability.serials || []).length && <p className="dim">当前仓库没有序列号身份。</p>}</div>}
  </section>;
}
