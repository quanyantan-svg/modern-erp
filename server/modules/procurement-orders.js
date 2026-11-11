import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit, auditBusinessRejection } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import { roundRational } from './commercial-golive.js';
import { resolvePurchaseLinePricing } from './procurement-pricing.js';
import { assertSupplierQualification } from './procurement-sourcing.js';
import {
  assertPoChangeEnabled, assertSupplierCategoryAllows, procurementParameters,
  resolvePaymentTermsDays,
} from './procurement-policy.js';

const VIEW_PERMISSIONS = ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_MANAGE'];
const CHANGE_PERMISSIONS = ['PO_CHANGE_VIEW', 'PO_CHANGE_MANAGE'];
const STANDARD_BUY_TYPES = new Set(['STANDARD_PURCHASE']);
const BUSINESS_TYPES = new Set(['STANDARD_PURCHASE', 'OUTSOURCE_PROCESSING']);
const ACTIONS = new Set(['ADD', 'MODIFY', 'CANCEL']);

function insertPurchaseOrderItem(db, { id: itemId, orderId, item, lineNo, pricing, version = 1 }) {
  db.prepare(`INSERT INTO purchase_order_items(
      id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_requisition_item_id,is_gift_line,
      document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,
      pricing_uom_code,pricing_quantity_num,pricing_quantity_den,price_entry_id,price_version,pricing_evidence_json,version,execution_status,
      pricing_discount_scheme_id,discount_source)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    itemId, orderId, item.productId, Number(item.quantity), pricing.unitPriceCents, pricing.amountCents,
    lineNo, item.purchaseRequisitionItemId || null, item.isGiftLine ? 1 : 0,
    item.documentUomCode || null,
    item.documentQuantityNumerator ?? (Number.isSafeInteger(Number(item.quantity)) ? Number(item.quantity) : null),
    item.documentQuantityDenominator ?? 1,
    item.conversionNumerator ?? 1, item.conversionDenominator ?? 1,
    item.baseQuantityNumerator ?? (Number.isSafeInteger(Number(item.quantity)) ? Number(item.quantity) : null),
    item.baseQuantityDenominator ?? 1,
    pricing.pricingUomCode || null,
    pricing.pricingQuantityNum ?? null, pricing.pricingQuantityDen ?? null,
    pricing.priceEntryId || null, pricing.priceVersion ?? null,
    pricing.evidence ? JSON.stringify(pricing.evidence) : null, version, 'OPEN',
    pricing.evidence?.appliedDiscount?.id || null,
    pricing.evidence?.appliedDiscount ? `PRICING_DISCOUNT:${pricing.evidence.appliedDiscount.id}` : (pricing.evidence ? 'PRICE_LIST' : null),
  );
}

/**
 * Resolve the authoritative commercial price of one purchase order line.
 *
 * `PURCHASE_RESOLVER` is the only mode an ordinary purchase order may use:
 * the effective supplier price, the discount and the rounding evidence are
 * resolved inside the write transaction and frozen onto the line. A client
 * supplied unit price is only an assertion — it must agree with the resolved
 * price or the write is rejected (Active Design §26.36.3).
 *
 * `FROZEN_COMMERCIAL` belongs to the processing-fee purchase order, whose
 * commercial amount is locked by the approved outsourcing contract and must
 * never be replaced by the ordinary purchase price list.
 */
function resolveOrderLineCommercial(db, { businessType, supplierId, businessDate, item, index }) {
  if (businessType === 'OUTSOURCE_PROCESSING') {
    if (!Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0
      || !Number.isSafeInteger(item.amountCents) || item.amountCents < 0) {
      throw new HttpError(400, `第 ${index + 1} 行金额必须为安全整数分`);
    }
    // 加工费行的价格来源由**委外域**解析并随 `pricingEvidence` 冻结
    // （OUT-03；Active Design §26.36.3）。这里只落库，不重新定价：
    // 调用方已证明来源是 OUTSOURCE 价格表条目或委外合同，条目 ID 因此
    // 可以被引用；没有条目时保持 NULL（不得为缺失的价格编造价格条目）。
    const priceEntryId = item.priceEntryId || null;
    if (priceEntryId) {
      const entry = db.prepare('SELECT id,source_type FROM purchase_price_list_entries WHERE id=?').get(priceEntryId);
      if (!entry || entry.source_type !== 'OUTSOURCE') {
        throw new HttpError(409, '加工费采购订单行不得引用非委外价格条目', { code: 'PROCESSING_PO_PRICE_SOURCE_INVALID' });
      }
    }
    return {
      unitPriceCents: item.unitPriceCents, amountCents: item.amountCents,
      pricingUomCode: item.pricingUomCode || null, pricingQuantityNum: null, pricingQuantityDen: null,
      priceEntryId, priceVersion: item.priceVersion ?? null, evidence: item.pricingEvidence || null,
    };
  }
  const pricing = resolvePurchaseLinePricing(db, {
    supplierId, productId: item.productId, sourceType: 'PURCHASE',
    businessDate: businessDate || new Date().toISOString().slice(0, 10),
    documentUomCode: item.documentUomCode,
    documentQuantity: {
      num: item.documentQuantityNumerator ?? item.quantity,
      den: item.documentQuantityDenominator ?? 1,
    },
    explicitPriceEntryId: item.priceEntryId || undefined,
    giftLine: Boolean(item.isGiftLine),
  });
  if (item.assertedUnitPriceCents !== undefined && item.assertedUnitPriceCents !== null
    && Number(item.assertedUnitPriceCents) !== Number(pricing.unitPriceCents)) {
    throw new HttpError(409, `第 ${index + 1} 行客户端单价与权威价格不一致`, { code: 'PURCHASE_PRICE_EVIDENCE_MISMATCH' });
  }
  return {
    unitPriceCents: pricing.unitPriceCents, amountCents: pricing.grossCents,
    pricingUomCode: pricing.pricingUomCode,
    pricingQuantityNum: pricing.pricingQuantity ? pricing.pricingQuantity.num : null,
    pricingQuantityDen: pricing.pricingQuantity ? pricing.pricingQuantity.den : null,
    priceEntryId: pricing.priceEntryId, priceVersion: pricing.priceVersion, evidence: pricing,
  };
}

/**
 * Purchase order document assignment (buyer / purchasing group).
 *
 * An explicitly named assignment is validated server side: the buyer must be
 * active, the group must be active and the buyer must actually belong to that
 * group. When no assignment is given the creator's own active membership is
 * used. A creator without any membership simply has no recorded assignment —
 * the assignment never silently claims a buyer who does not exist.
 */
function resolvePurchaseOrderAssignment(db, { actorId, buyerId, purchasingGroupId }) {
  if (buyerId || purchasingGroupId) {
    if (!buyerId || !purchasingGroupId) throw new HttpError(400, '采购员与采购组必须成对指定');
    const buyer = db.prepare('SELECT id,active FROM buyers WHERE id=?').get(buyerId);
    if (!buyer || !buyer.active) throw new HttpError(409, '采购员不存在或已停用', { code: 'PURCHASE_BUYER_INVALID' });
    const group = db.prepare('SELECT id,active FROM purchasing_groups WHERE id=?').get(purchasingGroupId);
    if (!group || !group.active) throw new HttpError(409, '采购组不存在或已停用', { code: 'PURCHASE_GROUP_INVALID' });
    const membership = db.prepare('SELECT id FROM buyer_memberships WHERE buyer_id=? AND purchasing_group_id=?').get(buyerId, purchasingGroupId);
    if (!membership) throw new HttpError(409, '采购员不属于该采购组', { code: 'PURCHASE_BUYER_MEMBERSHIP_INVALID' });
    return { buyerId, purchasingGroupId };
  }
  const candidates = db.prepare(`SELECT b.id buyerId, m.purchasing_group_id groupId FROM buyers b
    JOIN buyer_memberships m ON m.buyer_id=b.id
    WHERE b.user_id=? AND b.active=1
    ORDER BY CASE m.role WHEN 'LEAD' THEN 0 ELSE 1 END, m.id`).all(actorId);
  if (!candidates.length) return { buyerId: null, purchasingGroupId: null };
  return { buyerId: candidates[0].buyerId, purchasingGroupId: candidates[0].groupId };
}

export function createPurchaseOrderDraftCanonical(db, actor, command) {
  const businessType = normalizeBusinessType(command.businessType);
  const sourceOutsourcingOrderId = command.sourceOutsourcingOrderId || null;
  if (businessType === 'STANDARD_PURCHASE' && sourceOutsourcingOrderId) {
    throw new HttpError(400, '普通采购订单不得设置委外来源', { code: 'PURCHASE_ORDER_SOURCE_NOT_ALLOWED' });
  }
  if (businessType === 'OUTSOURCE_PROCESSING' && !sourceOutsourcingOrderId) {
    throw new HttpError(400, '加工费采购订单必须绑定委外订单', { code: 'PROCESSING_PO_SOURCE_REQUIRED' });
  }
  if (!Array.isArray(command.items) || !command.items.length) throw new HttpError(400, '采购订单至少需要一条明细');
  if (businessType === 'OUTSOURCE_PROCESSING' && command.items.length !== 1) {
    throw new HttpError(400, '加工费采购订单首期只允许一条来源锁定明细', { code: 'PROCESSING_PO_SINGLE_LINE_REQUIRED' });
  }
  const orderId = command.id || randomUUID();
  const orderNo = command.orderNo || `PO-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const now = command.now || new Date().toISOString();
  // PRC-02：供应商品类驱动单据。委外类供应商不得承接普通采购订单，普通类
  // 供应商不得承接委外加工费采购订单。品类是供应商档案里的既有枚举，本处
  // 只读取它的既有语义，不新增取值。
  // 品类检查先于资质检查：品类决定「这类供应商能否承接这类单据」，是更靠
  // 前的业务事实；先判品类，错误码才是确定的。
  const supplierCategory = assertSupplierCategoryAllows(db, { supplierId: command.supplierId, businessType });
  // An ordinary purchase order needs an effective PURCHASE qualification of
  // the supplier at the order business date. The outsourcing processing-fee
  // order keeps its own OUTSOURCE qualification contract.
  if (businessType === 'STANDARD_PURCHASE') {
    try {
      assertSupplierQualification(db, command.supplierId, 'PURCHASE', command.orderDate || now.slice(0, 10));
    } catch (error) {
      throw new HttpError(409, '供应商在订单业务日期不具备有效采购资质', { code: 'PURCHASE_SUPPLIER_NOT_QUALIFIED' });
    }
  }
  // PRC-02：付款天数在客户端未指定时由供应商采购档案的默认值驱动；客户端
  // 显式指定时以其为准，并冻结来源以便追溯。
  // `paymentTermsDaysClientSpecified` 由调用方给出「客户端是否明确说了付款
  // 天数」的信号；缺失时以「非空即视为已指定」为保守口径。
  const paymentTerms = resolvePurchaseOrderPaymentTerms(db, {
    businessType,
    supplierId: command.supplierId,
    clientPaymentTermsDays: command.paymentTermsDays,
    clientSpecified: command.paymentTermsDaysClientSpecified ?? null,
  });
  const pricedItems = command.items.map((item, index) => ({
    item,
    commercial: resolveOrderLineCommercial(db, {
      businessType, supplierId: command.supplierId, businessDate: command.orderDate, item, index,
    }),
  }));
  const assignment = resolvePurchaseOrderAssignment(db, {
    actorId: actor.id, buyerId: command.buyerId || null, purchasingGroupId: command.purchasingGroupId || null,
  });
  const prepaymentRequired = command.prepaymentRequired === undefined
    ? (procurementParameters(db).prepaymentRequiredDefault ? 1 : 0)
    : (command.prepaymentRequired ? 1 : 0);
  const totalCents = pricedItems.reduce((sum, entry) => sum + entry.commercial.amountCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new HttpError(400, '采购订单总额必须为安全整数分');
  db.prepare(`INSERT INTO purchase_orders(
      id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,
      order_date,expected_delivery_date,payment_terms,payment_terms_days,supplier_contact_name,supplier_contact_phone,supplier_address,
      business_type,source_outsourcing_order_id,supplier_contact_snapshot,supplier_address_snapshot,payment_terms_snapshot,purchase_requisition_id,
      buyer_id,purchasing_group_id,prepayment_required,settlement_supplier_id,payee_supplier_id,
      payment_terms_days_source,supplier_category_snapshot)
    VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    orderId, orderNo, command.supplierId, totalCents, command.remark || '', actor.id, now, now,
    command.orderDate || null, command.expectedDeliveryDate || null, command.paymentTerms || '', paymentTerms.paymentTermsDays ?? null,
    command.supplierContactName || '', command.supplierContactPhone || '', command.supplierAddress || '',
    businessType, sourceOutsourcingOrderId, command.supplierContactSnapshot || '', command.supplierAddressSnapshot || '',
    command.paymentTermsSnapshot || '', command.purchaseRequisitionId || null,
    assignment.buyerId, assignment.purchasingGroupId, prepaymentRequired,
    command.settlementSupplierId || command.supplierId, command.payeeSupplierId || command.settlementSupplierId || command.supplierId,
    paymentTerms.source, supplierCategory,
  );
  for (const [index, entry] of pricedItems.entries()) {
    insertPurchaseOrderItem(db, {
      id: entry.item.id || randomUUID(), orderId, item: entry.item, lineNo: entry.item.lineNo || index + 1,
      pricing: entry.commercial,
    });
  }
  audit(db, actor.id, command.auditAction || 'CREATE', 'PURCHASE_ORDER', orderId,
    command.auditDetail || `创建采购订单 ${orderNo}`);
  return { id: orderId, orderNo, totalCents };
}

/**
 * 采购订单表头的商业口径解析（PRC-02）。
 *
 * 付款天数的权威来源是**供应商采购档案的默认值**；客户端显式给出时以客户端
 * 为准，并把「天数 + 来源」一起冻结在单据上，档案后续变更不改写历史单据。
 *
 * 供应商采购档案的默认值只驱动**普通采购订单**：委外加工费采购订单的付款
 * 条件由**已批准的委外合同**决定，采购档案的默认值对它没有业务含义，因此
 * 该单据保持「客户端给出什么就是什么，没有就是空」的既有语义。
 *
 * `clientSpecified` 是权威的「客户端是否明确说了付款天数」信号；缺失时以
 * 「非空且非零即视为已指定」的保守口径处理。
 */
export function resolvePurchaseOrderPaymentTerms(db, {
  businessType, supplierId, clientPaymentTermsDays, clientSpecified = null,
}) {
  if (businessType !== 'STANDARD_PURCHASE') {
    const stated = clientSpecified === null
      ? (clientPaymentTermsDays !== undefined && clientPaymentTermsDays !== null
        && clientPaymentTermsDays !== '' && Number(clientPaymentTermsDays) !== 0)
      : clientSpecified;
    const hasValue = stated && clientPaymentTermsDays !== undefined
      && clientPaymentTermsDays !== null && clientPaymentTermsDays !== '';
    return {
      paymentTermsDays: hasValue ? Number(clientPaymentTermsDays) : null,
      source: hasValue ? 'CLIENT' : 'NONE',
    };
  }
  return resolvePaymentTermsDays(db, {
    supplierId, clientPaymentTermsDays, clientSpecified,
  });
}

/**
 * 采购订单表头的**权威**口径（创建与整体改写共用同一份实现）。
 *
 * 返回供应商品类快照与解析后的付款天数及其来源。客户端给出的金额与天数都
 * 不是权威：品类由供应商档案决定，付款天数在客户端未指定时由档案默认值决定。
 */
export function resolvePurchaseOrderHeaderCommercial(db, {
  supplierId, businessType, clientPaymentTermsDays, clientSpecified = null,
}) {
  const supplierCategory = assertSupplierCategoryAllows(db, { supplierId, businessType });
  const paymentTerms = resolvePurchaseOrderPaymentTerms(db, {
    businessType, supplierId, clientPaymentTermsDays, clientSpecified,
  });
  return {
    supplierCategory,
    paymentTermsDays: paymentTerms.paymentTermsDays ?? null,
    paymentTermsDaysSource: paymentTerms.source,
  };
}

/**
 * Update one purchase order line in place, keeping its identity.
 *
 * PRC-12：带有请购转换分配事实的行**不得**被删除重建 ——
 * `pr_conversion_allocations.purchase_order_item_id` 是指向采购订单行的外键，
 * 删除重建会让事实指向不存在的行（并触发外键失败）。保留行标识、原位更新
 * 商业列，是既保住事实指针、又不放弃商业字段可编辑的唯一写法。
 *
 * `purchase_requisition_item_id` 不在本更新的列集合内：它是该行的来源身份，
 * 由转换事实确定，不得由本次改写改写。
 */
function updatePurchaseOrderItemInPlace(db, { itemId, orderId, item, lineNo, pricing }) {
  db.prepare(`UPDATE purchase_order_items SET
      product_id=?,quantity=?,unit_price_cents=?,amount_cents=?,line_no=?,is_gift_line=?,
      document_uom_code=?,document_quantity_num=?,document_quantity_den=?,
      conversion_numerator=?,conversion_denominator=?,base_quantity_num=?,base_quantity_den=?,
      pricing_uom_code=?,pricing_quantity_num=?,pricing_quantity_den=?,
      price_entry_id=?,price_version=?,pricing_evidence_json=?,
      pricing_discount_scheme_id=?,discount_source=?,version=version+1
    WHERE id=? AND order_id=?`).run(
    item.productId, Number(item.quantity), pricing.unitPriceCents, pricing.amountCents, lineNo,
    item.isGiftLine ? 1 : 0,
    item.documentUomCode || null,
    item.documentQuantityNumerator ?? (Number.isSafeInteger(Number(item.quantity)) ? Number(item.quantity) : null),
    item.documentQuantityDenominator ?? 1,
    item.conversionNumerator ?? 1, item.conversionDenominator ?? 1,
    item.baseQuantityNumerator ?? (Number.isSafeInteger(Number(item.quantity)) ? Number(item.quantity) : null),
    item.baseQuantityDenominator ?? 1,
    pricing.pricingUomCode || null,
    pricing.pricingQuantityNum ?? null, pricing.pricingQuantityDen ?? null,
    pricing.priceEntryId ?? null, pricing.priceVersion ?? null,
    pricing.evidence ? JSON.stringify(pricing.evidence) : null,
    pricing.evidence?.appliedDiscount?.id || null,
    pricing.evidence?.appliedDiscount ? `PRICING_DISCOUNT:${pricing.evidence.appliedDiscount.id}` : (pricing.evidence ? 'PRICE_LIST' : null),
    itemId, orderId,
  );
}

/**
 * Canonical rewrite of the lines of a DRAFT purchase order.
 *
 * A draft line has no approved commercial history, so the rewrite is allowed
 * to replace the lines — but never a line that already carries an applied
 * change version, because that version is immutable history.
 *
 * PRC-12：携带请购转换分配事实的行**原位更新**（行标识不变），因此
 * `pr_conversion_allocations` 这张只追加的事实表不需要任何 UPDATE，它的
 * 外键指针原样有效。两道 fail-closed 门禁在任何写入之前生效：
 * 分配事实的请购明细不得被改写删除，分配数量不得与改写后的行数量不一致。
 */
export function replacePurchaseOrderItemsCanonical(db, { orderId, items, businessType, supplierId, businessDate }) {
  const versioned = db.prepare('SELECT COUNT(*) n FROM purchase_order_item_versions WHERE order_id=?').get(orderId).n;
  if (Number(versioned) > 0) {
    throw new HttpError(409, '采购订单行存在已应用的变更历史，不可整体改写', { code: 'PO_ITEM_VERSION_HISTORY_EXISTS' });
  }
  const pricedItems = items.map((item, index) => ({
    item,
    commercial: resolveOrderLineCommercial(db, {
      businessType, supplierId, businessDate, item, index,
    }),
  }));
  const allocations = db.prepare(`SELECT id,requisition_item_id,purchase_order_item_id,
      allocated_quantity_num,allocated_quantity_den FROM pr_conversion_allocations
    WHERE purchase_order_id=?`).all(orderId);
  const allocationByRequisitionItem = new Map();
  for (const allocation of allocations) {
    const previous = allocationByRequisitionItem.get(allocation.requisition_item_id);
    if (previous) {
      throw new HttpError(409, `请购明细 ${allocation.requisition_item_id} 存在多条转换分配事实，不可整体改写`, {
        code: 'PO_ITEM_ALLOCATION_DUPLICATE_FACT',
      });
    }
    allocationByRequisitionItem.set(allocation.requisition_item_id, allocation);
  }
  for (const allocation of allocations) {
    const line = pricedItems.find((entry) => entry.item.purchaseRequisitionItemId === allocation.requisition_item_id);
    if (!line) {
      throw new HttpError(409, `请购明细 ${allocation.requisition_item_id} 的转换分配事实不可被整体改写删除`, {
        code: 'PO_ITEM_ALLOCATION_SOURCE_LOST',
      });
    }
    const allocated = Number(allocation.allocated_quantity_num) / Number(allocation.allocated_quantity_den);
    if (Math.abs(Number(line.item.quantity) - allocated) > 1e-9) {
      throw new HttpError(409, `请购明细 ${allocation.requisition_item_id} 的转换分配数量 ${allocated} 与改写后的行数量 ${Number(line.item.quantity)} 不一致`, {
        code: 'PO_ITEM_ALLOCATION_QUANTITY_MISMATCH',
      });
    }
  }
  const preservedItemIds = new Set(allocations.map((allocation) => allocation.purchase_order_item_id));
  if (preservedItemIds.size) {
    const placeholders = [...preservedItemIds].map(() => '?').join(',');
    db.prepare(`DELETE FROM purchase_order_items WHERE order_id=? AND id NOT IN (${placeholders})`)
      .run(orderId, ...preservedItemIds);
  } else {
    db.prepare('DELETE FROM purchase_order_items WHERE order_id=?').run(orderId);
  }
  for (const [index, entry] of pricedItems.entries()) {
    const lineNo = entry.item.lineNo || index + 1;
    const preservedId = allocationByRequisitionItem.get(entry.item.purchaseRequisitionItemId)?.purchase_order_item_id;
    if (preservedId) {
      updatePurchaseOrderItemInPlace(db, {
        itemId: preservedId, orderId, item: entry.item, lineNo, pricing: entry.commercial,
      });
    } else {
      insertPurchaseOrderItem(db, {
        id: entry.item.id || randomUUID(), orderId, item: entry.item, lineNo, pricing: entry.commercial,
      });
    }
  }
  const totalCents = pricedItems.reduce((sum, entry) => sum + entry.commercial.amountCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new HttpError(400, '采购订单总额必须为安全整数分');
  db.prepare('UPDATE purchase_orders SET total_cents=? WHERE id=?').run(totalCents, orderId);
  return { totalCents };
}

function assertProcessingPurchaseOrderChangeAllowed(order) {
  if (order && (order.business_type || 'STANDARD_PURCHASE') === 'OUTSOURCE_PROCESSING') {
    throw new HttpError(409, '首期加工费采购订单不允许 ADD/MODIFY/CANCEL 变更', { code: 'PROCESSING_PO_CHANGE_NOT_ALLOWED' });
  }
}

/**
 * 加工费 PO 商业字段原位更新器（Active Design §3 / §5.5）。
 *
 * 只允许 `DRAFT` / `REJECTED`，只允许商业白名单，且必须原位 UPDATE：
 * `purchase_order_items.id`、来源身份、产品、数量与 UOM/换算快照一律不可变。
 * 调用方负责事务与权限；本函数自身在事务内重读并校验权威委外来源。
 */
export function updateOutsourcingProcessingPurchaseOrderCommercialFields(db, { orderId, actor, input, now }) {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  if ((order.business_type || 'STANDARD_PURCHASE') !== 'OUTSOURCE_PROCESSING') {
    throw new HttpError(409, '非加工费采购订单不得使用加工费商业更新器', { code: 'PROCESSING_PO_SOURCE_IMMUTABLE' });
  }
  if (!['DRAFT', 'REJECTED'].includes(order.status)) {
    throw new HttpError(409, '加工费采购订单状态不可修改', { code: 'PROCESSING_PO_STATE_CHANGED' });
  }
  const stored = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(orderId);
  const source = order.source_outsourcing_order_id
    ? db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(order.source_outsourcing_order_id)
    : null;
  const requested = input.items[0];
  if (!source || stored.length !== 1 || input.items.length !== 1
    || input.supplierId !== order.supplier_id || input.supplierId !== source.supplier_id
    || requested.productId !== stored[0].product_id || requested.productId !== source.product_id
    || requested.quantity !== Number(stored[0].quantity)
    || requested.documentUomCode !== stored[0].document_uom_code
    || requested.documentQuantityNumerator !== Number(stored[0].document_quantity_num)
    || requested.documentQuantityDenominator !== Number(stored[0].document_quantity_den)
    || requested.conversionNumerator !== Number(stored[0].conversion_numerator)
    || requested.conversionDenominator !== Number(stored[0].conversion_denominator)
    || requested.baseQuantityNumerator !== Number(stored[0].base_quantity_num)
    || requested.baseQuantityDenominator !== Number(stored[0].base_quantity_den)) {
    throw new HttpError(409, '加工费采购订单仅允许修改商业字段，来源、供应商、货品、数量及单位不可变', { code: 'PROCESSING_PO_SOURCE_IMMUTABLE' });
  }
  db.prepare(`UPDATE purchase_orders SET total_cents=?,remark=?,status='DRAFT',rejection_reason='',updated_at=?,
      order_date=?,expected_delivery_date=?,payment_terms=?,payment_terms_days=?,supplier_contact_name=?,supplier_contact_phone=?,supplier_address=?
    WHERE id=?`).run(
    input.totalCents, input.remark, now, input.orderDate, input.expectedDeliveryDate, input.paymentTerms, input.paymentTermsDays,
    input.supplierContactName, input.supplierContactPhone, input.supplierAddress, orderId,
  );
  db.prepare('UPDATE purchase_order_items SET unit_price_cents=?,amount_cents=?,is_gift_line=? WHERE id=?')
    .run(requested.unitPriceCents, requested.amountCents, requested.isGiftLine, stored[0].id);
  audit(db, actor.id, 'UPDATE', 'PURCHASE_ORDER', orderId, `修改加工费采购订单商业字段 ${order.order_no}`);
  return { itemId: stored[0].id };
}

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'PURCHASE_ORDERS_MANAGE'); }
function assertChangePermission(actor) { allowAny(actor, CHANGE_PERMISSIONS); }
function assertChangeManagePermission(actor) { allow(actor, 'PO_CHANGE_MANAGE'); }
function assertChangeApprovePermission(actor) { allow(actor, 'PURCHASE_ORDERS_APPROVE'); }

function normalizeBusinessType(value, fallback = 'STANDARD_PURCHASE') {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value).trim().toUpperCase();
  if (!BUSINESS_TYPES.has(text)) throw new HttpError(400, '业务类型不正确');
  return text;
}

function normalizeAction(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!ACTIONS.has(text)) throw new HttpError(400, '变更动作不正确');
  return text;
}

function rowToSchedule(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    plannedQuantity: row.planned_quantity,
    plannedDate: row.planned_date,
    plannedDateFrom: row.planned_date_from || null,
    plannedDateTo: row.planned_date_to || null,
    sequenceNo: row.sequence_no === null || row.sequence_no === undefined ? null : Number(row.sequence_no),
    receivedQuantity: row.received_quantity,
    upperTolerancePct: row.upper_tolerance_pct,
    lowerTolerancePct: row.lower_tolerance_pct,
    status: row.status || 'OPEN',
    closedAt: row.closed_at || null,
    closedBy: row.closed_by || null,
  };
}

function rowToChange(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    action: row.action,
    status: row.status,
    payload: JSON.parse(row.payload_json),
    original: row.original_json ? JSON.parse(row.original_json) : null,
    requested: row.requested_json ? JSON.parse(row.requested_json) : null,
    applied: row.applied_json ? JSON.parse(row.applied_json) : null,
    approverId: row.approver_id,
    approvedAt: row.approved_at,
    appliedAt: row.applied_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    scope: row.scope || 'LINE',
    orderVersionBefore: row.order_version_before,
    idempotencyKey: row.idempotency_key,
    snapshotBefore: row.snapshot_before_json ? JSON.parse(row.snapshot_before_json) : null,
    snapshotAfter: row.snapshot_after_json ? JSON.parse(row.snapshot_after_json) : null,
  };
}

function stableFingerprint(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
    return input;
  };
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

function orderSnapshot(db, orderId) {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no,id').all(orderId);
  return { order, items, execution: getPurchaseOrderExecution(db, orderId) };
}

function saveItemVersion(db, item, changeId, actorId, now) {
  db.prepare(`INSERT INTO purchase_order_item_versions(id,order_item_id,order_id,version,snapshot_json,source_change_id,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), item.id, item.order_id, Number(item.version || 1), JSON.stringify(item), changeId || null, actorId, now);
}

function recalculateOrderTotal(db, orderId) {
  const total = Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM purchase_order_items WHERE order_id=? AND COALESCE(execution_status,'OPEN')='OPEN'").get(orderId).total || 0);
  if (!Number.isSafeInteger(total)) throw new HttpError(409, '采购订单总额超出安全整数范围', { code: 'PURCHASE_ORDER_TOTAL_UNSAFE' });
  db.prepare('UPDATE purchase_orders SET total_cents=? WHERE id=?').run(total, orderId);
  return total;
}

function resolveChangeLinePricing(db, order, payload, currentItem = null) {
  const productId = payload.productId || currentItem?.product_id;
  const product = db.prepare('SELECT id,base_uom_code,unit FROM products WHERE id=? AND active=1').get(productId);
  if (!product) throw new HttpError(409, '采购订单变更产品不存在或已停用', { code: 'PO_CHANGE_PRODUCT_INVALID' });
  const documentUomCode = payload.documentUomCode || currentItem?.document_uom_code || product.base_uom_code || product.unit || 'EA';
  const item = {
    productId,
    quantity: Number(payload.quantity),
    documentUomCode,
    documentQuantityNumerator: payload.quantityNumerator ?? payload.quantity,
    documentQuantityDenominator: payload.quantityDenominator ?? 1,
    isGiftLine: Boolean(payload.isGiftLine ?? currentItem?.is_gift_line),
    assertedUnitPriceCents: payload.unitPriceCents,
    priceEntryId: payload.priceEntryId || undefined,
  };
  return resolveOrderLineCommercial(db, {
    businessType: 'STANDARD_PURCHASE', supplierId: order.supplier_id, businessDate: order.order_date, item, index: 0,
  });
}

function normalizeChangeRequest(body) {
  const payload = body.payload || {};
  const request = {
    action: normalizeAction(body.action),
    scope: String(body.scope || (body.action && String(body.action).toUpperCase() === 'CANCEL' && !payload.orderItemId ? 'HEADER' : 'LINE')).toUpperCase(),
    orderId: body.orderId,
    target: null,
    add: null,
  };
  if (request.action === 'ADD') {
    request.add = {
      productId: payload.productId || null,
      quantity: payload.quantity ?? null,
      quantityNumerator: payload.quantityNumerator ?? null,
      quantityDenominator: payload.quantityDenominator ?? null,
      documentUomCode: payload.documentUomCode || null,
      unitPriceCents: payload.unitPriceCents ?? null,
      priceEntryId: payload.priceEntryId || null,
      isGiftLine: Boolean(payload.isGiftLine),
      lineNo: payload.lineNo ?? null,
    };
    return request;
  }
  if (request.action === 'MODIFY') {
    request.target = {
      orderItemId: payload.orderItemId || null,
      quantity: payload.quantity ?? null,
      quantityNumerator: payload.quantityNumerator ?? null,
      quantityDenominator: payload.quantityDenominator ?? null,
      documentUomCode: payload.documentUomCode || null,
      unitPriceCents: payload.unitPriceCents ?? null,
      priceEntryId: payload.priceEntryId || null,
      isGiftLine: payload.isGiftLine ?? null,
    };
    return request;
  }
  request.target = { orderItemId: payload.orderItemId || null };
  return request;
}

/**
 * Canonical PO Execution Read Model — single source of truth for
 * ordered / notified / received / returned / reserved / remaining.
 *
 * Every consumer (MRP, Planner Workbench, Planning reservation, Receiving,
 * PO Change) reads this model. No consumer may assemble its own PO quantity
 * SQL: a second口径 would silently diverge from the applied commercial truth
 * (Active Design §26.36.5).
 */
function loadOrderExecutionFacts(db, orderId) {
  const noticeRows = db.prepare(`SELECT rni.purchase_order_item_id item_id, COALESCE(SUM(rni.quantity),0) qty
    FROM receipt_notices rn JOIN receipt_notice_items rni ON rni.notice_id=rn.id
    WHERE rn.purchase_order_id=? AND rn.status<>'CANCELLED' GROUP BY rni.purchase_order_item_id`).all(orderId);
  const noticeMap = new Map(noticeRows.map((row) => [row.item_id, Number(row.qty || 0)]));
  const receivedRows = db.prepare(`SELECT pri.purchase_order_item_id item_id, COALESCE(SUM(pri.quantity),0) qty
    FROM purchase_receipts pr JOIN purchase_receipt_items pri ON pri.receipt_id=pr.id
    WHERE pr.purchase_order_id=? AND pr.status='CONFIRMED' AND pri.purchase_order_item_id IS NOT NULL
    GROUP BY pri.purchase_order_item_id`).all(orderId);
  const receivedMap = new Map(receivedRows.map((row) => [row.item_id, Number(row.qty || 0)]));
  // Historical receipts may only reference the PO header. Their product total
  // is allocated deterministically across the matching lines without ever
  // rewriting history; new receipts always carry the authoritative line FK.
  const legacyReceivedRows = db.prepare(`SELECT pri.product_id, COALESCE(SUM(pri.quantity),0) qty
    FROM purchase_receipts pr JOIN purchase_receipt_items pri ON pri.receipt_id=pr.id
    WHERE pr.purchase_order_id=? AND pr.status='CONFIRMED' AND pri.purchase_order_item_id IS NULL
    GROUP BY pri.product_id`).all(orderId);
  const legacyReceived = new Map(legacyReceivedRows.map((row) => [row.product_id, Number(row.qty || 0)]));
  const returnedRows = db.prepare(`SELECT prei.purchase_order_item_id item_id, COALESCE(SUM(prti.quantity),0) qty
    FROM purchase_returns pr JOIN purchase_receipts prh ON prh.id=pr.receipt_id
    JOIN purchase_return_items prti ON prti.return_id=pr.id
    JOIN purchase_receipt_items prei ON prei.id=prti.receipt_item_id
    WHERE prh.purchase_order_id=? AND pr.status='CONFIRMED' AND prei.purchase_order_item_id IS NOT NULL
    GROUP BY prei.purchase_order_item_id`).all(orderId);
  const returnedMap = new Map(returnedRows.map((row) => [row.item_id, Number(row.qty || 0)]));
  const legacyReturnedRows = db.prepare(`SELECT prti.product_id, COALESCE(SUM(prti.quantity),0) qty
    FROM purchase_returns pr JOIN purchase_receipts prh ON prh.id=pr.receipt_id
    JOIN purchase_return_items prti ON prti.return_id=pr.id
    LEFT JOIN purchase_receipt_items prei ON prei.id=prti.receipt_item_id
    WHERE prh.purchase_order_id=? AND pr.status='CONFIRMED' AND prei.purchase_order_item_id IS NULL
    GROUP BY prti.product_id`).all(orderId);
  const legacyReturned = new Map(legacyReturnedRows.map((row) => [row.product_id, Number(row.qty || 0)]));
  const reservationRows = db.prepare(`SELECT COALESCE(supply_source_line_id,'') line_id, product_id, COALESCE(SUM(quantity),0) quantity
    FROM planning_reservations
    WHERE supply_source_type='PURCHASE_ORDER' AND supply_source_id=? AND status='ACTIVE'
    GROUP BY COALESCE(supply_source_line_id,''), product_id`).all(orderId);
  const scheduleRows = db.prepare(`SELECT order_item_id item_id, COALESCE(SUM(planned_quantity - received_quantity),0) qty
    FROM purchase_order_delivery_schedules WHERE order_id=? GROUP BY order_item_id`).all(orderId);
  return {
    noticeMap, receivedMap, legacyReceived, returnedMap, legacyReturned,
    reservations: reservationRows.map((row) => ({
      lineId: row.line_id || null,
      productId: row.product_id,
      quantity: Number(row.quantity || 0),
    })),
    scheduleMap: new Map(scheduleRows.map((row) => [row.item_id, Number(row.qty || 0)])),
  };
}

function takeFromPool(pool, productId, capacity) {
  const available = Number(pool.get(productId) || 0);
  const taken = Math.min(Math.max(0, capacity), available);
  pool.set(productId, Math.max(0, available - taken));
  return taken;
}

function buildLineExecution(order, item, facts) {
  const ordered = Number(item.quantity);
  const notified = Number(facts.noticeMap.get(item.id) || 0);
  const linkedReceived = Number(facts.receivedMap.get(item.id) || 0);
  const legacyReceived = takeFromPool(facts.legacyReceived, item.product_id, Math.max(0, ordered - linkedReceived));
  const received = linkedReceived + legacyReceived;
  const linkedReturned = Number(facts.returnedMap.get(item.id) || 0);
  const legacyReturned = takeFromPool(facts.legacyReturned, item.product_id, Math.max(0, ordered - linkedReturned));
  const returned = linkedReturned + legacyReturned;
  const cancelled = (item.execution_status || 'OPEN') === 'CANCELLED';
  const reserved = facts.reservations
    .filter((row) => row.productId === item.product_id && (!row.lineId || row.lineId === item.id))
    .reduce((total, row) => total + row.quantity, 0);
  const scheduled = Number(facts.scheduleMap.get(item.id) || 0);
  const remaining = cancelled ? 0 : Math.max(0, ordered - received);
  return {
    orderId: order.id,
    orderItemId: item.id,
    lineNo: Number(item.line_no || 0),
    productId: item.product_id,
    businessType: order.business_type || 'STANDARD_PURCHASE',
    eligibleForBuySupply: (order.business_type || 'STANDARD_PURCHASE') === 'STANDARD_PURCHASE',
    ordered, notified, received, returned, reserved, scheduled,
    cancelled, remaining, availableRemaining: Math.max(0, remaining - reserved),
    version: Number(item.version || 1),
    executionStatus: cancelled ? 'CANCELLED'
      : remaining > 0 ? (received > 0 ? 'PARTIALLY_RECEIVED' : 'OPEN') : 'FULFILLED',
  };
}

/**
 * Line-level canonical execution across the purchase order supply.
 *
 * `includeClosed=false` keeps only the lines that still contribute open
 * supply. A cancelled line never contributes; an `OUTSOURCE_PROCESSING` order
 * is never eligible for BUY supply.
 */
export function getPurchaseOrderLineExecution(db, {
  orderId = null, orderItemId = null, productId = null, supplierId = null, includeClosed = false,
} = {}) {
  const conditions = [];
  const params = [];
  if (orderId) { conditions.push('po.id=?'); params.push(orderId); }
  if (orderItemId) { conditions.push('poi.id=?'); params.push(orderItemId); }
  if (productId) { conditions.push('poi.product_id=?'); params.push(productId); }
  if (supplierId) { conditions.push('po.supplier_id=?'); params.push(supplierId); }
  const rows = db.prepare(`SELECT poi.*, po.id order_id, po.order_no, po.supplier_id, po.status order_status,
      po.business_type, po.expected_delivery_date, po.order_date, po.created_at order_created_at
    FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.order_id
    ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
    ORDER BY po.id, poi.line_no, poi.id`).all(...params);
  const orders = new Map();
  for (const row of rows) {
    if (!orders.has(row.order_id)) {
      orders.set(row.order_id, {
        order: {
          id: row.order_id, order_no: row.order_no, supplier_id: row.supplier_id,
          status: row.order_status, business_type: row.business_type,
          expected_delivery_date: row.expected_delivery_date, order_date: row.order_date,
        },
        items: [],
      });
    }
    orders.get(row.order_id).items.push(row);
  }
  const lines = [];
  for (const entry of orders.values()) {
    const facts = loadOrderExecutionFacts(db, entry.order.id);
    for (const item of entry.items) lines.push(buildLineExecution(entry.order, item, facts));
  }
  if (includeClosed) return lines;
  return lines.filter((line) => !line.cancelled && line.remaining > 0);
}

export function getPurchaseOrderExecution(db, orderId) {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(orderId);
  const facts = loadOrderExecutionFacts(db, orderId);
  const executionItems = items.map((item) => buildLineExecution(order, item, facts));
  const aggregate = executionItems.reduce((acc, item) => ({
    ordered: acc.ordered + item.ordered,
    notified: acc.notified + item.notified,
    received: acc.received + item.received,
    returned: acc.returned + item.returned, reserved: acc.reserved + item.reserved,
    scheduled: acc.scheduled + item.scheduled,
    remaining: acc.remaining + item.remaining,
    availableRemaining: acc.availableRemaining + item.availableRemaining,
  }), { ordered: 0, notified: 0, received: 0, returned: 0, reserved: 0, scheduled: 0, remaining: 0, availableRemaining: 0 });
  return {
    orderId,
    businessType: order.business_type || 'STANDARD_PURCHASE',
    eligibleForBuySupply: (order.business_type || 'STANDARD_PURCHASE') === 'STANDARD_PURCHASE',
    status: executionItems.length && executionItems.every((item) => item.cancelled) ? 'CANCELLED'
      : executionItems.length && executionItems.every((item) => item.remaining === 0) ? 'FULFILLED'
        : executionItems.some((item) => item.received > 0) ? 'PARTIALLY_RECEIVED' : order.status,
    items: executionItems,
    aggregate,
  };
}

export function listOpenRemainingBySupplierProduct(db, supplierId, productId) {
  return getPurchaseOrderLineExecution(db, { supplierId, productId })
    .filter((line) => line.eligibleForBuySupply)
    .map((line) => ({
      order_id: line.orderId, order_item_id: line.orderItemId, ordered: line.ordered,
      received: line.received, returned: line.returned, reserved: line.reserved,
      remaining: line.remaining, available_remaining: line.availableRemaining,
    }));
}

export function listStandardPurchaseSupplyByProduct(db, productId, { expectedThrough = null } = {}) {
  const rows = db.prepare(`SELECT DISTINCT po.id FROM purchase_orders po JOIN purchase_order_items poi ON poi.order_id=po.id
    WHERE poi.product_id=? AND po.status='APPROVED'
      AND (po.business_type IS NULL OR po.business_type='STANDARD_PURCHASE')`).all(productId);
  const lines = [];
  for (const { id: orderId } of rows) {
    const execution = getPurchaseOrderExecution(db, orderId);
    if (!execution.eligibleForBuySupply) continue;
    if (expectedThrough) {
      const order = db.prepare('SELECT expected_delivery_date,order_date,created_at FROM purchase_orders WHERE id=?').get(orderId);
      const dueDate = order.expected_delivery_date || order.order_date || String(order.created_at || '').slice(0, 10);
      if (!dueDate || dueDate > expectedThrough) continue;
    }
    for (const line of execution.items) {
      if (line.productId !== productId || line.remaining <= 0) continue;
      lines.push({ orderId, ...line });
    }
  }
  return lines;
}

export async function createDeliverySchedule(db, req, res, actor, orderId) {
  assertChangePermission(actor);
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  if (order.status !== 'APPROVED') throw new HttpError(409, '已审批的采购订单才能维护交货计划');
  const body = await readJson(req);
  assertAllowedFields(body, ['orderItemId', 'plannedQuantity', 'plannedDate', 'plannedDateFrom', 'plannedDateTo', 'sequenceNo', 'upperTolerancePct', 'lowerTolerancePct']);
  const orderItem = db.prepare('SELECT * FROM purchase_order_items WHERE id=? AND order_id=?').get(body.orderItemId, orderId);
  if (!orderItem) throw new HttpError(404, '订单明细不存在');
  const scheduleId = randomUUID();
  const now = new Date().toISOString();
  transaction(db, () => {
    const plannedDateFrom = body.plannedDateFrom || body.plannedDate;
    const plannedDateTo = body.plannedDateTo || body.plannedDate;
    if (plannedDateFrom > plannedDateTo) throw new HttpError(400, '交期区间开始日期不能晚于结束日期');
    db.prepare(`INSERT INTO purchase_order_delivery_schedules(id,order_id,order_item_id,planned_quantity,planned_date,received_quantity,upper_tolerance_pct,lower_tolerance_pct,created_by,created_at,updated_at,planned_date_from,planned_date_to,sequence_no)
      VALUES(?,?,?,?,?,0,?,?,?,?,?,?,?,?)`).run(scheduleId, orderId, body.orderItemId, Number(body.plannedQuantity), body.plannedDate, Number(body.upperTolerancePct || 0), Number(body.lowerTolerancePct || 0), actor.id, now, now, plannedDateFrom, plannedDateTo, body.sequenceNo === undefined ? null : Number(body.sequenceNo));
    audit(db, actor.id, 'CREATE', 'PO_DELIVERY_SCHEDULE', scheduleId, `${orderId}:${body.orderItemId}`);
  });
  return send(res, 201, { id: scheduleId });
}

// ---------------------------------------------------------------------------
// PRC-16 — lower-tolerance auto-close.
// ---------------------------------------------------------------------------

const EPSILON = 1e-9;

/**
 * The **single** lower-tolerance close judgement (PRC-16).
 *
 * This function is the one place where the "may this delivery schedule be
 * closed with a tolerated short delivery?" question is answered. The explicit
 * close endpoint and the receipt-confirm trigger both call it; there is no
 * second copy of the formula anywhere.
 *
 * The decision uses only **real** data:
 *   - the schedule's own `planned_quantity` / `lower_tolerance_pct`;
 *   - the schedule's **confirmed** received quantity, read from the
 *     authoritative CONFIRMED purchase receipt lines — never from the
 *     delivery-schedule consumption ledger (which registers capacity at
 *     *draft* creation and would let an unconfirmed receipt close a schedule)
 *     and never from a mutable legacy column;
 *   - the schedule's outstanding notice allocations (a notice that has been
 *     created but not converted still holds capacity, so the schedule is not
 *     "no longer receivable").
 *
 * The closeable condition is:
 *   received >= planned_quantity * (1 - lower_tolerance_pct / 100)
 *   AND the schedule holds no outstanding notice allocation
 *       (nothing is still committed to arrive).
 *
 * The remaining `planned_quantity − received` is exactly the **tolerated
 * short delivery** the lower tolerance allows; it is recorded, not ignored.
 * If the condition cannot be decided from the available facts, the answer is
 * "not closeable" — the function never guesses an "expected no longer to
 * arrive".
 */
export function evaluateDeliveryScheduleClose(db, deliveryScheduleId) {
  const schedule = db.prepare('SELECT * FROM purchase_order_delivery_schedules WHERE id=?').get(deliveryScheduleId);
  if (!schedule) {
    throw new HttpError(404, '交货计划不存在');
  }
  const status = String(schedule.status || 'OPEN').toUpperCase();
  const plannedQuantity = Number(schedule.planned_quantity || 0);
  const lowerTolerancePct = Number(schedule.lower_tolerance_pct || 0);
  const upperTolerancePct = Number(schedule.upper_tolerance_pct || 0);
  // 「累计已确认收货量」只统计 **CONFIRMED** 的采购入库单行。
  //
  // 交期消费台账（schedule_consumption_effects）在入库单**创建**时就登记了
  // 容量占用 —— 那是草稿预留，不是已收货。把它当作已收货会让一份草稿入库单
  // 凭空关掉交货计划，因此关单判定必须回到权威的已确认收货事实。
  const receivedQuantity = Number(db.prepare(`SELECT COALESCE(SUM(pri.quantity),0) q
    FROM purchase_receipts pr JOIN purchase_receipt_items pri ON pri.receipt_id = pr.id
    WHERE pr.status='CONFIRMED' AND pri.delivery_schedule_id=?`).get(deliveryScheduleId)?.q || 0);
  // 尚未转成入库单的完工通知分配仍然持有容量：该交货计划**仍可收货**。
  const outstandingAllocatedQuantity = Number(db.prepare(`SELECT COALESCE(SUM(s.allocated_quantity
      - CASE WHEN s.converted_quantity IS NULL THEN 0 ELSE s.converted_quantity END),0) q
    FROM receipt_notice_item_sources s
    JOIN receipt_notice_items i ON i.id = s.notice_item_id
    JOIN receipt_notices n ON n.id = i.notice_id
    WHERE s.delivery_schedule_id=? AND n.status<>'CANCELLED'`).get(deliveryScheduleId)?.q || 0);
  const remainingReceivableQuantity = Math.max(0, plannedQuantity - receivedQuantity - outstandingAllocatedQuantity);
  const toleratedShortQuantity = Math.max(0, plannedQuantity - receivedQuantity);
  const minimumAcceptableQuantity = plannedQuantity * (1 - lowerTolerancePct / 100);
  const maximumTolerableShortQuantity = plannedQuantity * (lowerTolerancePct / 100);
  const overReceivedQuantity = Math.max(0, receivedQuantity - plannedQuantity * (1 + upperTolerancePct / 100));
  const base = {
    deliveryScheduleId: schedule.id,
    orderId: schedule.order_id,
    orderItemId: schedule.order_item_id,
    status,
    plannedQuantity,
    lowerTolerancePct,
    upperTolerancePct,
    receivedQuantity,
    outstandingAllocatedQuantity,
    remainingReceivableQuantity,
    toleratedShortQuantity,
    minimumAcceptableQuantity,
    maximumTolerableShortQuantity,
    overReceivedQuantity,
  };
  if (status === 'CLOSED') {
    return { ...base, closeable: false, reason: 'ALREADY_CLOSED', toleratedShortQuantity: 0 };
  }
  if (overReceivedQuantity > EPSILON) {
    // 超收由既有的容量检查负责；这里不做关单判断。
    return { ...base, closeable: false, reason: 'OVER_RECEIVED_BEYOND_UPPER_TOLERANCE' };
  }
  if (outstandingAllocatedQuantity > EPSILON) {
    // 还有已创建但未转成入库单的完工通知分配：交货计划**仍可收货**，
    // 不得关单。
    return { ...base, closeable: false, reason: 'STILL_RECEIVABLE' };
  }
  if (receivedQuantity + EPSILON < minimumAcceptableQuantity) {
    // 短交量超过下容差：不得以「预计不再到货」臆造关单。
    return { ...base, closeable: false, reason: 'BELOW_LOWER_TOLERANCE' };
  }
  return { ...base, closeable: true, reason: 'LOWER_TOLERANCE_REACHED' };
}

/**
 * Apply the lower-tolerance close to a delivery schedule.
 *
 * The caller owns the transaction. The decision is re-evaluated inside the
 * caller's transaction so a concurrent receipt cannot slip between the
 * judgement and the write.
 */
export function closeDeliveryScheduleByLowerTolerance(db, { deliveryScheduleId, actor, triggeredBy }) {
  const evaluation = evaluateDeliveryScheduleClose(db, deliveryScheduleId);
  if (!evaluation.closeable) {
    throw new HttpError(409, `交货计划不满足下容差关单条件：${evaluation.reason}`, {
      code: 'PO_DELIVERY_SCHEDULE_NOT_CLOSEABLE',
    });
  }
  const now = new Date().toISOString();
  const closeId = randomUUID();
  const updated = db.prepare(`UPDATE purchase_order_delivery_schedules
      SET status='CLOSED', closed_at=?, closed_by=?, updated_at=? WHERE id=? AND status='OPEN'`)
    .run(now, actor.id, now, deliveryScheduleId);
  if (Number(updated.changes || updated.affectedRows) !== 1) {
    throw new HttpError(409, '交货计划状态已变化，请重新读取后再操作', { code: 'PO_DELIVERY_SCHEDULE_STATE_CHANGED' });
  }
  db.prepare(`INSERT INTO po_delivery_schedule_closes(
      id,delivery_schedule_id,order_id,order_item_id,planned_quantity,received_quantity,
      tolerated_short_quantity,lower_tolerance_pct,close_reason,triggered_by,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    closeId, deliveryScheduleId, evaluation.orderId, evaluation.orderItemId,
    evaluation.plannedQuantity, evaluation.receivedQuantity,
    evaluation.toleratedShortQuantity, evaluation.lowerTolerancePct,
    evaluation.reason, triggeredBy, actor.id, now,
  );
  audit(db, actor.id, 'CLOSE', 'PO_DELIVERY_SCHEDULE', deliveryScheduleId, JSON.stringify({
    triggeredBy, reason: evaluation.reason,
    plannedQuantity: evaluation.plannedQuantity,
    receivedQuantity: evaluation.receivedQuantity,
    toleratedShortQuantity: evaluation.toleratedShortQuantity,
  }));
  return { closeId, ...evaluation };
}

/**
 * 显式关单端点（PRC-16）。
 *
 * 与收货确认触发的判定共用 `evaluateDeliveryScheduleClose`，因此两处不会
 * 出现两份公式。不满足条件时 fail closed，返回稳定错误码。
 */
export async function closeDeliverySchedule(db, req, res, actor, orderId, scheduleId) {
  assertChangePermission(actor);
  const schedule = db.prepare('SELECT * FROM purchase_order_delivery_schedules WHERE id=? AND order_id=?').get(scheduleId, orderId);
  if (!schedule) throw new HttpError(404, '交货计划不存在');
  let result;
  try {
    transaction(db, () => {
      result = closeDeliveryScheduleByLowerTolerance(db, { deliveryScheduleId: scheduleId, actor, triggeredBy: 'EXPLICIT' });
    });
  } catch (error) {
    auditBusinessRejection(db, actor, { entityType: 'PO_DELIVERY_SCHEDULE', entityId: scheduleId, action: '下容差关单' }, error);
    throw error;
  }
  return send(res, 200, { ok: true, closed: true, close: result });
}

/**
 * 收货确认后的下容差自动关单触发器（PRC-16）。
 *
 * 收货确认的 canonical 写者在确认成功后调用本函数；判定公式仍然只有
 * `evaluateDeliveryScheduleClose` 一份。触发器是**尽力而为**的：某个交货
 * 计划不满足关单条件时，收货确认**不得**因此失败——它只是保持 OPEN。
 * 只有真正写关单事实时才会失败（并发状态变化），此时收货确认失败并回滚，
 * 绝不留下半写状态。
 */
export function triggerLowerToleranceAutoClose(db, { deliveryScheduleIds, actor }) {
  const ids = [...new Set((deliveryScheduleIds || []).filter(Boolean))];
  const closed = [];
  for (const deliveryScheduleId of ids) {
    const evaluation = evaluateDeliveryScheduleClose(db, deliveryScheduleId);
    if (!evaluation.closeable) continue;
    const result = closeDeliveryScheduleByLowerTolerance(db, { deliveryScheduleId, actor, triggeredBy: 'RECEIPT_CONFIRM' });
    closed.push(result);
  }
  return closed;
}

export function listDeliverySchedules(db, res, actor, orderId) {
  assertViewPermission(actor);
  const schedules = db.prepare('SELECT * FROM purchase_order_delivery_schedules WHERE order_id=? ORDER BY planned_date').all(orderId).map(rowToSchedule);
  return send(res, 200, { schedules });
}

export async function createPurchaseOrderChange(db, req, res, actor) {
  assertChangeManagePermission(actor);
  assertPoChangeEnabled(db);
  const body = await readJson(req);
  assertAllowedFields(body, ['orderId', 'action', 'payload', 'scope', 'idempotencyKey']);
  const request = normalizeChangeRequest(body);
  if (!['HEADER', 'LINE'].includes(request.scope)) throw new HttpError(400, '变更范围不正确');
  if (request.action === 'ADD' && request.scope !== 'LINE') throw new HttpError(400, '新增行变更只能是行级范围');
  if (request.action === 'CANCEL' && request.scope === 'LINE' && !request.target?.orderItemId) {
    throw new HttpError(400, '行级取消必须指定 orderItemId');
  }
  const idempotencyKey = String(body.idempotencyKey || '').trim() || null;
  const fingerprint = stableFingerprint(request);
  const changeId = randomUUID(); const now = new Date().toISOString();
  let replay = null;
  try {
    transaction(db, () => {
      if (idempotencyKey) {
        const existing = db.prepare('SELECT * FROM purchase_order_changes WHERE created_by=? AND idempotency_key=?').get(actor.id, idempotencyKey);
        if (existing) {
          if (existing.request_fingerprint !== fingerprint) {
            throw new HttpError(409, '幂等键已用于不同采购变更', { code: 'PO_CHANGE_IDEMPOTENCY_CONFLICT' });
          }
          replay = existing;
          return;
        }
      }
      const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.orderId);
      if (!order) throw new HttpError(404, '采购订单不存在');
      assertProcessingPurchaseOrderChangeAllowed(order);
      if (order.status !== 'APPROVED') throw new HttpError(409, '只有已批准采购订单可以创建正式变更', { code: 'PO_CHANGE_ORDER_STATE_INVALID' });
      const before = orderSnapshot(db, body.orderId);
      const payload = body.payload || {};
      const target = request.target?.orderItemId ? before.items.find((item) => item.id === request.target.orderItemId) : null;
      if (request.scope === 'LINE' && request.action !== 'ADD' && !target) throw new HttpError(404, '采购订单变更目标行不存在');
      const lineNo = Number(request.add?.lineNo ?? target?.line_no ?? (before.items.length + 1));
      db.prepare(`INSERT INTO purchase_order_changes(id,order_id,action,status,payload_json,original_json,requested_json,created_by,created_at,
        scope,order_version_before,idempotency_key,request_fingerprint,snapshot_before_json,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(changeId, body.orderId, request.action, 'DRAFT', JSON.stringify(payload), JSON.stringify(before),
        JSON.stringify(request), actor.id, now, request.scope, Number(order.version || 1), idempotencyKey, fingerprint, JSON.stringify(before), now);
      db.prepare(`INSERT INTO po_change_items(id,change_id,order_item_id,line_no,action,requested_json,snapshot_before_json)
        VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), changeId, target?.id || null, lineNo, request.action,
        JSON.stringify(request), target ? JSON.stringify(target) : null);
      audit(db, actor.id, 'CREATE', 'PO_CHANGE', changeId, `${body.orderId}:${request.action}`);
    });
  } catch (error) {
    auditBusinessRejection(db, actor, { entityType: 'PO_CHANGE', entityId: body.orderId, action: '创建采购订单变更' }, error);
    throw error;
  }
  if (replay) return send(res, 200, { id: replay.id, replay: true });
  return send(res, 201, { id: changeId });
}

export async function approvePurchaseOrderChange(db, req, res, actor, changeId) {
  assertChangeApprovePermission(actor);
  const change = db.prepare('SELECT * FROM purchase_order_changes WHERE id=?').get(changeId);
  if (!change) throw new HttpError(404, '变更单不存在');
  if (change.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以审核');
  if (change.created_by === actor.id) throw new HttpError(409, '采购订单变更申请人不能审批自己的申请', { code: 'PO_CHANGE_SELF_APPROVAL_FORBIDDEN' });
  const now = new Date().toISOString();
  transaction(db, () => {
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(change.order_id);
    if (!order) throw new HttpError(404, '采购订单不存在');
    assertProcessingPurchaseOrderChangeAllowed(order);
    if (Number(order.version || 1) !== Number(change.order_version_before || 1)) throw new HttpError(409, '采购订单版本已变化', { code: 'PO_CHANGE_STALE_VERSION' });
    db.prepare('UPDATE purchase_order_changes SET status=?, approver_id=?, approved_at=?,updated_at=? WHERE id=?').run('APPROVED', actor.id, now, now, changeId);
    audit(db, actor.id, 'APPROVE', 'PO_CHANGE', changeId, '');
  });
  return send(res, 200, { ok: true });
}

export async function applyPurchaseOrderChange(db, req, res, actor, changeId) {
  assertChangeManagePermission(actor);
  assertPoChangeEnabled(db);
  const now = new Date().toISOString();
  let after = null;
  let replay = false;
  try {
    transaction(db, () => {
      const change = db.prepare('SELECT * FROM purchase_order_changes WHERE id=?').get(changeId);
      if (!change) throw new HttpError(404, '变更单不存在');
      if (change.status === 'APPLIED') {
        after = change.snapshot_after_json ? JSON.parse(change.snapshot_after_json) : null;
        replay = true;
        return;
      }
      if (change.status !== 'APPROVED') throw new HttpError(409, '只有已审核的变更单可以应用');
      const changeItem = db.prepare('SELECT * FROM po_change_items WHERE change_id=? ORDER BY line_no LIMIT 1').get(changeId);
      if (!changeItem) throw new HttpError(409, '采购订单变更缺少变更明细', { code: 'PO_CHANGE_ITEM_MISSING' });
      const request = JSON.parse(changeItem.requested_json);
      const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(change.order_id);
      if (!order) throw new HttpError(404, '采购订单不存在');
      assertProcessingPurchaseOrderChangeAllowed(order);
      if (order.status !== 'APPROVED') throw new HttpError(409, '采购订单状态已变化', { code: 'PO_CHANGE_ORDER_STATE_INVALID' });
      if (Number(order.version || 1) !== Number(change.order_version_before || 1)) {
        throw new HttpError(409, '采购订单版本已变化', { code: 'PO_CHANGE_STALE_VERSION' });
      }
      const execution = getPurchaseOrderExecution(db, change.order_id);
      if (change.action === 'ADD') {
        const requested = request.add || {};
        const quantity = Number(requested.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '新增行数量不正确');
        const commercial = resolveChangeLinePricing(db, order, requested);
        const maxLineNo = Number(db.prepare('SELECT COALESCE(MAX(line_no),0) n FROM purchase_order_items WHERE order_id=?').get(change.order_id).n || 0);
        const lineNo = Number(requested.lineNo || maxLineNo + 1);
        if (db.prepare('SELECT 1 FROM purchase_order_items WHERE order_id=? AND line_no=?').get(change.order_id, lineNo)) {
          throw new HttpError(409, '新增行行号已存在', { code: 'PO_CHANGE_LINE_NO_CONFLICT' });
        }
        const itemId = randomUUID();
        insertPurchaseOrderItem(db, {
          id: itemId, orderId: change.order_id,
          item: {
            productId: requested.productId, quantity, documentUomCode: requested.documentUomCode,
            documentQuantityNumerator: requested.quantityNumerator ?? quantity,
            documentQuantityDenominator: requested.quantityDenominator ?? 1,
            isGiftLine: Boolean(requested.isGiftLine),
          },
          lineNo, pricing: commercial,
        });
        saveItemVersion(db, db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(itemId), changeId, actor.id, now);
      } else if (change.action === 'MODIFY') {
        const requested = request.target || {};
        if (!requested.orderItemId) throw new HttpError(400, 'MODIFY 必须提供 orderItemId');
        const target = execution.items.find((item) => item.orderItemId === requested.orderItemId);
        if (!target) throw new HttpError(404, '订单明细不存在');
        const currentItem = db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(requested.orderItemId);
        if (!currentItem) throw new HttpError(404, '订单明细不存在');
        if (!currentItem.pricing_evidence_json) {
          throw new HttpError(409, '历史采购行缺少冻结价格证据，不能直接商业变更', { code: 'PO_CHANGE_PRICE_EVIDENCE_MISSING' });
        }
        const newQty = Number(requested.quantity);
        if (!Number.isFinite(newQty) || newQty <= 0) throw new HttpError(400, '变更数量不正确');
        const committed = target.received + target.reserved;
        if (newQty < committed) {
          throw new HttpError(409, `新数量不能低于已执行或已冻结数量 ${committed}`, { code: 'PO_CHANGE_EXECUTION_FLOOR_EXCEEDED' });
        }
        const commercial = resolveChangeLinePricing(db, order, requested, currentItem);
        const updated = db.prepare(`UPDATE purchase_order_items SET quantity=?,unit_price_cents=?,amount_cents=?,
          document_uom_code=?,document_quantity_num=?,document_quantity_den=?,conversion_numerator=?,conversion_denominator=?,
          base_quantity_num=?,base_quantity_den=?,pricing_uom_code=?,pricing_quantity_num=?,pricing_quantity_den=?,
          price_entry_id=?,price_version=?,pricing_evidence_json=?,version=version+1
          WHERE id=? AND version=? AND COALESCE(execution_status,'OPEN')='OPEN'`).run(
          newQty, commercial.unitPriceCents, commercial.amountCents,
          commercial.evidence?.documentUomCode ?? currentItem.document_uom_code,
          commercial.evidence?.documentQuantity?.num ?? currentItem.document_quantity_num,
          commercial.evidence?.documentQuantity?.den ?? currentItem.document_quantity_den,
          commercial.evidence?.conversion?.num ?? currentItem.conversion_numerator,
          commercial.evidence?.conversion?.den ?? currentItem.conversion_denominator,
          commercial.evidence?.baseQuantity?.num ?? currentItem.base_quantity_num,
          commercial.evidence?.baseQuantity?.den ?? currentItem.base_quantity_den,
          commercial.pricingUomCode, commercial.pricingQuantityNum, commercial.pricingQuantityDen,
          commercial.priceEntryId, commercial.priceVersion, JSON.stringify(commercial.evidence), requested.orderItemId, target.version,
        );
        if (Number(updated.changes || updated.affectedRows) !== 1) {
          throw new HttpError(409, '采购订单行版本已变化', { code: 'PO_CHANGE_STALE_VERSION' });
        }
        saveItemVersion(db, db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(requested.orderItemId), changeId, actor.id, now);
      } else if (change.action === 'CANCEL') {
        const targets = change.scope === 'HEADER'
          ? execution.items
          : execution.items.filter((item) => item.orderItemId === request.target?.orderItemId);
        if (!targets.length) throw new HttpError(404, '取消目标不存在');
        for (const target of targets) {
          if (target.received > 0 || target.notified > 0 || target.reserved > 0 || target.scheduled > 0) {
            throw new HttpError(409, '存在已执行、通知、预留或交期事实，不能取消', { code: 'PO_CHANGE_CANCEL_EXECUTED' });
          }
          if (target.cancelled) throw new HttpError(409, '目标行已取消', { code: 'PO_CHANGE_LINE_ALREADY_CANCELLED' });
          const item = db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(target.orderItemId);
          const result = db.prepare("UPDATE purchase_order_items SET execution_status='CANCELLED',version=version+1 WHERE id=? AND version=? AND COALESCE(execution_status,'OPEN')='OPEN'")
            .run(item.id, Number(item.version || 1));
          if (Number(result.changes || result.affectedRows) !== 1) {
            throw new HttpError(409, '采购订单行版本已变化', { code: 'PO_CHANGE_STALE_VERSION' });
          }
          saveItemVersion(db, db.prepare('SELECT * FROM purchase_order_items WHERE id=?').get(item.id), changeId, actor.id, now);
        }
        if (change.scope === 'HEADER') {
          db.prepare("UPDATE purchase_orders SET status='CANCELLED',updated_at=? WHERE id=? AND status='APPROVED'").run(now, change.order_id);
        }
      }
      const total = recalculateOrderTotal(db, change.order_id);
      const orderUpdate = db.prepare('UPDATE purchase_orders SET version=version+1,updated_at=? WHERE id=? AND version=?').run(now, change.order_id, order.version);
      if (Number(orderUpdate.changes || orderUpdate.affectedRows) !== 1) {
        throw new HttpError(409, '采购订单版本已变化', { code: 'PO_CHANGE_STALE_VERSION' });
      }
      after = orderSnapshot(db, change.order_id);
      db.prepare('UPDATE po_change_items SET snapshot_after_json=? WHERE change_id=?').run(JSON.stringify(after), changeId);
      db.prepare('UPDATE purchase_order_changes SET status=?,applied_json=?,snapshot_after_json=?,applied_at=?,applied_by=?,updated_at=? WHERE id=?')
        .run('APPLIED', JSON.stringify({ totalCents: total }), JSON.stringify(after), now, actor.id, now, changeId);
      audit(db, actor.id, 'APPLY', 'PO_CHANGE', changeId, change.action);
    });
  } catch (error) {
    auditBusinessRejection(db, actor, { entityType: 'PO_CHANGE', entityId: changeId, action: '应用采购订单变更' }, error);
    throw error;
  }
  return send(res, 200, { ok: true, applied: after, replay });
}

export function listPurchaseOrderChanges(db, res, actor, orderId) {
  assertViewPermission(actor);
  const changes = db.prepare('SELECT * FROM purchase_order_changes WHERE order_id=? ORDER BY created_at DESC').all(orderId).map(rowToChange);
  const itemRows = db.prepare('SELECT * FROM po_change_items WHERE change_id=? ORDER BY line_no').all(...changes.map((change) => change.id));
  const itemsByChange = new Map();
  for (const row of itemRows) {
    if (!itemsByChange.has(row.change_id)) itemsByChange.set(row.change_id, []);
    itemsByChange.get(row.change_id).push({
      id: row.id,
      orderItemId: row.order_item_id,
      lineNo: Number(row.line_no || 0),
      action: row.action,
      requested: JSON.parse(row.requested_json),
      snapshotBefore: row.snapshot_before_json ? JSON.parse(row.snapshot_before_json) : null,
      snapshotAfter: row.snapshot_after_json ? JSON.parse(row.snapshot_after_json) : null,
    });
  }
  for (const change of changes) change.items = itemsByChange.get(change.id) || [];
  return send(res, 200, { changes });
}

/**
 * 采购订单商业快照读取端点（Design §26.6 / PRC-14）。
 *
 * 快照只读：它返回订单当时冻结的商业事实，不重算、不修复历史。
 */
export function getPurchaseOrderCommercialSnapshot(db, res, actor, orderId) {
  assertViewPermission(actor);
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  const items = db.prepare('SELECT id,line_no,product_id,quantity,unit_price_cents,amount_cents,is_gift_line,document_uom_code,document_quantity_num,document_quantity_den,base_quantity_num,base_quantity_den,pricing_uom_code,pricing_quantity_num,pricing_quantity_den,price_entry_id,price_version,pricing_discount_scheme_id,discount_source,purchase_requisition_item_id,version,execution_status FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(orderId);
  const schedules = db.prepare('SELECT id,order_item_id,planned_date,planned_date_from,planned_date_to,sequence_no,planned_quantity,upper_tolerance_pct,lower_tolerance_pct FROM purchase_order_delivery_schedules WHERE order_id=? ORDER BY planned_date,id').all(orderId);
  return send(res, 200, {
    commercialSnapshot: {
      orderId: order.id,
      orderNo: order.order_no,
      supplierId: order.supplier_id,
      settlementSupplierId: order.settlement_supplier_id || order.supplier_id,
      payeeSupplierId: order.payee_supplier_id || order.settlement_supplier_id || order.supplier_id,
      buyerId: order.buyer_id || null,
      purchasingGroupId: order.purchasing_group_id || null,
      prepaymentRequired: Boolean(order.prepayment_required),
      supplierContactSnapshot: order.supplier_contact_snapshot || null,
      supplierAddressSnapshot: order.supplier_address_snapshot || null,
      paymentTermsSnapshot: order.payment_terms_snapshot || null,
      totalCents: Number(order.total_cents || 0),
      version: Number(order.version || 1),
      items,
      deliverySchedules: schedules,
    },
  });
}

export function getPurchaseOrderExecutionView(db, res, actor, orderId) {
  assertViewPermission(actor);
  return send(res, 200, { execution: getPurchaseOrderExecution(db, orderId) });
}
