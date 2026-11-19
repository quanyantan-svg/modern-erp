import { allow, allowAny } from '../lib/http.js';
import { readWorkReferenceInput, referenceItem, sendWorkReferencePage } from '../lib/work-reference.js';

const KINDS = new Set(['SUPPLIER', 'CUSTOMER', 'LOT', 'SERIAL', 'BIN', 'CONTAINER', 'VALUATION_SNAPSHOT']);

function relation(kind, url) {
  const productId = String(url.searchParams.get('productId') || '').trim();
  const warehouseId = String(url.searchParams.get('warehouseId') || '').trim();
  if (kind === 'VALUATION_SNAPSHOT') return {
    identity: 'v.source_id',
    columns: 'v.source_id id,v.source_id code,v.source_type name,MAX(v.business_date) secondaryText,1 active',
    from: 'FROM inventory_valuation_movements v',
    where: ["v.status='POSTED'", 'v.source_id IS NOT NULL'], args: [],
    search: ['v.source_id', 'v.source_type'],
    order: 'MAX(v.business_date) DESC,v.source_id',
    groupBy: 'v.source_id,v.source_type',
    toItem: referenceItem,
  };
  if (kind === 'SUPPLIER') return {
    identity: 's.id', columns: "s.id,s.code,s.name,'供应商（VMI）' secondaryText,s.active", from: 'FROM suppliers s', where: ['s.active=1'], args: [],
    search: ['s.code', 's.name'], order: 's.code,s.id', toItem: referenceItem,
  };
  if (kind === 'CUSTOMER') return {
    identity: 'c.id', columns: "c.id,c.code,c.name,'客户（受托料）' secondaryText,c.active", from: 'FROM customers c', where: ['c.active=1'], args: [],
    search: ['c.code', 'c.name'], order: 'c.code,c.id', toItem: referenceItem,
  };
  if (kind === 'LOT') return {
    identity: 'l.id', columns: "l.id,l.lot_code code,p.name,l.status secondaryText,CASE WHEN l.status IN ('AVAILABLE','HOLD') THEN 1 ELSE 0 END active",
    from: 'FROM inventory_lots l JOIN products p ON p.id=l.product_id', where: [productId ? 'l.product_id=?' : '1=1'], args: productId ? [productId] : [],
    search: ['l.lot_code', 'p.code', 'p.name'], order: 'l.created_at DESC,l.id', toItem: referenceItem,
  };
  if (kind === 'SERIAL') {
    const where = [productId ? 's.product_id=?' : '1=1', warehouseId ? 's.current_warehouse_id=?' : '1=1'];
    const args = [...(productId ? [productId] : []), ...(warehouseId ? [warehouseId] : [])];
    return {
      identity: 's.id', columns: "s.id,s.serial_number code,p.name,s.lifecycle_state secondaryText,CASE WHEN s.lifecycle_state IN ('AVAILABLE','HOLD') THEN 1 ELSE 0 END active",
      from: 'FROM inventory_serials s JOIN products p ON p.id=s.product_id', where, args,
      search: ['s.serial_number', 'p.code', 'p.name'], order: 's.updated_at DESC,s.id', toItem: referenceItem,
    };
  }
  if (kind === 'BIN') return {
    identity: 'b.id', columns: "b.id,b.code,COALESCE(b.name,b.code) name,w.name secondaryText,b.active", from: 'FROM warehouse_bins b JOIN warehouses w ON w.id=b.warehouse_id',
    where: [warehouseId ? 'b.warehouse_id=?' : '1=1', 'b.active=1'], args: warehouseId ? [warehouseId] : [], search: ['b.code', 'b.name', 'w.code', 'w.name'],
    order: 'w.code,b.code,b.id', toItem: referenceItem,
  };
  return {
    identity: 'c.id', columns: "c.id,c.container_no code,c.container_type name,w.name secondaryText,CASE WHEN c.status IN ('OPEN','SEALED') THEN 1 ELSE 0 END active",
    from: 'FROM inventory_containers c JOIN warehouses w ON w.id=c.warehouse_id', where: [warehouseId ? 'c.warehouse_id=?' : '1=1'], args: warehouseId ? [warehouseId] : [],
    search: ['c.container_no', 'c.container_type', 'w.code', 'w.name'], order: 'c.created_at DESC,c.id', toItem: referenceItem,
  };
}

export function listInventoryWorkReferences(db, res, actor, url) {
  const input = readWorkReferenceInput(url, KINDS);
  if (input.kind === 'VALUATION_SNAPSHOT') allowAny(actor, ['INVENTORY_VIEW', 'INVENTORY_ABC_MANAGE']);
  else allow(actor, 'INVENTORY_VIEW');
  return sendWorkReferencePage(db, res, input, relation(input.kind, url));
}
