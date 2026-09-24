import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import {
  allocateDocumentNumber, autoBillReceipt, autoInvoiceDelivery, calculateLineTax, canonicalExport, commercialReconciliation,
  commitImport, createCommercialCreditNote, createOpeningBatch, createSalesInvoice,
  createSupplierBill, createTaxCode, createUomConversion, matchSupplierBill, postSalesInvoice, postSupplierBill,
  quantitySnapshot, stageCsvImport, transitionOpeningBatch, validateImport, validateOpeningBatch,
} from './modules/commercial-golive.js';
import { consumeForecastDemand } from './modules/planning.js';

let handle; let db;
const date = '2026-09-25'; const at = `${date}T08:00:00.000Z`;
const actor = 'user-admin';
before(() => {
  handle = createTempDb({ label: 'v13-p6e' }); db = handle.db;
  db.prepare("UPDATE products SET base_uom_code='EA',tracking_policy='NONE' WHERE id='product-001'").run();
  db.prepare("INSERT OR IGNORE INTO uoms(code,name,created_at,updated_at) VALUES('BOX','Box',?,?)").run(at, at);
  createUomConversion(db, { productId: 'product-001', uomCode: 'BOX', numerator: 10, denominator: 1, effectiveFrom: date });
  createTaxCode(db, { code: 'VAT13', name: 'VAT 13%', rateNumerator: 13, rateDenominator: 100, effectiveFrom: date });
  db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at,billing_mode) VALUES('p6e-del','SD-P6E',NULL,'customer-001','warehouse-001',?,'CONFIRMED',60000,?,'',?,?,?,'SEPARATE')").run(actor,date,actor,at,at);
  db.prepare("INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,document_uom_code,document_quantity_num,base_quantity_num) VALUES('p6e-di','p6e-del','product-001',60,1000,60000,1,'EA',60,60)").run();
  db.prepare("INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,billing_mode) VALUES('p6e-rec','PR-P6E',NULL,'supplier-001','warehouse-001',?,'CONFIRMED',60000,?,'',?,?,?,'SEPARATE')").run(actor,date,actor,at,at);
  db.prepare("INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,document_uom_code,document_quantity_num,base_quantity_num) VALUES('p6e-ri','p6e-rec','product-001',60,1000,60000,1,'EA',60,60)").run();
});
after(() => handle.cleanup());

describe('V1.3 Phase 6E commercial billing, tax, UOM and go-live', () => {
  test('line tax rounding is exact for no-tax, exclusive and inclusive modes', () => {
    assert.deepEqual(calculateLineTax({ amountCents: 101, mode: 'NO_TAX', rateNumerator: 13, rateDenominator: 100 }), { netCents: 101, taxCents: 0, grossCents: 101 });
    assert.deepEqual(calculateLineTax({ amountCents: 101, mode: 'EXCLUSIVE', rateNumerator: 13, rateDenominator: 100 }), { netCents: 101, taxCents: 13, grossCents: 114 });
    assert.deepEqual(calculateLineTax({ amountCents: 113, mode: 'INCLUSIVE', rateNumerator: 13, rateDenominator: 100 }), { netCents: 100, taxCents: 13, grossCents: 113 });
  });

  test('delivery can remain unbilled; partial 40 + 20 succeeds and overbilling fails', () => {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_id='p6e-del'").get().n, 0);
    const first = createSalesInvoice(db, { customerId: 'customer-001', invoiceDate: date, taxMode: 'EXCLUSIVE', items: [{ deliveryItemId: 'p6e-di', quantity: 40, unitPriceCents: 1000, taxCode: 'VAT13' }], actorId: actor, idempotencyKey: 'si-40' });
    postSalesInvoice(db, first.id, actor); const second = createSalesInvoice(db, { customerId: 'customer-001', invoiceDate: date, taxMode: 'NO_TAX', items: [{ deliveryItemId: 'p6e-di', quantity: 20, unitPriceCents: 1000 }], actorId: actor, idempotencyKey: 'si-20' }); postSalesInvoice(db, second.id, actor);
    assert.throws(() => createSalesInvoice(db, { customerId: 'customer-001', invoiceDate: date, taxMode: 'NO_TAX', items: [{ deliveryItemId: 'p6e-di', quantity: 1 }], actorId: actor }), /\u8d85过/);
    const ar = db.prepare("SELECT * FROM account_receivables WHERE source_type='SALES_INVOICE' AND source_id=?").get(first.id); assert.equal(ar.amount_cents, 45200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_INVOICE' AND source_id=?").get(first.id).n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY_COGS' AND source_id='p6e-del'").get().n, 0);
    const credit = createCommercialCreditNote(db, { side: 'AR', sourceId: first.id, creditDate: date, grossCents: 11300, reason: '退货', actorId: actor, idempotencyKey: 'scn-1' });
    assert.equal(credit.tax_cents, 1300); assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_CREDIT_NOTE' AND source_id=?").get(credit.id).n, 1);
  });

  test('receipt remains AP-free; partial supplier bills clear GRNI and post PPV/input tax', () => {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id='p6e-rec'").get().n, 0);
    const first = createSupplierBill(db, { supplierId: 'supplier-001', supplierInvoiceNo: 'SUP-001', billDate: date, taxMode: 'EXCLUSIVE', items: [{ receiptItemId: 'p6e-ri', quantity: 40, unitPriceCents: 1100, taxCode: 'VAT13' }], actorId: actor, idempotencyKey: 'pb-40' });
    assert.equal(first.grni_cents, 40000); assert.equal(first.variance_cents, 4000); postSupplierBill(db, first.id, actor);
    const second = createSupplierBill(db, { supplierId: 'supplier-001', supplierInvoiceNo: 'SUP-002', billDate: date, taxMode: 'NO_TAX', items: [{ receiptItemId: 'p6e-ri', quantity: 20, unitPriceCents: 1000 }], actorId: actor, idempotencyKey: 'pb-20' }); postSupplierBill(db, second.id, actor);
    assert.throws(() => createSupplierBill(db, { supplierId: 'supplier-001', supplierInvoiceNo: 'SUP-OVER', billDate: date, items: [{ receiptItemId: 'p6e-ri', quantity: 1 }], actorId: actor }), /\u8d85过/);
    assert.throws(() => createSupplierBill(db, { supplierId: 'supplier-001', supplierInvoiceNo: 'SUP-001', billDate: date, items: [{ productId: 'product-001', quantity: 1, unitPriceCents: 1 }], actorId: actor }), /UNIQUE/);
    assert.equal(db.prepare("SELECT amount_cents FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(first.id).amount_cents, 49720);
    const credit=createCommercialCreditNote(db,{side:'AP',sourceId:first.id,creditDate:date,grossCents:12430,reason:'供应商折让',actorId:actor,idempotencyKey:'pcn-1'});
    assert.equal(credit.tax_cents,1430);assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SUPPLIER_CREDIT_NOTE' AND source_id=?").get(credit.id).n,1);
  });

  test('DIRECT_BILL and AUTO_BILL create linked authoritative commercial documents', () => {
    db.prepare("INSERT INTO sales_deliveries(id,delivery_no,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at,billing_mode) VALUES('p6e-direct','SD-DIRECT','customer-001','warehouse-001',?,'CONFIRMED',2000,?,'',?,?,?,'DIRECT_BILL')").run(actor,date,actor,at,at);
    db.prepare("INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('p6e-direct-i','p6e-direct','product-001',2,1000,2000,1)").run();
    const invoice=autoInvoiceDelivery(db,'p6e-direct',actor,'direct-test');assert.equal(invoice.status,'POSTED');assert.equal(db.prepare('SELECT delivery_id FROM sales_invoice_items WHERE invoice_id=?').get(invoice.id).delivery_id,'p6e-direct');
    db.prepare("INSERT INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,billing_mode) VALUES('p6e-auto','PR-AUTO','supplier-001','warehouse-001',?,'CONFIRMED',2000,?,'',?,?,?,'AUTO_BILL')").run(actor,date,actor,at,at);
    db.prepare("INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('p6e-auto-i','p6e-auto','product-001',2,1000,2000,1)").run();
    const bill=autoBillReceipt(db,'p6e-auto',actor,'auto-test');assert.equal(bill.status,'POSTED');assert.equal(db.prepare('SELECT receipt_id FROM supplier_bill_items WHERE bill_id=?').get(bill.id).receipt_id,'p6e-auto');
  });

  test('invoice-before-receipt remains WAITING_MATCH and cannot post until a valid match',()=>{
    const waiting=createSupplierBill(db,{supplierId:'supplier-001',supplierInvoiceNo:'EARLY-001',billDate:date,taxMode:'NO_TAX',items:[{productId:'product-001',quantity:1,unitPriceCents:1000}],actorId:actor,idempotencyKey:'early-bill'});assert.equal(waiting.status,'WAITING_MATCH');assert.throws(()=>postSupplierBill(db,waiting.id,actor),/匹配/);
    db.prepare("INSERT INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,billing_mode) VALUES('p6e-match','PR-MATCH','supplier-001','warehouse-001',?,'CONFIRMED',1000,?,'',?,?,?,'SEPARATE')").run(actor,date,actor,at,at);db.prepare("INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('p6e-match-i','p6e-match','product-001',1,1000,1000,1)").run();const item=db.prepare('SELECT id FROM supplier_bill_items WHERE bill_id=?').get(waiting.id);assert.equal(matchSupplierBill(db,waiting.id,{items:[{billItemId:item.id,receiptItemId:'p6e-match-i'}]}).status,'DRAFT');assert.equal(postSupplierBill(db,waiting.id,actor).status,'POSTED');
  });

  test('UOM conversion snapshots BOX to base EA and serial fractional base is rejected', () => {
    const conversion = db.prepare("SELECT * FROM product_uom_conversions WHERE product_id='product-001' AND uom_code='BOX'").get();
    assert.equal(conversion.numerator, 10); assert.equal(conversion.denominator, 1);
    const box=quantitySnapshot(db,'product-001',{quantityNumerator:2,quantityDenominator:1,uomCode:'BOX'},date);
    assert.deepEqual(box.doc,{num:2,den:1});assert.deepEqual(box.base,{num:20,den:1});
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,tracking_policy,base_uom_code) VALUES('p6e-serial','P6E-S','Serial','TEST','EA',0,0,1,?,?,'SERIAL','EA')").run(at,at);
    db.prepare("INSERT INTO uoms(code,name,created_at,updated_at) VALUES('PAIR','Pair',?,?)").run(at,at);
    createUomConversion(db,{productId:'p6e-serial',uomCode:'PAIR',numerator:1,denominator:2,effectiveFrom:date});
    db.prepare("INSERT INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at,billing_mode) VALUES('p6e-sr','PR-SERIAL','supplier-001','warehouse-001',?,'CONFIRMED',1,?,'',?,?,?,'SEPARATE')").run(actor,date,actor,at,at);
    db.prepare("INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('p6e-sri','p6e-sr','p6e-serial',1,1,1,1)").run();
    assert.throws(()=>createSupplierBill(db,{supplierId:'supplier-001',supplierInvoiceNo:'SERIAL-FRACTION',billDate:date,items:[{receiptItemId:'p6e-sri',quantity:1,uomCode:'PAIR'}],actorId:actor}),/SERIAL/);
  });

  test('document sequence is idempotent and unique without COUNT/MAX allocation', () => {
    const one = allocateDocumentNumber(db, 'TEST', date, 'seq-a'); const replay = allocateDocumentNumber(db, 'TEST', date, 'seq-a'); const two = allocateDocumentNumber(db, 'TEST', date, 'seq-b');
    assert.equal(one, replay); assert.notEqual(one, two);
    const source = readFileSync(new URL('./modules/commercial-golive.js', import.meta.url), 'utf8'); const allocator=source.slice(source.indexOf('export function allocateDocumentNumber'),source.indexOf('function atomic')); assert.doesNotMatch(allocator, /COUNT\(\*\).*\+\s*1|MAX\([^)]*\).*\+\s*1/i);
  });

  test('MRP forecast consumption uses the deterministic MAX rule', () => {
    assert.equal(consumeForecastDemand(60,100),100);assert.equal(consumeForecastDemand(120,100),120);
  });

  test('CSV preview is non-mutating, row errors block commit, valid commit is atomic/idempotent', () => {
    const bad=stageCsvImport(db,{entityType:'customers',csv:'code,name\nC-ERR,',idempotencyKey:'import-bad',actorId:actor});assert.equal(validateImport(db,bad.id).valid,false);assert.throws(()=>commitImport(db,bad.id),/\u6821验/);assert.equal(db.prepare("SELECT COUNT(*) n FROM customers WHERE code='C-ERR'").get().n,0);
    const good=stageCsvImport(db,{entityType:'customers',csv:'code,name\nC-P6E,Phase 6E Customer',idempotencyKey:'import-good',actorId:actor});assert.equal(validateImport(db,good.id).valid,true);assert.equal(db.prepare("SELECT COUNT(*) n FROM customers WHERE code='C-P6E'").get().n,0);commitImport(db,good.id);commitImport(db,good.id);assert.equal(db.prepare("SELECT COUNT(*) n FROM customers WHERE code='C-P6E'").get().n,1);
  });

  test('opening batch enforces SOD, balanced validation, atomic posting and activation immutability', () => {
    const clean=createTempDb({label:'v13-p6e-opening',production:true});const odb=clean.db;
    try { odb.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at,name) VALUES('user-admin','p6e-admin','Admin','x','x','role-admin',1,?,'Admin'),('user-reviewer','p6e-reviewer','Reviewer','x','x','role-reviewer',1,?,'Reviewer')").run(at,at);
      odb.prepare("INSERT INTO customers(id,code,name,created_at,updated_at) VALUES('open-c','OPEN-C','Opening Customer',?,?)").run(at,at);
      odb.prepare("INSERT INTO suppliers(id,code,name,created_at,updated_at) VALUES('open-s','OPEN-S','Opening Supplier',?,?)").run(at,at);
      odb.prepare("INSERT INTO warehouses(id,code,name,created_at,updated_at) VALUES('open-w','OPEN-W','Opening Warehouse',?,?)").run(at,at);
      odb.prepare("INSERT INTO products(id,code,name,unit,price_cents,created_at,updated_at,base_uom_code) VALUES('open-p','OPEN-P','Opening Product','EA',100,?,?, 'EA')").run(at,at);
      const batch=createOpeningBatch(odb,{goLiveDate:date,actorId:actor,idempotencyKey:'ob-1',lines:[
        {lineType:'INVENTORY',productId:'open-p',warehouseId:'open-w',quantityNumerator:10,amountCents:1000,debitRole:'OTHER_INVENTORY',referenceNo:'stock'},
        {lineType:'AR',partyId:'open-c',amountCents:2000,debitRole:'ACCOUNTS_RECEIVABLE',referenceNo:'ar'},
        {lineType:'CASH',amountCents:3000,debitRole:'CASH',referenceNo:'cash'},
        {lineType:'AP',partyId:'open-s',amountCents:1500,creditRole:'ACCOUNTS_PAYABLE',referenceNo:'ap'},
        {lineType:'TRIAL_BALANCE',amountCents:4500,creditRole:'BANK',referenceNo:'offset'},
      ]});
      assert.equal(validateOpeningBatch(odb,batch.id).valid,true);transitionOpeningBatch(odb,batch.id,'submit',actor);assert.throws(()=>transitionOpeningBatch(odb,batch.id,'approve',actor),/创建人/);transitionOpeningBatch(odb,batch.id,'approve','user-reviewer');transitionOpeningBatch(odb,batch.id,'post','user-reviewer');transitionOpeningBatch(odb,batch.id,'activate','user-reviewer');
      assert.equal(odb.prepare('SELECT status FROM opening_batches WHERE id=?').get(batch.id).status,'POSTED');
      assert.equal(odb.prepare("SELECT quantity FROM inventory WHERE product_id='open-p' AND warehouse_id='open-w'").get().quantity,10);
      assert.equal(odb.prepare("SELECT amount_cents FROM account_receivables WHERE customer_id='open-c'").get().amount_cents,2000);
      assert.equal(odb.prepare("SELECT amount_cents FROM account_payables WHERE supplier_id='open-s'").get().amount_cents,1500);
      assert.equal(odb.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='OPENING_BATCH' AND source_id=?").get(batch.id).n,1);
      assert.throws(()=>createOpeningBatch(odb,{goLiveDate:date,actorId:actor,lines:[]}),/GO_LIVE/);
    } finally { clean.cleanup(); }
  });

  test('commercial reconciliation is read-only and reports a synthetic mismatch', () => {
    const before=db.prepare('SELECT COUNT(*) n FROM accounting_entries').get().n;const clean=commercialReconciliation(db);assert.equal(clean.checkOnly,true);db.prepare("UPDATE account_receivables SET amount_cents=amount_cents+1 WHERE id=(SELECT id FROM account_receivables WHERE source_type='SALES_INVOICE' LIMIT 1)").run();const mismatch=commercialReconciliation(db);assert.equal(mismatch.status,'FAIL');assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_entries').get().n,before);assert.ok(canonicalExport(db,'tax').length>=2);
  });
});
