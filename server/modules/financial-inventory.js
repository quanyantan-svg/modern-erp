import { id } from '../db.js';
import { HttpError, allowAny, send } from '../lib/http.js';

const EPS = 1e-9;
export const VALUATION_BY_TRACKING = Object.freeze({ NONE: 'MOVING_AVERAGE', LOT: 'LOT_SPECIFIC_POOL', SERIAL: 'SPECIFIC_SERIAL' });

function nextPeriodKey(period) {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function closedThrough(rows, key) {
  const periods = rows.map((row) => row[key]).filter(Boolean).sort();
  if (!periods.length) return null;
  let cutoff = periods[0];
  for (let index = 1; index < periods.length; index += 1) {
    if (periods[index] !== nextPeriodKey(cutoff)) break;
    cutoff = periods[index];
  }
  return cutoff;
}

export function assertFinancialPeriodsOpen(db, businessDate) {
  const date = String(businessDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, '业务日期格式不正确');
  const inventoryCutoff = closedThrough(db.prepare("SELECT period_key FROM inventory_period_closures WHERE status='CLOSED' ORDER BY period_key").all(), 'period_key');
  if (inventoryCutoff && date <= `${inventoryCutoff}-31`) {
    throw new HttpError(409, `存货期间已结至 ${inventoryCutoff}`, {
      code: 'INVENTORY_PERIOD_CLOSED',
      resolution: '使用未结期间的业务日期，或先按治理流程反结账。',
    });
  }
  const accountingCutoff = closedThrough(db.prepare("SELECT period FROM period_closures WHERE status='CLOSED' ORDER BY period").all(), 'period');
  if (accountingCutoff && date <= `${accountingCutoff}-31`) {
    throw new HttpError(409, `会计期间已结至 ${accountingCutoff}`, {
      code: 'FINANCIAL_PERIOD_CLOSED',
      resolution: '使用未结期间的业务日期，或先按治理流程反结账。',
    });
  }
}

export function valuationMethod(db, productId) {
  const product = db.prepare('SELECT tracking_policy,valuation_method FROM products WHERE id=?').get(productId);
  if (!product) throw new HttpError(404, '货品不存在');
  const expected = VALUATION_BY_TRACKING[product.tracking_policy];
  if (!expected || product.valuation_method !== expected) throw new HttpError(409, '货品追踪策略与财务估值方法不兼容');
  return expected;
}

export function changeValuationMethod(db, productId, nextMethod) {
  const product = db.prepare('SELECT tracking_policy,valuation_method FROM products WHERE id=?').get(productId);
  if (!product) throw new HttpError(404, '货品不存在');
  const expected = VALUATION_BY_TRACKING[product.tracking_policy];
  if (nextMethod !== expected) throw new HttpError(409, '估值方法必须与追踪策略匹配');
  if (nextMethod !== product.valuation_method && db.prepare("SELECT 1 FROM inventory_valuation_movements WHERE product_id=? AND status='POSTED' LIMIT 1").get(productId)) throw new HttpError(409, '已有财务估值移动，估值方法不可变更');
  db.prepare('UPDATE products SET valuation_method=? WHERE id=?').run(nextMethod, productId);
}

function balanceKey(method, productId, warehouseId, lotId, serialId) {
  if (method === 'LOT_SPECIFIC_POOL') { if (!lotId) throw new HttpError(409, '批次估值必须指定批次'); return `LOT:${warehouseId}:${productId}:${lotId}`; }
  if (method === 'SPECIFIC_SERIAL') { if (!serialId) throw new HttpError(409, '序列号估值必须指定序列号'); return `SERIAL:${serialId}`; }
  return `NONE:${warehouseId}:${productId}`;
}

export function allocateProportionalCents(valueCents, issueQuantity, poolQuantity) {
  if (!Number.isSafeInteger(valueCents) || valueCents < 0 || !Number.isFinite(issueQuantity) || issueQuantity <= 0 || !Number.isFinite(poolQuantity) || poolQuantity <= 0 || issueQuantity > poolQuantity + EPS) throw new HttpError(409, '估值分摊参数无效');
  if (Math.abs(issueQuantity - poolQuantity) <= EPS) return valueCents;
  return Math.floor((valueCents * issueQuantity / poolQuantity) + 0.5);
}

function getBalance(db, input) {
  const method = valuationMethod(db, input.productId);
  const key = balanceKey(method, input.productId, input.warehouseId, input.lotId, input.serialId);
  return { method, key, row: db.prepare('SELECT * FROM inventory_valuation_balances WHERE balance_key=?').get(key) };
}

function writeMovement(db, input, quantityDelta, valueDeltaCents, method, key) {
  const now = input.createdAt || new Date().toISOString();
  const movementId = input.id || id();
  const unit = Math.abs(quantityDelta) > EPS ? Math.round(Math.abs(valueDeltaCents / quantityDelta)) : null;
  db.prepare(`INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,lot_id,serial_id,quantity_delta,value_delta_cents,unit_cost_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,inventory_transaction_id,production_order_id,reversal_of_id,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'POSTED',?)`).run(movementId,input.businessDate,input.productId,input.warehouseId,input.lotId||null,input.serialId||null,quantityDelta,valueDeltaCents,unit,input.valuationBasis||method,input.movementType,input.sourceType,input.sourceId,input.sourceItemId||input.sourceId,input.inventoryTransactionId||null,input.productionOrderId||null,input.reversalOfId||null,now);
  const row = db.prepare('SELECT * FROM inventory_valuation_balances WHERE balance_key=?').get(key);
  const quantity = Number(row?.quantity || 0) + quantityDelta;
  const value = Number(row?.value_cents || 0) + valueDeltaCents;
  if (quantity < -EPS || value < 0 || (Math.abs(quantity) <= EPS && value !== 0)) throw new HttpError(409, '估值余额将产生负数或零数量残值');
  db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(balance_key) DO UPDATE SET quantity=excluded.quantity,value_cents=excluded.value_cents,updated_at=excluded.updated_at`).run(key,method,input.productId,input.warehouseId,input.lotId||null,input.serialId||null,Math.abs(quantity)<=EPS?0:quantity,value,now);
  db.prepare("UPDATE products SET valuation_activated_at=COALESCE(valuation_activated_at,?) WHERE id=?").run(now,input.productId);
  if (input.inventoryTransactionId) db.prepare("UPDATE inventory_transactions SET business_date=?,valuation_status='VALUED' WHERE id=?").run(input.businessDate,input.inventoryTransactionId);
  return { id: movementId, quantityDelta, valueDeltaCents, unitCostCents: unit, valuationMethod: method, lotId: input.lotId || null, serialId: input.serialId || null };
}

function writeLegacyMovement(db,input,quantityDelta){ const now=input.createdAt||new Date().toISOString(),movementId=input.id||id(); db.prepare(`INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,lot_id,serial_id,quantity_delta,value_delta_cents,unit_cost_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,inventory_transaction_id,production_order_id,reversal_of_id,status,created_at) VALUES(?,?,?,?,?,?,?,0,NULL,'LEGACY_UNVALUED',?,?,?,?,?,?,?,'LEGACY_UNVALUED',?)`).run(movementId,input.businessDate,input.productId,input.warehouseId,input.lotId||null,input.serialId||null,quantityDelta,input.movementType,input.sourceType,input.sourceId,input.sourceItemId||input.sourceId,input.inventoryTransactionId||null,input.productionOrderId||null,input.reversalOfId||null,now); if(input.inventoryTransactionId)db.prepare("UPDATE inventory_transactions SET business_date=?,valuation_status='LEGACY_UNVALUED' WHERE id=?").run(input.businessDate,input.inventoryTransactionId); return{id:movementId,quantityDelta,valueDeltaCents:0,unitCostCents:null,valuationMethod:'LEGACY_UNVALUED',lotId:input.lotId||null,serialId:input.serialId||null}; }

export function receiveValue(db, input) {
  assertFinancialPeriodsOpen(db, input.businessDate);
  const quantity = Number(input.quantity); const value = Number(input.valueCents);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(value) || value < 0) throw new HttpError(400, '入库估值数量或金额无效');
  if(value===0&&input.valuationBasis==='LEGACY_UNVALUED'&&!db.prepare('SELECT valuation_activated_at FROM products WHERE id=?').get(input.productId)?.valuation_activated_at)return writeLegacyMovement(db,input,quantity);
  const { method, key } = getBalance(db, input);
  return writeMovement(db, input, quantity, value, method, key);
}

export function issueValue(db, input) {
  assertFinancialPeriodsOpen(db, input.businessDate);
  const quantity = Number(input.quantity); if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '出库估值数量无效');
  const { method, key, row } = getBalance(db, input);
  if (!row) { const activated=db.prepare('SELECT valuation_activated_at FROM products WHERE id=?').get(input.productId)?.valuation_activated_at; if(!activated)return writeLegacyMovement(db,input,-quantity); throw new HttpError(409, '可估值库存不足'); }
  if (Number(row.quantity) + EPS < quantity) throw new HttpError(409, '可估值库存不足；旧库存须在 Phase 6E 转换后使用');
  const allocated = allocateProportionalCents(Number(row.value_cents), quantity, Number(row.quantity));
  return writeMovement(db, input, -quantity, -allocated, method, key);
}

export function restoreOriginalValue(db, input) {
  assertFinancialPeriodsOpen(db, input.businessDate);
  const original = db.prepare("SELECT * FROM inventory_valuation_movements WHERE id=? AND status='POSTED'").get(input.originalMovementId);
  if (!original || original.quantity_delta >= 0) throw new HttpError(409, '原出库估值事件不存在');
  const already = db.prepare('SELECT COALESCE(SUM(quantity_delta),0) quantity,COALESCE(SUM(value_delta_cents),0) value FROM inventory_valuation_movements WHERE reversal_of_id=?').get(original.id);
  const maxQty = -Number(original.quantity_delta) - Number(already.quantity); const quantity = Number(input.quantity ?? maxQty);
  if (quantity <= 0 || quantity > maxQty + EPS) throw new HttpError(409, '冲销数量超过原估值事件');
  const value = Math.abs(quantity - maxQty) <= EPS ? -Number(original.value_delta_cents) - Number(already.value) : allocateProportionalCents(-Number(original.value_delta_cents), quantity, -Number(original.quantity_delta));
  return receiveValue(db, { ...input, productId: original.product_id, warehouseId: input.warehouseId || original.warehouse_id, lotId: original.lot_id, serialId: original.serial_id, valueCents: value, quantity, reversalOfId: original.id, valuationBasis: 'ORIGINAL_COST' });
}

export function consumeOriginalInboundValue(db,input){ assertFinancialPeriodsOpen(db,input.businessDate); const originals=db.prepare("SELECT * FROM inventory_valuation_movements WHERE source_type=? AND source_id=? AND source_item_id=? AND quantity_delta>0 AND status='POSTED' ORDER BY created_at,id").all(input.originalSourceType,input.originalSourceId,input.originalSourceItemId); if(!originals.length){const activated=db.prepare('SELECT valuation_activated_at FROM products WHERE id=?').get(input.productId)?.valuation_activated_at;if(!activated)return[writeLegacyMovement(db,input,-Number(input.quantity))];throw new HttpError(409,'原入库缺少权威估值事件');} let remaining=Number(input.quantity),out=[]; for(const original of originals){if(remaining<=EPS)break;const consumed=-Number(db.prepare('SELECT COALESCE(SUM(quantity_delta),0)n FROM inventory_valuation_movements WHERE reversal_of_id=?').get(original.id).n);const available=Number(original.quantity_delta)-consumed;if(available<=EPS)continue;const quantity=Math.min(remaining,available);const value=Math.abs(quantity-available)<=EPS?Number(original.value_delta_cents)-Number(db.prepare('SELECT COALESCE(SUM(-value_delta_cents),0)n FROM inventory_valuation_movements WHERE reversal_of_id=?').get(original.id).n):allocateProportionalCents(Number(original.value_delta_cents),quantity,Number(original.quantity_delta));const {method,key,row}=getBalance(db,{...input,lotId:original.lot_id,serialId:original.serial_id});if(!row||Number(row.quantity)+EPS<quantity||Number(row.value_cents)<value)throw new HttpError(409,'原入库身份/价值已不可用于冲销');out.push(writeMovement(db,{...input,lotId:original.lot_id,serialId:original.serial_id,reversalOfId:original.id},-quantity,-value,method,key));remaining-=quantity;}if(remaining>EPS)throw new HttpError(409,'冲销数量超过原入库未冲销数量');return out; }

function identityAllocations(db, sourceType, sourceId, sourceItemId) {
  return db.prepare(`SELECT lot_id lotId,serial_id serialId,quantity FROM tracked_source_allocations
    WHERE source_type=? AND source_id=? AND source_item_id=? AND posted=1 AND reversed=0 ORDER BY COALESCE(serial_id,lot_id),id`).all(sourceType,sourceId,sourceItemId);
}

export function receiveSourceValue(db, input) {
  const method=valuationMethod(db,input.productId); const allocations=method==='MOVING_AVERAGE'?[{ quantity:input.quantity,lotId:null,serialId:null }]:identityAllocations(db,input.sourceType,input.sourceId,input.sourceItemId);
  if(!allocations.length) throw new HttpError(409,'跟踪库存缺少已过账身份分配');
  const totalQty=allocations.reduce((s,x)=>s+Number(x.quantity),0); if(Math.abs(totalQty-Number(input.quantity))>EPS) throw new HttpError(409,'身份分配数量与估值数量不一致');
  let remaining=Number(input.valueCents); return allocations.map((allocation,index)=>{ const value=index===allocations.length-1?remaining:allocateProportionalCents(Number(input.valueCents),Number(allocation.quantity),totalQty); remaining-=value; return receiveValue(db,{...input,...allocation,valueCents:value}); });
}

export function issueSourceValue(db, input) {
  const method=valuationMethod(db,input.productId); const allocations=method==='MOVING_AVERAGE'?[{ quantity:input.quantity,lotId:null,serialId:null }]:identityAllocations(db,input.sourceType,input.sourceId,input.sourceItemId);
  if(!allocations.length) throw new HttpError(409,'跟踪库存缺少已过账身份分配');
  const totalQty=allocations.reduce((s,x)=>s+Number(x.quantity),0); if(Math.abs(totalQty-Number(input.quantity))>EPS) throw new HttpError(409,'身份分配数量与估值数量不一致');
  return allocations.map((allocation)=>issueValue(db,{...input,...allocation,quantity:Number(allocation.quantity)}));
}

export function restoreSourceValue(db,input){
  const sourceMovements=db.prepare(`SELECT * FROM inventory_valuation_movements WHERE source_type=? AND source_id=? AND source_item_id=? AND quantity_delta<0 AND status='POSTED' ORDER BY created_at,id`).all(input.originalSourceType,input.originalSourceId,input.originalSourceItemId);
  if(!sourceMovements.length){ const legacy=db.prepare("SELECT * FROM inventory_valuation_movements WHERE source_type=? AND source_id=? AND source_item_id=? AND quantity_delta<0 AND status='LEGACY_UNVALUED' ORDER BY created_at,id").get(input.originalSourceType,input.originalSourceId,input.originalSourceItemId); if(legacy)return[writeLegacyMovement(db,{...input,reversalOfId:legacy.id,lotId:legacy.lot_id,serialId:legacy.serial_id},Number(input.quantity))]; const activated=db.prepare('SELECT valuation_activated_at FROM products WHERE id=?').get(input.productId)?.valuation_activated_at; if(!activated)return[writeLegacyMovement(db,input,Number(input.quantity))]; throw new HttpError(409,'原单缺少权威出库成本，不能按当前平均成本替代'); }
  const returnAllocs=valuationMethod(db,input.productId)==='MOVING_AVERAGE'?[{quantity:input.quantity,lotId:null,serialId:null}]:identityAllocations(db,input.sourceType,input.sourceId,input.sourceItemId);
  let remaining=Number(input.quantity); const result=[];
  for(const allocation of returnAllocs){ let aq=Number(allocation.quantity); const candidates=sourceMovements.filter(m=>(allocation.serialId?m.serial_id===allocation.serialId:allocation.lotId?m.lot_id===allocation.lotId:true)); for(const original of candidates){ if(aq<=EPS) break; const already=Number(db.prepare('SELECT COALESCE(SUM(quantity_delta),0) n FROM inventory_valuation_movements WHERE reversal_of_id=?').get(original.id).n); const available=-Number(original.quantity_delta)-already; if(available<=EPS) continue; const q=Math.min(aq,available); result.push(restoreOriginalValue(db,{...input,originalMovementId:original.id,warehouseId:input.warehouseId,quantity:q,lotId:allocation.lotId,serialId:allocation.serialId})); aq-=q; remaining-=q; } if(aq>EPS) throw new HttpError(409,'退回身份超过原出库成本分配'); }
  if(remaining>EPS) throw new HttpError(409,'退回数量超过原出库成本分配'); return result;
}

export function accountForRole(db, role) {
  const row = db.prepare('SELECT s.id,s.code,s.name FROM account_role_mappings m JOIN accounting_subjects s ON s.id=m.subject_id AND s.active=1 WHERE m.role_code=?').get(role);
  if (!row) throw new HttpError(409, `缺少会计科目角色映射: ${role}`);
  return row;
}

export function inventoryAccountRole(db,productId){ const value=db.prepare('SELECT inventory_classification FROM products WHERE id=?').get(productId)?.inventory_classification; return value==='RAW_MATERIAL'?'RAW_MATERIAL_INVENTORY':value==='FINISHED_GOOD'?'FINISHED_GOODS_INVENTORY':'OTHER_INVENTORY'; }

export function receivePositiveSourceValue(db,input){
  const method=valuationMethod(db,input.productId); const allocations=method==='MOVING_AVERAGE'?[{quantity:input.quantity,lotId:null,serialId:null}]:identityAllocations(db,input.sourceType,input.sourceId,input.sourceItemId); if(!allocations.length) throw new HttpError(409,'正向调整缺少跟踪身份明细');
  const standard=Number(db.prepare('SELECT standard_manufacturing_cost_cents n FROM products WHERE id=?').get(input.productId)?.n||0); const out=[];
  for(const allocation of allocations){ const {row}=getBalance(db,{...input,...allocation}); let unit=null,basis=''; if(row&&Number(row.quantity)>EPS){ unit=allocateProportionalCents(Number(row.value_cents),1,Number(row.quantity)); basis=method==='LOT_SPECIFIC_POOL'?'LOT_CARRYING':method==='SPECIFIC_SERIAL'?'SERIAL_EXISTING':'MOVING_AVERAGE'; } else if(standard>0){ unit=standard; basis='STANDARD_COST'; } else { const activated=db.prepare('SELECT valuation_activated_at FROM products WHERE id=?').get(input.productId)?.valuation_activated_at; if(!activated){out.push(writeLegacyMovement(db,{...input,...allocation},Number(allocation.quantity)));continue;} throw new HttpError(409,'无现有账面成本或冻结标准成本，拒绝正向库存调整'); } const quantity=Number(allocation.quantity); const value=Math.round(unit*quantity); out.push(receiveValue(db,{...input,...allocation,quantity,valueCents:value,valuationBasis:basis})); }
  return out;
}

export function createSystemVoucher(db, input) {
  assertFinancialPeriodsOpen(db, input.businessDate);
  const existing = db.prepare("SELECT id FROM accounting_vouchers WHERE voucher_origin='SYSTEM' AND source_type=? AND source_id=?").get(input.sourceType,input.sourceId);
  if (existing) return existing.id;
  const normalized = input.entries.filter((e) => Number(e.amountCents) !== 0).map((e) => ({ ...e, amountCents: Math.abs(Number(e.amountCents)), subjectId: e.subjectId || accountForRole(db,e.role).id }));
  const debit = normalized.filter((e)=>e.direction==='DEBIT').reduce((s,e)=>s+e.amountCents,0); const credit = normalized.filter((e)=>e.direction==='CREDIT').reduce((s,e)=>s+e.amountCents,0);
  if (!normalized.length) return null;
  if (!Number.isSafeInteger(debit) || debit !== credit) throw new HttpError(409, '系统凭证借贷不平衡');
  const voucherId=id(); const now=new Date().toISOString();
  db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,business_date,remark,creator_id,created_at,updated_at,status,voucher_origin,reversal_of_id,approved_at,approver_id,period)
    VALUES(?,?,?,?,?,?,?,?,?,?,'POSTED','SYSTEM',?,?,?,?)`).run(voucherId,`SYS-${Date.now()}-${voucherId.slice(0,6)}`,input.sourceType,input.sourceId,input.businessDate,input.businessDate,input.remark||'',input.actorId,now,now,input.reversalOfId||null,now,input.actorId,input.businessDate.slice(0,7));
  const stmt=db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no) VALUES(?,?,?,?,?,?,?)'); normalized.forEach((e,i)=>stmt.run(id(),voucherId,e.subjectId,e.direction,e.amountCents,e.summary||'',i+1)); return voucherId;
}

export function reverseValuationSource(db, input) {
  assertFinancialPeriodsOpen(db, input.businessDate);
  const originals = db.prepare(`SELECT * FROM inventory_valuation_movements
    WHERE source_type=? AND source_id=? AND status IN ('POSTED','LEGACY_UNVALUED')
    ORDER BY created_at,id`).all(input.originalSourceType, input.originalSourceId);
  if (!originals.length) throw new HttpError(409, '原单缺少价值流水，不能冲销');
  const result = [];
  for (const original of originals) {
    if (db.prepare('SELECT 1 FROM inventory_valuation_movements WHERE reversal_of_id=? LIMIT 1').get(original.id)) throw new HttpError(409, '原价值事件已冲销');
    const movementInput = {
      businessDate: input.businessDate,
      productId: original.product_id,
      warehouseId: original.warehouse_id,
      lotId: original.lot_id,
      serialId: original.serial_id,
      movementType: `${original.movement_type}_REVERSAL`,
      sourceType: input.reversalSourceType,
      sourceId: input.reversalSourceId,
      sourceItemId: original.source_item_id,
      inventoryTransactionId: input.transactionIdByOriginal?.get(original.inventory_transaction_id) || null,
      reversalOfId: original.id,
      valuationBasis: 'ORIGINAL_COST',
    };
    if (original.status === 'LEGACY_UNVALUED') {
      result.push(writeLegacyMovement(db, movementInput, -Number(original.quantity_delta)));
      continue;
    }
    const { method, key, row } = getBalance(db, movementInput);
    const quantityDelta = -Number(original.quantity_delta);
    const valueDelta = -Number(original.value_delta_cents);
    if (quantityDelta < 0 && (!row || Number(row.quantity) + EPS < -quantityDelta || Number(row.value_cents) < -valueDelta)) throw new HttpError(409, '原入库的数量或价值已不可用，不能冲销');
    result.push(writeMovement(db, movementInput, quantityDelta, valueDelta, method, key));
  }
  return result;
}

export function reverseSystemVoucher(db, input) {
  const original = db.prepare("SELECT * FROM accounting_vouchers WHERE voucher_origin='SYSTEM' AND source_type=? AND source_id=? AND status='POSTED'").get(input.originalSourceType, input.originalSourceId);
  if (!original) return null;
  const entries = db.prepare('SELECT subject_id subjectId,direction,amount_cents amountCents,summary FROM accounting_entries WHERE voucher_id=? ORDER BY line_no,id').all(original.id)
    .map((entry) => ({ ...entry, direction: entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT', summary: `冲销：${entry.summary || original.voucher_no}` }));
  return createSystemVoucher(db, {
    sourceType: input.reversalSourceType,
    sourceId: input.reversalSourceId,
    businessDate: input.businessDate,
    actorId: input.actorId,
    reversalOfId: original.id,
    remark: input.reason,
    entries,
  });
}

export function postWipMovement(db,input) {
  const amount=Number(input.amountCents); if(!Number.isSafeInteger(amount)||amount===0) throw new HttpError(400,'WIP 金额必须为非零整数分');
  const movementId=id(); db.prepare(`INSERT INTO production_wip_movements(id,production_order_id,business_date,movement_type,amount_cents,source_type,source_id,source_item_id,voucher_id,reversal_of_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(movementId,input.productionOrderId,input.businessDate,input.movementType,amount,input.sourceType,input.sourceId,input.sourceItemId||'',input.voucherId||null,input.reversalOfId||null,new Date().toISOString()); return movementId;
}

function check(name, difference, affected=[], explanation='') { return { code:name,status:difference===0?'PASS':'FAIL',severity:'BLOCKING',difference,affectedSourceRecords:affected,explanation }; }
export function systemHealth(db, { asOfDate='9999-12-31' }={}) {
  const checks=[];
  const currentQuantity=Number(db.prepare('SELECT COALESCE(SUM(quantity),0)n FROM inventory').get().n);
  const afterQuantity=Number(db.prepare("SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN quantity_change ELSE -quantity_change END),0)n FROM inventory_transactions WHERE COALESCE(business_date,SUBSTR(created_at,1,10))>?").get(asOfDate).n);
  const ledgerQuantity=Number(db.prepare("SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN quantity_change ELSE -quantity_change END),0)n FROM inventory_transactions WHERE COALESCE(business_date,SUBSTR(created_at,1,10))<=?").get(asOfDate).n);
  checks.push(check('INVENTORY_QUANTITY_CACHE_VS_LEDGER',(currentQuantity-afterQuantity)-ledgerQuantity,[], '当前库存按后续移动回溯的数量应等于数量流水'));
  const trackedDifferences=[];
  const lotRows=db.prepare(`SELECT i.warehouse_id,i.product_id,i.quantity canonical,COALESCE(SUM(b.quantity),0) dimension
    FROM inventory i JOIN products p ON p.id=i.product_id AND p.tracking_policy='LOT'
    LEFT JOIN inventory_lot_balances b ON b.warehouse_id=i.warehouse_id AND b.product_id=i.product_id
    GROUP BY i.warehouse_id,i.product_id HAVING ABS(i.quantity-COALESCE(SUM(b.quantity),0))>?`).all(EPS);
  const serialRows=db.prepare(`SELECT i.warehouse_id,i.product_id,i.quantity canonical,COUNT(s.id) dimension
    FROM inventory i JOIN products p ON p.id=i.product_id AND p.tracking_policy='SERIAL'
    LEFT JOIN inventory_serials s ON s.current_warehouse_id=i.warehouse_id AND s.product_id=i.product_id AND s.lifecycle_state IN ('AVAILABLE','HOLD')
    GROUP BY i.warehouse_id,i.product_id HAVING ABS(i.quantity-COUNT(s.id))>?`).all(EPS);
  for(const row of [...lotRows,...serialRows])trackedDifferences.push(`${row.warehouse_id}/${row.product_id}:${row.canonical}-${row.dimension}`);
  checks.push(check('TRACKED_DIMENSION_VS_CANONICAL',trackedDifferences.length,trackedDifferences,'LOT/SERIAL 在库身份汇总应等于仓库货品库存'));
  const ledger=db.prepare("SELECT COALESCE(SUM(value_delta_cents),0) n FROM inventory_valuation_movements WHERE status='POSTED'").get().n;
  const cache=db.prepare('SELECT COALESCE(SUM(value_cents),0) n FROM inventory_valuation_balances').get().n;
  checks.push(check('VALUATION_CACHE_VS_LEDGER',Number(cache)-Number(ledger),[], '价值流水为权威历史，余额表仅为派生缓存'));
  const vqty=db.prepare("SELECT COALESCE(SUM(quantity_delta),0) n FROM inventory_valuation_movements WHERE status='POSTED' AND business_date<=?").get(asOfDate).n;
  const iqty=currentQuantity-afterQuantity;
  checks.push(check('INVENTORY_QUANTITY_VS_VALUATION',Number(iqty)-Number(vqty),[], '未估值旧库存会阻止权威结账'));
  const negative=db.prepare('SELECT balance_key FROM inventory_valuation_balances WHERE quantity<0 OR value_cents<0 OR (quantity=0 AND value_cents<>0)').all(); checks.push(check('NEGATIVE_OR_RESIDUAL_VALUATION',negative.length,negative.map(x=>x.balance_key)));
  const inventoryRoles=['RAW_MATERIAL_INVENTORY','FINISHED_GOODS_INVENTORY','OTHER_INVENTORY']; const inventoryGl=glRoleBalance(db,inventoryRoles,asOfDate); const asOfValue=Number(db.prepare("SELECT COALESCE(SUM(value_delta_cents),0) n FROM inventory_valuation_movements WHERE status='POSTED' AND business_date<=?").get(asOfDate).n); checks.push(check('INVENTORY_VALUE_TO_GL',inventoryGl-asOfValue,[], '已过账存货科目余额应等于价值子账'));
  const wip=Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM production_wip_movements WHERE business_date<=?').get(asOfDate).n); checks.push(check('WIP_TO_GL',glRoleBalance(db,['WIP'],asOfDate)-wip));
  const ar=Number(db.prepare("SELECT COALESCE(SUM(CASE WHEN item_class='SOURCE' THEN open_amount_cents ELSE 0 END),0) n FROM account_receivables WHERE business_date<=?").get(asOfDate).n); checks.push(check('AR_TO_GL',glRoleBalance(db,['ACCOUNTS_RECEIVABLE'],asOfDate)-ar));
  const ap=Number(db.prepare("SELECT COALESCE(SUM(CASE WHEN item_class='SOURCE' THEN open_amount_cents ELSE 0 END),0) n FROM account_payables WHERE business_date<=?").get(asOfDate).n); checks.push(check('AP_TO_GL',liabilityRoleBalance(db,['ACCOUNTS_PAYABLE'],asOfDate)-ap));
  // Phase 6E commercial-document reconciliation.  Legacy delivery/receipt
  // open items remain in the aggregate AR/AP checks above; new authoritative
  // sources are checked explicitly without repairing either side.
  const invoiceTotal=Number(db.prepare("SELECT COALESCE(SUM(gross_cents),0)n FROM sales_invoices WHERE status='POSTED' AND invoice_date<=?").get(asOfDate).n);
  const invoiceAr=Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0)n FROM account_receivables WHERE source_type='SALES_INVOICE' AND business_date<=?").get(asOfDate).n);
  const invoiceGl=Number(db.prepare("SELECT COALESCE(SUM(e.amount_cents),0)n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE v.source_type='SALES_INVOICE' AND v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<=? AND e.subject_id=(SELECT subject_id FROM account_role_mappings WHERE role_code='ACCOUNTS_RECEIVABLE') AND e.direction='DEBIT'").get(asOfDate).n);
  checks.push(check('SALES_INVOICE_TO_AR_GL',Math.abs(invoiceTotal-invoiceAr)+Math.abs(invoiceTotal-invoiceGl),[], '销售发票含税额应等于原始 AR 与发票系统凭证'));
  const billTotal=Number(db.prepare("SELECT COALESCE(SUM(gross_cents),0)n FROM supplier_bills WHERE status='POSTED' AND bill_date<=?").get(asOfDate).n);
  const billAp=Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0)n FROM account_payables WHERE source_type='SUPPLIER_BILL' AND business_date<=?").get(asOfDate).n);
  const billGl=Number(db.prepare("SELECT COALESCE(SUM(e.amount_cents),0)n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE v.source_type='SUPPLIER_BILL' AND v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<=? AND e.subject_id=(SELECT subject_id FROM account_role_mappings WHERE role_code='ACCOUNTS_PAYABLE') AND e.direction='CREDIT'").get(asOfDate).n);
  checks.push(check('SUPPLIER_BILL_TO_AP_GL',Math.abs(billTotal-billAp)+Math.abs(billTotal-billGl),[], '供应商账单含税额应等于原始 AP 与账单系统凭证'));
  const grniExpected=Number(db.prepare("SELECT COALESCE(SUM(total_cents),0)n FROM purchase_receipts WHERE status='CONFIRMED' AND billing_mode<>'LEGACY_DIRECT' AND receipt_date<=?").get(asOfDate).n)-Number(db.prepare("SELECT COALESCE(SUM(grni_cents),0)n FROM supplier_bills WHERE status='POSTED' AND bill_date<=?").get(asOfDate).n);
  const grniGl=Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0)n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<=? AND e.subject_id=(SELECT subject_id FROM account_role_mappings WHERE role_code='GRNI') AND v.source_type IN ('PURCHASE_RECEIPT','SUPPLIER_BILL','SUPPLIER_CREDIT_NOTE')`).get(asOfDate).n);
  checks.push(check('RECEIPT_GRNI_TO_GL',grniGl-grniExpected,[], '未结转收货 GRNI 应等于 GL GRNI'));
  const outputTax=Number(db.prepare("SELECT COALESCE(SUM(tax_cents),0)n FROM sales_invoices WHERE status='POSTED' AND invoice_date<=?").get(asOfDate).n)-Number(db.prepare("SELECT COALESCE(SUM(tax_cents),0)n FROM commercial_credit_notes WHERE side='AR' AND status='POSTED' AND credit_date<=?").get(asOfDate).n);
  const inputTax=Number(db.prepare("SELECT COALESCE(SUM(tax_cents),0)n FROM supplier_bills WHERE status='POSTED' AND bill_date<=?").get(asOfDate).n)-Number(db.prepare("SELECT COALESCE(SUM(tax_cents),0)n FROM commercial_credit_notes WHERE side='AP' AND status='POSTED' AND credit_date<=?").get(asOfDate).n);
  const outputTaxGl=Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE -e.amount_cents END),0)n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<=? AND e.subject_id=(SELECT subject_id FROM account_role_mappings WHERE role_code='OUTPUT_TAX_PAYABLE') AND v.source_type IN ('SALES_INVOICE','SALES_CREDIT_NOTE')`).get(asOfDate).n);
  const inputTaxGl=Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0)n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<=? AND e.subject_id=(SELECT subject_id FROM account_role_mappings WHERE role_code='INPUT_TAX_RECEIVABLE') AND v.source_type IN ('SUPPLIER_BILL','SUPPLIER_CREDIT_NOTE')`).get(asOfDate).n);
  checks.push(check('OUTPUT_TAX_TO_GL',outputTaxGl-outputTax)); checks.push(check('INPUT_TAX_TO_GL',inputTaxGl-inputTax));
  const uomMismatch=Number(db.prepare("SELECT COUNT(*)n FROM (SELECT base_quantity_num,base_quantity_den,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator FROM sales_invoice_items UNION ALL SELECT base_quantity_num,base_quantity_den,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator FROM supplier_bill_items)x WHERE base_quantity_num*document_quantity_den*conversion_denominator<>document_quantity_num*conversion_numerator*base_quantity_den").get().n); checks.push(check('UOM_DOCUMENT_TO_BASE',uomMismatch));
  const serialFraction=Number(db.prepare("SELECT COUNT(*)n FROM (SELECT i.base_quantity_num n,i.base_quantity_den d,i.product_id FROM sales_invoice_items i UNION ALL SELECT i.base_quantity_num,i.base_quantity_den,i.product_id FROM supplier_bill_items i)x JOIN products p ON p.id=x.product_id WHERE p.tracking_policy='SERIAL' AND x.n%x.d<>0").get().n); checks.push(check('SERIAL_BASE_QUANTITY_INTEGER',serialFraction));
  const cashMovement=Number(db.prepare("SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount_cents ELSE -amount_cents END),0) n FROM settlement_account_movements WHERE business_date<=?").get(asOfDate).n); checks.push(check('CASH_BANK_TO_GL',glRoleBalance(db,['CASH','BANK'],asOfDate)-cashMovement));
  const cogsValue=-Number(db.prepare("SELECT COALESCE(SUM(value_delta_cents),0) n FROM inventory_valuation_movements WHERE movement_type IN ('SALES_DELIVERY_COGS','SALES_RETURN_COGS_REVERSAL') AND business_date<=?").get(asOfDate).n); checks.push(check('COGS_TO_GL',glRoleBalance(db,['COGS'],asOfDate)-cogsValue));
  const legacy=db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE valuation_status='LEGACY_UNVALUED' AND business_date<=?").get(asOfDate).n;
  checks.push(check('LEGACY_UNVALUED_MOVEMENTS',Number(legacy),[], 'Phase 6E 开账转换前不得权威结账'));
  const duplicate=db.prepare("SELECT COUNT(*) n FROM (SELECT source_type,source_id FROM accounting_vouchers WHERE voucher_origin='SYSTEM' GROUP BY source_type,source_id HAVING COUNT(*)>1) x").get().n;
  checks.push(check('SYSTEM_VOUCHER_UNIQUENESS',Number(duplicate)));
  const completed=db.prepare("SELECT o.id FROM production_orders o WHERE o.status='COMPLETED' AND COALESCE((SELECT SUM(amount_cents) FROM production_wip_movements w WHERE w.production_order_id=o.id),0)<>0").all();
  checks.push(check('COMPLETED_ORDER_WIP_ZERO',completed.length,completed.map(x=>x.id)));
  const brokenGenealogy=db.prepare(`SELECT g.id FROM production_genealogy_allocations g
    WHERE g.status='ACTIVE' AND NOT EXISTS (
      SELECT 1 FROM tracked_inventory_movements m WHERE m.source_type='PRODUCTION_MATERIAL_ISSUE' AND m.source_item_id=g.material_issue_item_id AND m.reversed=0
        AND COALESCE(m.lot_id,'')=COALESCE(g.input_lot_id,'') AND COALESCE(m.serial_id,'')=COALESCE(g.input_serial_id,''))`).all();
  checks.push(check('GENEALOGY_ACTIVE_REVERSED_CONSISTENCY',brokenGenealogy.length,brokenGenealogy.map(x=>x.id),'活动谱系必须引用未冲销的投入身份移动'));
  const invalidOpenItems=[];
  for(const [table,side] of [['account_receivables','AR'],['account_payables','AP']])for(const row of db.prepare(`SELECT id FROM ${table} o WHERE open_amount_cents<0 OR paid_cents<0 OR write_off_cents<0 OR return_credit_applied_cents<0 OR discount_credit_applied_cents<0 OR other_credit_applied_cents<0 OR cash_allocation_cents<0 OR open_amount_cents<>MAX(0,amount_cents+adjustment_cents-paid_cents-write_off_cents-COALESCE((SELECT SUM(amount_cents) FROM balance_applications b WHERE b.side=? AND b.target_open_item_id=o.id AND b.status='CONFIRMED'),0))`).all(side))invalidOpenItems.push(`${table}:${row.id}`);
  checks.push(check('SETTLEMENT_OPEN_ITEM_INVARIANTS',invalidOpenItems.length,invalidOpenItems,'开项余额必须与原值、调整、结算和核销可重算且非负'));
  const periodOrder=db.prepare("SELECT i.period_key FROM inventory_period_closures i LEFT JOIN period_closures a ON a.period=i.period_key WHERE i.status='REOPENED' AND a.status='CLOSED'").all(); checks.push(check('PERIOD_CLOSE_SEQUENCE',periodOrder.length,periodOrder.map(x=>x.period_key)));
  return { checkOnly:true,autoRepair:false,asOfDate,overallStatus:checks.some(x=>x.status==='FAIL')?'FAIL':'PASS',checks };
}

function glRoleBalance(db,roles,asOfDate){ if(!roles.length)return 0; const marks=roles.map(()=>'?').join(','); return Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id JOIN account_role_mappings m ON m.subject_id=e.subject_id WHERE v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<=? AND m.role_code IN (${marks})`).get(asOfDate,...roles).n); }
function liabilityRoleBalance(db,roles,asOfDate){ return -glRoleBalance(db,roles,asOfDate); }

export function systemHealthHandler(db,res,actor,url){ allowAny(actor,['ACCOUNTING_VIEW','PERIOD_CLOSE_MANAGE']); return send(res,200,systemHealth(db,{asOfDate:url.searchParams.get('asOfDate')||'9999-12-31'})); }
export function inventoryValuationReport(db,res,actor,url){ allowAny(actor,['ACCOUNTING_VIEW','INVENTORY_VIEW','REPORT_VIEW']); const asOfDate=url.searchParams.get('asOfDate')||new Date().toISOString().slice(0,10); const rows=db.prepare(`SELECT v.product_id productId,p.code productCode,p.name productName,v.warehouse_id warehouseId,w.code warehouseCode,v.lot_id lotId,v.serial_id serialId,p.valuation_method valuationMethod,SUM(v.quantity_delta) quantity,SUM(v.value_delta_cents) valueCents FROM inventory_valuation_movements v JOIN products p ON p.id=v.product_id JOIN warehouses w ON w.id=v.warehouse_id WHERE v.status='POSTED' AND v.business_date<=? GROUP BY v.product_id,v.warehouse_id,v.lot_id,v.serial_id HAVING ABS(SUM(v.quantity_delta))>? OR SUM(v.value_delta_cents)<>0 ORDER BY p.code,w.code`).all(asOfDate,EPS); const totalValueCents=rows.reduce((s,x)=>s+Number(x.valueCents),0); return send(res,200,{basis:'POSTED_VALUE_LEDGER',currency:'CNY',asOfDate,authoritative:!db.prepare("SELECT 1 FROM inventory_transactions WHERE valuation_status='LEGACY_UNVALUED' AND business_date<=? LIMIT 1").get(asOfDate),rows,totalValueCents}); }

export function inventoryRollForwardHandler(db,res,actor,url){ allowAny(actor,['ACCOUNTING_VIEW','REPORT_VIEW']); const period=String(url.searchParams.get('period')||''); if(!/^\d{4}-\d{2}$/.test(period))throw new HttpError(400,'期间格式应为 YYYY-MM'); const start=`${period}-01`,end=`${period}-31`; const opening=Number(db.prepare("SELECT COALESCE(SUM(value_delta_cents),0)n FROM inventory_valuation_movements WHERE status='POSTED' AND business_date<?").get(start).n); const rows=db.prepare("SELECT movement_type,SUM(value_delta_cents) valueCents FROM inventory_valuation_movements WHERE status='POSTED' AND business_date BETWEEN ? AND ? GROUP BY movement_type ORDER BY movement_type").all(start,end); const net=rows.reduce((s,x)=>s+Number(x.valueCents),0),closing=opening+net; return send(res,200,{period,currency:'CNY',basis:'POSTED_VALUE_LEDGER',openingValueCents:opening,movements:rows,netMovementCents:net,closingValueCents:closing,glInventoryCents:glRoleBalance(db,['RAW_MATERIAL_INVENTORY','FINISHED_GOODS_INVENTORY','OTHER_INVENTORY'],end),differenceCents:glRoleBalance(db,['RAW_MATERIAL_INVENTORY','FINISHED_GOODS_INVENTORY','OTHER_INVENTORY'],end)-closing}); }
export function wipRollForwardHandler(db,res,actor,url){ allowAny(actor,['ACCOUNTING_VIEW','REPORT_VIEW']); const period=String(url.searchParams.get('period')||''); if(!/^\d{4}-\d{2}$/.test(period))throw new HttpError(400,'期间格式应为 YYYY-MM'); const start=`${period}-01`,end=`${period}-31`; const opening=Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0)n FROM production_wip_movements WHERE business_date<?').get(start).n); const rows=db.prepare('SELECT movement_type,SUM(amount_cents) amountCents FROM production_wip_movements WHERE business_date BETWEEN ? AND ? GROUP BY movement_type ORDER BY movement_type').all(start,end); const closing=opening+rows.reduce((s,x)=>s+Number(x.amountCents),0),gl=glRoleBalance(db,['WIP'],end); return send(res,200,{period,currency:'CNY',basis:'POSTED_WIP_SUBLEDGER',openingWipCents:opening,movements:rows,closingWipCents:closing,glWipCents:gl,differenceCents:gl-closing}); }
export function generalLedgerHandler(db,res,actor,url){ allowAny(actor,['ACCOUNTING_VIEW','REPORT_VIEW']); const accountId=String(url.searchParams.get('accountId')||''); const from=url.searchParams.get('from')||'0000-01-01',to=url.searchParams.get('to')||'9999-12-31'; if(!db.prepare('SELECT 1 FROM accounting_subjects WHERE id=?').get(accountId))throw new HttpError(400,'请选择有效科目'); const opening=Number(db.prepare("SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0)n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE v.status='POSTED' AND e.subject_id=? AND COALESCE(v.business_date,v.voucher_date)<?").get(accountId,from).n); let running=opening; const rows=db.prepare("SELECT v.id voucherId,v.voucher_no voucherNo,v.source_type sourceType,v.source_id sourceId,COALESCE(v.business_date,v.voucher_date) businessDate,e.direction,e.amount_cents amountCents,e.summary FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE v.status='POSTED' AND e.subject_id=? AND COALESCE(v.business_date,v.voucher_date) BETWEEN ? AND ? ORDER BY COALESCE(v.business_date,v.voucher_date),v.voucher_no,e.line_no,e.id").all(accountId,from,to).map(x=>{running+=x.direction==='DEBIT'?Number(x.amountCents):-Number(x.amountCents);return{...x,runningBalanceCents:running};}); return send(res,200,{accountId,from,to,currency:'CNY',postedOnly:true,openingBalanceCents:opening,rows,closingBalanceCents:running}); }
