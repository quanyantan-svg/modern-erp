import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createTempDb } from './test-utils/temp-db.js';
import {
  allocateProportionalCents, assertFinancialPeriodsOpen, changeValuationMethod,
  consumeOriginalInboundValue, createSystemVoucher, issueValue, receiveValue,
  restoreOriginalValue, reverseSystemVoucher, reverseValuationSource, systemHealth, valuationMethod,
} from './modules/financial-inventory.js';

let handle; let db;
const at='2026-09-24T00:00:00.000Z';
before(()=>{
  handle=createTempDb({label:'v13-p6d'}); db=handle.db;
  db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('p6d-wh','P6D','P6D','','',1,?,?)").run(at,at);
  const insert=db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,tracking_policy,valuation_method,inventory_classification,standard_manufacturing_cost_cents) VALUES(?,?,?,'TEST','EA',0,0,1,?,?,?,?,?,10000)");
  insert.run('p6d-none','P6D-N','NONE',at,at,'NONE','MOVING_AVERAGE','OTHER_INVENTORY');
  insert.run('p6d-lot','P6D-L','LOT',at,at,'LOT','LOT_SPECIFIC_POOL','RAW_MATERIAL');
  insert.run('p6d-serial','P6D-S','SERIAL',at,at,'SERIAL','SPECIFIC_SERIAL','FINISHED_GOOD');
  db.prepare("INSERT INTO inventory_lots(id,product_id,lot_code,created_source_type,created_source_id,status,created_at) VALUES('lot-a','p6d-lot','A','TEST','A','AVAILABLE',?),('lot-b','p6d-lot','B','TEST','B','AVAILABLE',?)").run(at,at);
  db.prepare("INSERT INTO inventory_serials(id,product_id,serial_number,created_source_type,created_source_id,lifecycle_state,current_warehouse_id,updated_at,created_at) VALUES('sn-1','p6d-serial','SN1','TEST','S1','AVAILABLE','p6d-wh',?,?),('sn-2','p6d-serial','SN2','TEST','S2','AVAILABLE','p6d-wh',?,?)").run(at,at,at,at);
});
after(()=>handle.cleanup());

describe('V1.3 Phase 6D financial inventory valuation',()=>{
  test('tracking policy maps to one immutable financial valuation method',()=>{
    assert.equal(valuationMethod(db,'p6d-none'),'MOVING_AVERAGE'); assert.equal(valuationMethod(db,'p6d-lot'),'LOT_SPECIFIC_POOL'); assert.equal(valuationMethod(db,'p6d-serial'),'SPECIFIC_SERIAL');
    receiveValue(db,{businessDate:'2026-09-24',productId:'p6d-none',warehouseId:'p6d-wh',quantity:1,valueCents:10000,movementType:'RECEIPT',sourceType:'TEST',sourceId:'immut',sourceItemId:'immut'});
    assert.throws(()=>changeValuationMethod(db,'p6d-none','LOT_SPECIFIC_POOL'),/匹配|不可变更/);
  });

  test('moving average allocates deterministic cents and full depletion clears residue',()=>{
    receiveValue(db,{businessDate:'2026-09-24',productId:'p6d-none',warehouseId:'p6d-wh',quantity:9,valueCents:90000,movementType:'RECEIPT',sourceType:'TEST',sourceId:'ma1',sourceItemId:'ma1'});
    receiveValue(db,{businessDate:'2026-09-24',productId:'p6d-none',warehouseId:'p6d-wh',quantity:10,valueCents:200000,movementType:'RECEIPT',sourceType:'TEST',sourceId:'ma2',sourceItemId:'ma2'});
    const issue=issueValue(db,{businessDate:'2026-09-24',productId:'p6d-none',warehouseId:'p6d-wh',quantity:5,movementType:'COGS',sourceType:'TEST',sourceId:'ma3',sourceItemId:'ma3'});
    assert.equal(issue.valueDeltaCents,-75000); assert.equal(allocateProportionalCents(300000,5,20),75000);
    restoreOriginalValue(db,{businessDate:'2026-09-24',originalMovementId:issue.id,warehouseId:'p6d-wh',quantity:1,movementType:'RETURN',sourceType:'TEST',sourceId:'ma4',sourceItemId:'ma4'});
    const balance=db.prepare("SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:p6d-wh:p6d-none'").get(); assert.equal(balance.quantity,16); assert.equal(balance.value_cents,240000);
    issueValue(db,{businessDate:'2026-09-24',productId:'p6d-none',warehouseId:'p6d-wh',quantity:16,movementType:'FULL',sourceType:'TEST',sourceId:'ma5',sourceItemId:'ma5'});
    assert.deepEqual({...db.prepare("SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:p6d-wh:p6d-none'").get()},{quantity:0,value_cents:0});
  });

  test('lot pools do not blend and serials retain specific carrying value',()=>{
    receiveValue(db,{businessDate:'2026-09-24',productId:'p6d-lot',warehouseId:'p6d-wh',lotId:'lot-a',quantity:10,valueCents:100000,movementType:'RECEIPT',sourceType:'TEST',sourceId:'la',sourceItemId:'la'});
    receiveValue(db,{businessDate:'2026-09-24',productId:'p6d-lot',warehouseId:'p6d-wh',lotId:'lot-b',quantity:10,valueCents:200000,movementType:'RECEIPT',sourceType:'TEST',sourceId:'lb',sourceItemId:'lb'});
    assert.equal(issueValue(db,{businessDate:'2026-09-24',productId:'p6d-lot',warehouseId:'p6d-wh',lotId:'lot-a',quantity:5,movementType:'COGS',sourceType:'TEST',sourceId:'lo',sourceItemId:'lo'}).valueDeltaCents,-50000);
    receiveValue(db,{businessDate:'2026-09-24',productId:'p6d-serial',warehouseId:'p6d-wh',serialId:'sn-1',quantity:1,valueCents:10000,movementType:'RECEIPT',sourceType:'TEST',sourceId:'s1',sourceItemId:'s1'});
    receiveValue(db,{businessDate:'2026-09-24',productId:'p6d-serial',warehouseId:'p6d-wh',serialId:'sn-2',quantity:1,valueCents:20000,movementType:'RECEIPT',sourceType:'TEST',sourceId:'s2',sourceItemId:'s2'});
    const serial=issueValue(db,{businessDate:'2026-09-24',productId:'p6d-serial',warehouseId:'p6d-wh',serialId:'sn-2',quantity:1,movementType:'COGS',sourceType:'TEST',sourceId:'so',sourceItemId:'so'}); assert.equal(serial.valueDeltaCents,-20000);
    assert.equal(restoreOriginalValue(db,{businessDate:'2026-09-24',originalMovementId:serial.id,warehouseId:'p6d-wh',quantity:1,movementType:'RETURN',sourceType:'TEST',sourceId:'sr',sourceItemId:'sr'}).valueDeltaCents,20000);
  });

  test('inbound reversal consumes exact original value rather than current average',()=>{
    const original=receiveValue(db,{businessDate:'2026-09-24',productId:'p6d-none',warehouseId:'p6d-wh',quantity:2,valueCents:24691,movementType:'RECEIPT',sourceType:'ORIGINAL_RECEIPT',sourceId:'r1',sourceItemId:'ri1'});
    const reversed=consumeOriginalInboundValue(db,{businessDate:'2026-09-24',productId:'p6d-none',warehouseId:'p6d-wh',quantity:2,movementType:'RECEIPT_REVERSAL',sourceType:'REVERSAL',sourceId:'rr1',sourceItemId:'rr1',originalSourceType:'ORIGINAL_RECEIPT',originalSourceId:'r1',originalSourceItemId:'ri1'}); assert.equal(reversed[0].valueDeltaCents,-24691); assert.equal(reversed[0].id===original.id,false);
  });

  test('system vouchers auto-post, balance and remain source-idempotent',()=>{
    const input={sourceType:'P6D_SYSTEM',sourceId:'sys1',businessDate:'2026-09-24',actorId:'user-admin',entries:[{role:'OTHER_INVENTORY',direction:'DEBIT',amountCents:12345},{role:'ACCOUNTS_PAYABLE',direction:'CREDIT',amountCents:12345}]}; const first=createSystemVoucher(db,input),second=createSystemVoucher(db,input); assert.equal(second,first); const voucher=db.prepare('SELECT * FROM accounting_vouchers WHERE id=?').get(first); assert.equal(voucher.status,'POSTED'); assert.equal(voucher.voucher_origin,'SYSTEM');
  });

  test('closed inventory or accounting period blocks before mutation',()=>{
    db.prepare("INSERT INTO inventory_period_closures(id,period_key,status,closed_by,closed_at,notes) VALUES('p6d-close','2026-10','CLOSED','user-admin',?,'')").run(at); assert.throws(()=>assertFinancialPeriodsOpen(db,'2026-10-01'),/存货期间/);
    db.prepare("INSERT INTO period_closures(id,period,period_year,period_month,status,created_at) VALUES('p6d-ac','2026-11',2026,11,'CLOSED',?)").run(at); assert.throws(()=>assertFinancialPeriodsOpen(db,'2026-11-01'),/会计期间/);
    // The period guards are shared state. Remove this test's synthetic closes
    // so later valuation/reversal cases continue in an intentionally open period.
    db.prepare("DELETE FROM inventory_period_closures WHERE id='p6d-close'").run();
    db.prepare("DELETE FROM period_closures WHERE id='p6d-ac'").run();
  });

  test('inventory-control reversal mirrors original value and system voucher exactly once',()=>{
    receiveValue(db,{businessDate:'2026-09-24',productId:'p6d-none',warehouseId:'p6d-wh',quantity:3,valueCents:33333,movementType:'INVENTORY_ADJUSTMENT_GAIN',sourceType:'INVENTORY_ADJUSTMENT',sourceId:'adj-reverse',sourceItemId:'adj-line'});
    const originalVoucher=createSystemVoucher(db,{sourceType:'INVENTORY_ADJUSTMENT',sourceId:'adj-reverse',businessDate:'2026-09-24',actorId:'user-admin',entries:[{role:'OTHER_INVENTORY',direction:'DEBIT',amountCents:33333},{role:'INVENTORY_GAIN_LOSS',direction:'CREDIT',amountCents:33333}]});
    const movements=reverseValuationSource(db,{originalSourceType:'INVENTORY_ADJUSTMENT',originalSourceId:'adj-reverse',reversalSourceType:'INVENTORY_ADJUSTMENT_REVERSAL',reversalSourceId:'adj-reversal',businessDate:'2026-09-24'});
    const reversalVoucher=reverseSystemVoucher(db,{originalSourceType:'INVENTORY_ADJUSTMENT',originalSourceId:'adj-reverse',reversalSourceType:'INVENTORY_ADJUSTMENT_REVERSAL',reversalSourceId:'adj-reversal',businessDate:'2026-09-24',actorId:'user-admin',reason:'test'});
    assert.equal(movements.reduce((sum,row)=>sum+row.valueDeltaCents,0),-33333);
    assert.equal(db.prepare('SELECT reversal_of_id FROM accounting_vouchers WHERE id=?').get(reversalVoucher).reversal_of_id,originalVoucher);
    assert.throws(()=>reverseValuationSource(db,{originalSourceType:'INVENTORY_ADJUSTMENT',originalSourceId:'adj-reverse',reversalSourceType:'INVENTORY_ADJUSTMENT_REVERSAL',reversalSourceId:'duplicate',businessDate:'2026-09-24'}),/已冲销/);
  });

  test('confirmed adjustment HTTP reversal restores quantity, value and linked GL exactly once',async()=>{
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,tracking_policy,valuation_method,inventory_classification,standard_manufacturing_cost_cents) VALUES('p6d-adjust','P6D-A','Adjustment','TEST','EA',0,0,1,?,?,?,?,?,1234)").run(at,at,'NONE','MOVING_AVERAGE','OTHER_INVENTORY');
    db.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('p6d-adjust-inv','p6d-wh','p6d-adjust',0,?)").run(at);
    const server=createServer(createApp(db,{distDir:resolve('dist')})); await new Promise((done)=>server.listen(0,'127.0.0.1',done)); const base=`http://127.0.0.1:${server.address().port}`;
    try {
      const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})}); const token=(await login.json()).token;
      const call=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body||{})});return{status:response.status,data:await response.json()};};
      const created=await call('/api/inventory-adjustments',{warehouseId:'p6d-wh',reason:'gain',adjustmentDate:'2026-09-24',items:[{productId:'p6d-adjust',quantityDelta:2}]}); assert.equal(created.status,201,JSON.stringify(created.data));
      assert.equal((await call(`/api/inventory-adjustments/${created.data.id}/confirm`,{})).status,200);
      const reversed=await call(`/api/inventory-adjustments/${created.data.id}/reverse`,{reason:'correction',businessDate:'2026-09-24'}); assert.equal(reversed.status,200,JSON.stringify(reversed.data));
      assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id='p6d-adjust-inv'").get().quantity,0);
      assert.equal(db.prepare("SELECT SUM(value_delta_cents) n FROM inventory_valuation_movements WHERE product_id='p6d-adjust'").get().n,0);
      const reverseVoucher=db.prepare("SELECT reversal_of_id FROM accounting_vouchers WHERE source_type='INVENTORY_ADJUSTMENT_REVERSAL' AND source_id=?").get(reversed.data.id); assert.ok(reverseVoucher?.reversal_of_id);
      assert.equal((await call(`/api/inventory-adjustments/${created.data.id}/reverse`,{reason:'retry',businessDate:'2026-09-24'})).data.replayed,true);
    } finally { await new Promise((done)=>server.close(done)); }
  });

  test('health is CHECK-only and detects a synthetic cache mismatch without repair',()=>{
    const target=db.prepare('SELECT balance_key,value_cents FROM inventory_valuation_balances ORDER BY balance_key LIMIT 1').get(); db.prepare('UPDATE inventory_valuation_balances SET value_cents=value_cents+1 WHERE balance_key=?').run(target.balance_key); const health=systemHealth(db); assert.equal(health.checkOnly,true); assert.equal(health.autoRepair,false); assert.equal(health.checks.find(x=>x.code==='VALUATION_CACHE_VS_LEDGER').status,'FAIL'); assert.equal(db.prepare('SELECT value_cents FROM inventory_valuation_balances WHERE balance_key=?').get(target.balance_key).value_cents,target.value_cents+1);
  });
});
