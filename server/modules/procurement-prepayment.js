// PRC-17 Prepayment Requirement — Procurement-side canonical owner.
//
// Requirement §31.3.1 PRC-17 / Active Design §26.9.
//
// Ownership boundary (this module enforces it, it does not merely describe it):
//
//   Procurement owns the Prepayment Requirement document and its schedule
//   lines. Finance owns the actual Payment / Allocation.
//
//   The only payment engine in this repository is the canonical Finance
//   settlement path (`server/modules/settlement.js`):
//       payment_disbursements + payment_disbursement_items
//   This module NEVER writes those tables directly and NEVER owns a second
//   account-payment table. Posting a requirement *hands off* to that
//   canonical path, and the handoff is recorded as a frozen
//   `finance_handoff_id` on the Procurement document.
//
//   The canonical Finance subledger row that carries the handoff identity is
//   created through `ensurePayableSource` with
//   `source_type='PREPAYMENT_REQUIREMENT'` and `source_id` = the requirement
//   id, so Finance can reconcile the payment back to the Procurement
//   document without any Procurement-owned payment column.
//
// Amounts are safe integer cents throughout. The prepayment basis is a
// rational number (numerator/denominator); the expected payment amount is
// derived from the authoritative purchase order total with BigInt rational
// arithmetic and HALF_UP rounding — a client supplied amount is never
// accepted as an authoritative value.

import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit, auditBusinessRejection } from '../lib/audit.js';
import {
  HttpError, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import { roundRational } from './commercial-golive.js';
import { ensurePayableSource } from './settlement-core.js';
import { confirmSettlementDocument, createSettlementDocument } from './settlement.js';

const ENTITY = 'PREPAYMENT_REQUIREMENT';

// Procurement-side view: any principal that may read purchase orders may read
// prepayment requirements (they are a purchase-order commercial fact).
const VIEW_PERMISSIONS = ['PURCHASE_ORDERS_VIEW'];
// Procurement-side create authority: the requirement applicant.
const CREATE_PERMISSIONS = ['PURCHASE_ORDERS_CREATE'];
// Finance-side posting authority: posting produces a REAL payment through the
// canonical Finance settlement path, therefore the actor must hold the
// Finance payment-management capability. This is what makes the
// applicant/poster separation enforceable with the currently seeded roles.
const POST_PERMISSIONS = ['PAYMENT_MANAGE'];

const STANDARD_PURCHASE = 'STANDARD_PURCHASE';
const STATUS_DRAFT = 'DRAFT';
const STATUS_POSTED = 'POSTED';
const STATUS_CANCELLED = 'CANCELLED';

const stamp = () => new Date().toISOString();

function atomic(db, work) { return db.isTransaction ? work() : transaction(db, work); }

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }
function assertCreatePermission(actor) { allowAny(actor, CREATE_PERMISSIONS); }
function assertPostPermission(actor) { allowAny(actor, POST_PERMISSIONS); }

function positiveInt(value, label, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new HttpError(400, `${label}必须为大于 0 的安全整数`, { code });
  }
  return number;
}

function businessDate(value, label, code) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new HttpError(400, `${label}格式不正确`, { code });
  }
  return text;
}

/**
 * The prepayment basis is a rational number strictly inside (0, 1].
 * `30/100` expresses "30% of the purchase order amount".
 */
function prepaymentBasis(body) {
  const numerator = positiveInt(body.prepaymentPctBasisNumerator, '预付比例分子', 'PREPAYMENT_RATIO_INVALID');
  const denominator = positiveInt(body.prepaymentPctBasisDenominator, '预付比例分母', 'PREPAYMENT_RATIO_INVALID');
  if (numerator > denominator) {
    throw new HttpError(400, '预付比例分子不得大于分母', { code: 'PREPAYMENT_RATIO_INVALID' });
  }
  return { numerator, denominator };
}

/**
 * The expected payment amount is DERIVED from the authoritative purchase
 * order total. The client may assert an amount, but the assertion is only
 * ever checked against the derived value — it never becomes the authority.
 */
function deriveExpectedPaymentCents(orderTotalCents, basis) {
  const derived = roundRational(
    BigInt(orderTotalCents) * BigInt(basis.numerator),
    BigInt(basis.denominator),
  );
  if (!Number.isSafeInteger(derived) || derived <= 0) {
    throw new HttpError(400, '按预付比例计算的预付金额必须大于 0', { code: 'PREPAYMENT_AMOUNT_NOT_POSITIVE' });
  }
  return derived;
}

/**
 * Only an APPROVED ordinary purchase order may carry a prepayment
 * requirement. An outsourcing processing-fee order has its own commercial
 * owner and is out of scope for PRC-17.
 */
function loadEligiblePurchaseOrder(db, poId) {
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(poId);
  if (!order) throw new HttpError(404, '采购订单不存在', { code: 'PREPAYMENT_PO_NOT_FOUND' });
  if (order.status !== 'APPROVED') {
    throw new HttpError(409, '只有已批准的采购订单可以建立预付款要求', { code: 'PREPAYMENT_PO_NOT_APPROVED' });
  }
  const businessType = order.business_type || STANDARD_PURCHASE;
  if (businessType !== STANDARD_PURCHASE) {
    throw new HttpError(409, '只有普通采购订单可以建立预付款要求', { code: 'PREPAYMENT_PO_BUSINESS_TYPE_INVALID' });
  }
  return order;
}

/**
 * The requirement schedule lines are derived from the authoritative purchase
 * order lines. A client may narrow the schedule (declare which PO lines this
 * requirement covers) but may never invent a line, a price or an amount.
 *
 * Quantities are carried as an exact rational (num/1000) so that a fractional
 * purchase order quantity keeps its exact value instead of drifting through a
 * binary float.
 *
 * Each line carries its OWN share of the prepayment (line amount × basis).
 * The document total is the prepayment obligation against the whole purchase
 * order (order total × basis). Because the two are rounded independently the
 * per-line shares may drift from the document total by a few cents; the
 * residual is absorbed by the last schedule line so that the schedule always
 * reconciles exactly to the document total.
 *
 * The schedule therefore always covers the whole purchase order. A narrowed
 * schedule would make the document total and the schedule disagree, which is
 * exactly the ambiguity this document must not carry.
 */
function resolveScheduleLines(db, order, basis) {
  const orderLines = db.prepare(`SELECT id,line_no,product_id,quantity,unit_price_cents,amount_cents
    FROM purchase_order_items WHERE order_id=? ORDER BY line_no`).all(order.id);
  if (!orderLines.length) {
    throw new HttpError(409, '采购订单没有明细，无法建立预付款要求', { code: 'PREPAYMENT_PO_HAS_NO_LINES' });
  }
  const lines = orderLines.map((line) => {
    const lineNo = Number(line.line_no);
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpError(409, `第 ${lineNo} 行数量无效`, { code: 'PREPAYMENT_LINE_QUANTITY_INVALID' });
    }
    const unitPriceCents = Number(line.unit_price_cents);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new HttpError(409, `第 ${lineNo} 行单价不是有效的整数分`, { code: 'PREPAYMENT_LINE_PRICE_INVALID' });
    }
    const quantityNum = Math.round(quantity * 1000);
    const lineAmountCents = roundRational(BigInt(quantityNum) * BigInt(unitPriceCents), BigInt(1000));
    if (!Number.isSafeInteger(lineAmountCents) || lineAmountCents <= 0) {
      throw new HttpError(409, `第 ${lineNo} 行金额必须大于 0`, { code: 'PREPAYMENT_LINE_AMOUNT_NOT_POSITIVE' });
    }
    const shareCents = roundRational(BigInt(lineAmountCents) * BigInt(basis.numerator), BigInt(basis.denominator));
    if (!Number.isSafeInteger(shareCents) || shareCents <= 0) {
      throw new HttpError(409, `第 ${lineNo} 行预付金额必须大于 0`, { code: 'PREPAYMENT_LINE_AMOUNT_NOT_POSITIVE' });
    }
    return {
      orderItemId: line.id,
      lineNo,
      productId: line.product_id,
      quantityNum,
      quantityDen: 1000,
      unitPriceCents,
      lineAmountCents,
      expectedPaymentCents: shareCents,
    };
  });
  return lines;
}

/**
 * Absorb the independent per-line rounding residual into the last schedule
 * line so that the schedule reconciles exactly to the document total.
 */
function reconcileScheduleToTotal(lines, documentTotalCents) {
  const allocated = lines.reduce((sum, line) => sum + line.expectedPaymentCents, 0);
  const residual = documentTotalCents - allocated;
  const last = lines[lines.length - 1];
  last.expectedPaymentCents += residual;
  if (!Number.isSafeInteger(last.expectedPaymentCents) || last.expectedPaymentCents <= 0) {
    throw new HttpError(409, '预付明细无法与预付总额核对一致', { code: 'PREPAYMENT_LINES_NOT_RECONCILABLE' });
  }
  return lines;
}

function rowToRequirement(row) {
  if (!row) return null;
  return {
    id: row.id,
    requirementNo: row.requirement_no,
    poId: row.po_id,
    supplierId: row.supplier_id,
    sequenceNo: Number(row.sequence_no),
    prepaymentPctBasisNumerator: Number(row.prepayment_pct_basis_numerator),
    prepaymentPctBasisDenominator: Number(row.prepayment_pct_basis_denominator),
    dueDate: row.due_date,
    expectedPaymentCents: Number(row.expected_payment_cents),
    status: row.status,
    financeHandoffId: row.finance_handoff_id,
    financePaymentId: row.finance_payment_id,
    sourceType: row.source_type,
    createdBy: row.created_by,
    createdAt: row.created_at,
    postedBy: row.posted_by,
    postedAt: row.posted_at,
    cancelledBy: row.cancelled_by,
    cancelledAt: row.cancelled_at,
  };
}

function requirementItems(db, requirementId) {
  return db.prepare(`SELECT i.*, p.code productCode, p.name productName
    FROM prepayment_requirement_items i JOIN products p ON p.id=i.product_id
    WHERE i.requirement_id=? ORDER BY i.line_no`).all(requirementId)
    .map((row) => ({
      id: row.id,
      lineNo: Number(row.line_no),
      orderItemId: row.order_item_id,
      productId: row.product_id,
      productCode: row.productCode,
      productName: row.productName,
      quantityNumerator: Number(row.quantity_num),
      quantityDenominator: Number(row.quantity_den),
      unitPriceCents: Number(row.unit_price_cents),
      expectedPaymentCents: Number(row.expected_payment_cents),
      dueDate: row.due_date,
    }));
}

function loadRequirement(db, requirementId) {
  const row = db.prepare('SELECT * FROM prepayment_requirements WHERE id=?').get(requirementId);
  if (!row) throw new HttpError(404, '预付款要求不存在', { code: 'PREPAYMENT_REQUIREMENT_NOT_FOUND' });
  return row;
}

/**
 * Minimal synthetic request/response adapters so that the canonical Finance
 * settlement path can be invoked programmatically from Procurement without
 * duplicating any of its write logic. The canonical path remains the ONLY
 * writer of `payment_disbursements` / `payment_disbursement_items`.
 */
function syntheticRequest(body, headers = {}) {
  return {
    headers: { 'content-type': 'application/json', ...headers },
    [Symbol.asyncIterator]: async function* iterator() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
}

function syntheticResponse() {
  const response = {
    statusCode: 0,
    body: null,
    setHeader() {},
    getHeader() { return null; },
    write() {},
    on() {},
    once() {},
  };
  response.end = (chunk) => { if (chunk) response.body = JSON.parse(chunk); };
  return response;
}

function nextSequenceNo(db, poId) {
  const row = db.prepare('SELECT COALESCE(MAX(sequence_no),0)+1 n FROM prepayment_requirements WHERE po_id=?').get(poId);
  return Number(row.n);
}

/**
 * The Finance voucher generator. `server/app.js` owns the canonical voucher
 * writer (`generateVoucher`) and passes it into the Finance settlement
 * handlers. Prepayment reuses that canonical writer — it never creates a
 * second voucher path. The generator is injected by the dispatcher when the
 * application is created (see `setPrepaymentVoucherGenerator`).
 *
 * When the generator is missing the handoff fails closed: the payment is not
 * created without the canonical Finance voucher, because a payment without a
 * voucher would be an unaudited money movement.
 */
let generateFinanceVoucher = null;

export function setPrepaymentVoucherGenerator(generator) {
  if (typeof generator !== 'function') {
    throw new HttpError(500, '财务凭证生成器未注册');
  }
  generateFinanceVoucher = generator;
}

function requireVoucherGenerator() {
  if (!generateFinanceVoucher) {
    throw new HttpError(409, '财务付款路径不可用，预付过账被拒绝', { code: 'PREPAYMENT_FINANCE_HANDOFF_UNAVAILABLE' });
  }
  return generateFinanceVoucher;
}

/**
 * Find the canonical Finance payment that already carries this requirement's
 * handoff, if any.
 *
 * The handoff link is the canonical Finance settlement document's
 * `external_reference`, which the canonical writer stores verbatim. Looking
 * it up makes the handoff idempotent: a retry after a partial failure reuses
 * the existing payment instead of creating a second one.
 */
function findExistingHandoffPayment(db, requirementId) {
  return db.prepare(`SELECT id,disbursement_no,amount_cents,status FROM payment_disbursements
    WHERE external_reference=? ORDER BY created_at LIMIT 1`).get(requirementId);
}

/**
 * Build the canonical Finance payment document for a posted requirement.
 *
 * The Finance path is entered through `createSettlementDocument` +
 * `confirmSettlementDocument`; the resulting `payment_disbursements.id` is
 * the frozen `finance_handoff_id` on the Procurement document. The canonical
 * Finance subledger row (`account_payables`) is created by
 * `ensurePayableSource` with `source_type='PREPAYMENT_REQUIREMENT'` so the
 * payment remains reconcilable from the Finance side.
 */
async function createFinanceHandoff(db, actor, requirement, { paymentMethod, settlementAccountId, dueDate }) {
  const voucherGenerator = requireVoucherGenerator();
  // The canonical Finance subledger identity for this requirement. This is
  // what `source_type='PREPAYMENT_REQUIREMENT'` means in the Design: the
  // Finance open item points back at the Procurement requirement.
  ensurePayableSource(db, {
    id: requirement.id,
    sourceType: 'PREPAYMENT_REQUIREMENT',
    sourceNo: requirement.requirement_no,
    partyId: requirement.supplier_id,
    businessDate: dueDate,
    effectCents: Number(requirement.expected_payment_cents),
    creatorId: requirement.created_by,
    createdAt: requirement.created_at,
  });

  const createBody = {
    supplierId: requirement.supplier_id,
    amountCents: Number(requirement.expected_payment_cents),
    paymentMethod,
    settlementAccountId,
    businessDate: dueDate,
    remark: `预付款要求 ${requirement.requirement_no}`,
    externalReference: requirement.id,
    // The prepayment money is NOT applied against any existing payable: it
    // is an explicit prepayment. The canonical Finance path therefore
    // records it as an explicitly retained unapplied prepayment balance.
    unappliedAmountCents: Number(requirement.expected_payment_cents),
    explicitUnapplied: true,
    allocations: [],
  };
  const createRes = syntheticResponse();
  await createSettlementDocument(db, syntheticRequest(createBody), createRes, actor, 'PAYMENT');
  const created = createRes.body;
  if (!created || !created.id) {
    throw new HttpError(409, '财务付款单创建失败，预付过账已回滚', { code: 'PREPAYMENT_FINANCE_HANDOFF_FAILED' });
  }

  const confirmRes = syntheticResponse();
  await confirmSettlementDocument(
    db,
    syntheticRequest({ idempotencyKey: `prepayment-handoff:${requirement.id}` }),
    confirmRes,
    actor,
    'PAYMENT',
    created.id,
    voucherGenerator,
  );
  if (confirmRes.statusCode !== 200) {
    throw new HttpError(409, '财务付款单确认失败，预付过账已回滚', { code: 'PREPAYMENT_FINANCE_HANDOFF_FAILED' });
  }
  return { financeHandoffId: created.id, financePaymentId: created.id, paymentNo: created.paymentNo };
}

/**
 * Create a Procurement prepayment requirement.
 *
 * The requirement starts as DRAFT. The expected payment amount is derived
 * from the authoritative purchase order total and the declared rational
 * basis; a client supplied amount is at most an assertion and must agree
 * with the derived value.
 */
export async function createProcurementPrepaymentRequirement(db, req, res, actor) {
  assertCreatePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, [
    'poId', 'prepaymentPctBasisNumerator', 'prepaymentPctBasisDenominator',
    'dueDate', 'expectedPaymentCents',
  ]);

  const poId = String(body.poId || '').trim();
  if (!poId) throw new HttpError(400, '必须指定采购订单', { code: 'PREPAYMENT_PO_REQUIRED' });
  const basis = prepaymentBasis(body);
  const dueDate = businessDate(body.dueDate, '预付到期日', 'PREPAYMENT_DUE_DATE_INVALID');
  const order = loadEligiblePurchaseOrder(db, poId);

  const orderTotalCents = Number(order.total_cents);
  if (!Number.isSafeInteger(orderTotalCents) || orderTotalCents <= 0) {
    throw new HttpError(409, '采购订单金额不是有效的整数分，无法计算预付金额', { code: 'PREPAYMENT_PO_AMOUNT_INVALID' });
  }
  const expectedPaymentCents = deriveExpectedPaymentCents(orderTotalCents, basis);

  // A client may assert the amount it expects, but the assertion never
  // becomes the authority: it must agree with the derived value.
  if (body.expectedPaymentCents !== undefined && body.expectedPaymentCents !== null) {
    const asserted = Number(body.expectedPaymentCents);
    if (!Number.isSafeInteger(asserted) || asserted !== expectedPaymentCents) {
      throw new HttpError(400, '预付金额与按比例计算的金额不一致，金额由采购订单与预付比例决定', { code: 'PREPAYMENT_AMOUNT_MISMATCH' });
    }
  }

  const lines = reconcileScheduleToTotal(resolveScheduleLines(db, order, basis), expectedPaymentCents);

  const requirementId = randomUUID();
  const requirementNo = `PPR-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
  const now = stamp();

  try {
    atomic(db, () => {
      // Re-read the authoritative purchase order inside the transaction.
      const locked = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(poId);
      if (!locked) throw new HttpError(404, '采购订单不存在', { code: 'PREPAYMENT_PO_NOT_FOUND' });
      if (locked.status !== 'APPROVED') {
        throw new HttpError(409, '只有已批准的采购订单可以建立预付款要求', { code: 'PREPAYMENT_PO_NOT_APPROVED' });
      }
      if ((locked.business_type || STANDARD_PURCHASE) !== STANDARD_PURCHASE) {
        throw new HttpError(409, '只有普通采购订单可以建立预付款要求', { code: 'PREPAYMENT_PO_BUSINESS_TYPE_INVALID' });
      }
      const lockedTotal = Number(locked.total_cents);
      if (lockedTotal !== orderTotalCents) {
        throw new HttpError(409, '采购订单金额已变化，请重新提交', { code: 'PREPAYMENT_PO_AMOUNT_CHANGED' });
      }
      const sequenceNo = nextSequenceNo(db, poId);
      db.prepare(`INSERT INTO prepayment_requirements(
          id,po_id,supplier_id,sequence_no,requirement_no,prepayment_pct_basis_numerator,prepayment_pct_basis_denominator,
          due_date,expected_payment_cents,status,source_type,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'PREPAYMENT_REQUIREMENT',?,?,?)`)
        .run(requirementId, poId, order.supplier_id, sequenceNo, requirementNo, basis.numerator, basis.denominator,
          dueDate, expectedPaymentCents, STATUS_DRAFT, actor.id, now, now);
      const insert = db.prepare(`INSERT INTO prepayment_requirement_items(
          id,requirement_id,line_no,order_item_id,product_id,quantity_num,quantity_den,unit_price_cents,expected_payment_cents,due_date)
        VALUES(?,?,?,?,?,?,?,?,?,?)`);
      for (const line of lines) {
        insert.run(randomUUID(), requirementId, line.lineNo, line.orderItemId, line.productId,
          line.quantityNum, line.quantityDen, line.unitPriceCents, line.expectedPaymentCents, dueDate);
      }
      audit(db, actor.id, 'CREATE', ENTITY, requirementId,
        `创建预付款要求 ${requirementNo} 预付比例 ${basis.numerator}/${basis.denominator} 金额 ${expectedPaymentCents}`);
    });
  } catch (error) {
    auditBusinessRejection(db, actor, { entityType: ENTITY, entityId: poId, action: '创建预付款要求' }, error);
    throw error;
  }

  const created = loadRequirement(db, requirementId);
  return send(res, 201, {
    prepaymentRequirement: {
      ...rowToRequirement(created),
      items: requirementItems(db, requirementId),
    },
  });
}

export function listProcurementPrepaymentRequirements(db, res, actor, url) {
  assertViewPermission(actor);
  const poId = url.searchParams.get('poId');
  const status = url.searchParams.get('status');
  const where = [];
  const params = [];
  if (poId) { where.push('po_id=?'); params.push(poId); }
  if (status) { where.push('status=?'); params.push(status); }
  const rows = db.prepare(`SELECT * FROM prepayment_requirements ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT 200`).all(...params);
  return send(res, 200, {
    prepaymentRequirements: rows.map((row) => ({
      ...rowToRequirement(row),
      items: requirementItems(db, row.id),
    })),
  });
}

export function getProcurementPrepaymentRequirement(db, res, actor, requirementId) {
  assertViewPermission(actor);
  const row = loadRequirement(db, requirementId);
  return send(res, 200, {
    prepaymentRequirement: { ...rowToRequirement(row), items: requirementItems(db, requirementId) },
  });
}

/**
 * Post a prepayment requirement.
 *
 * Posting is the Procurement → Finance handoff: the Procurement document
 * becomes immutable, a frozen `finance_handoff_id` is written, and the
 * actual payment is produced by the canonical Finance settlement path.
 *
 * The actor must be different from the applicant: the requirement may not be
 * posted by the person who raised it.
 */
export async function postProcurementPrepaymentRequirement(db, req, res, actor, requirementId) {
  assertPostPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['settlementAccountId', 'paymentMethod', 'dueDate']);

  const requirement = loadRequirement(db, requirementId);
  if (requirement.status !== STATUS_DRAFT) {
    throw new HttpError(409, '只有草稿状态的预付款要求可以过账', { code: 'PREPAYMENT_STATUS_INVALID' });
  }
  if (requirement.created_by === actor.id) {
    throw new HttpError(409, '预付款要求申请人不能过账自己的申请', { code: 'PREPAYMENT_SELF_POST_FORBIDDEN' });
  }

  const paymentMethod = String(body.paymentMethod || 'BANK').toUpperCase();
  if (!['CASH', 'BANK'].includes(paymentMethod)) {
    throw new HttpError(400, '收付方式仅支持现金或银行', { code: 'PREPAYMENT_PAYMENT_METHOD_INVALID' });
  }
  const settlementAccountId = String(body.settlementAccountId || '').trim();
  if (!settlementAccountId) {
    throw new HttpError(400, '请选择结算账户', { code: 'PREPAYMENT_SETTLEMENT_ACCOUNT_REQUIRED' });
  }
  const dueDate = businessDate(body.dueDate || requirement.due_date, '预付到期日', 'PREPAYMENT_DUE_DATE_INVALID');

  // The supplier is the payee of the prepayment. It is read from the
  // authoritative purchase order, never from the request body.
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(requirement.po_id);
  if (!order) throw new HttpError(404, '采购订单不存在', { code: 'PREPAYMENT_PO_NOT_FOUND' });
  if (order.status !== 'APPROVED') {
    throw new HttpError(409, '采购订单已不是已批准状态，预付过账被拒绝', { code: 'PREPAYMENT_PO_NOT_APPROVED' });
  }
  if ((order.business_type || STANDARD_PURCHASE) !== STANDARD_PURCHASE) {
    throw new HttpError(409, '只有普通采购订单可以建立预付款要求', { code: 'PREPAYMENT_PO_BUSINESS_TYPE_INVALID' });
  }

  // Idempotent handoff: if a previous attempt already produced the canonical
  // Finance payment for this requirement, it is reused instead of paying
  // twice.
  const existingPayment = findExistingHandoffPayment(db, requirementId);

  let handoff = existingPayment
    ? { financeHandoffId: existingPayment.id, financePaymentId: existingPayment.id, paymentNo: existingPayment.disbursement_no }
    : null;

  try {
    if (!handoff) {
      handoff = await createFinanceHandoff(db, actor, {
        ...requirement,
        supplier_id: order.supplier_id,
      }, { paymentMethod, settlementAccountId, dueDate });
    }
    atomic(db, () => {
      // Re-read the requirement inside the transaction: a second post must
      // observe the already posted state and fail closed.
      const locked = db.prepare('SELECT * FROM prepayment_requirements WHERE id=?').get(requirementId);
      if (!locked) throw new HttpError(404, '预付款要求不存在', { code: 'PREPAYMENT_REQUIREMENT_NOT_FOUND' });
      if (locked.status !== STATUS_DRAFT) {
        throw new HttpError(409, '只有草稿状态的预付款要求可以过账', { code: 'PREPAYMENT_STATUS_INVALID' });
      }
      if (locked.created_by === actor.id) {
        throw new HttpError(409, '预付款要求申请人不能过账自己的申请', { code: 'PREPAYMENT_SELF_POST_FORBIDDEN' });
      }
      const now = stamp();
      db.prepare(`UPDATE prepayment_requirements SET status=?,finance_handoff_id=?,finance_payment_id=?,posted_by=?,posted_at=?,updated_at=? WHERE id=? AND status=?`)
        .run(STATUS_POSTED, handoff.financeHandoffId, handoff.financePaymentId, actor.id, now, now, requirementId, STATUS_DRAFT);
      audit(db, actor.id, 'POST', ENTITY, requirementId,
        `过账预付款要求 ${locked.requirement_no} 财务交接 ${handoff.financeHandoffId}`);
    });
  } catch (error) {
    auditBusinessRejection(db, actor, { entityType: ENTITY, entityId: requirementId, action: '过账预付款要求' }, error);
    throw error;
  }

  const posted = loadRequirement(db, requirementId);
  return send(res, 200, {
    prepaymentRequirement: {
      ...rowToRequirement(posted),
      items: requirementItems(db, requirementId),
    },
    financeHandoff: handoff,
  });
}

/**
 * Cancel a prepayment requirement. Only a DRAFT requirement may be
 * cancelled; a POSTED requirement carries a real Finance payment and is
 * therefore never cancellable through the Procurement document.
 */
export function cancelProcurementPrepaymentRequirement(db, res, actor, requirementId) {
  assertPostPermission(actor);
  const requirement = loadRequirement(db, requirementId);
  if (requirement.status !== STATUS_DRAFT) {
    throw new HttpError(409, '只有草稿状态的预付款要求可以取消', { code: 'PREPAYMENT_STATUS_INVALID' });
  }
  const now = stamp();
  atomic(db, () => {
    const locked = db.prepare('SELECT * FROM prepayment_requirements WHERE id=?').get(requirementId);
    if (!locked) throw new HttpError(404, '预付款要求不存在', { code: 'PREPAYMENT_REQUIREMENT_NOT_FOUND' });
    if (locked.status !== STATUS_DRAFT) {
      throw new HttpError(409, '只有草稿状态的预付款要求可以取消', { code: 'PREPAYMENT_STATUS_INVALID' });
    }
    db.prepare('UPDATE prepayment_requirements SET status=?,cancelled_by=?,cancelled_at=?,updated_at=? WHERE id=? AND status=?')
      .run(STATUS_CANCELLED, actor.id, now, now, requirementId, STATUS_DRAFT);
    audit(db, actor.id, 'CANCEL', ENTITY, requirementId, `取消预付款要求 ${locked.requirement_no}`);
  });
  const cancelled = loadRequirement(db, requirementId);
  return send(res, 200, { prepaymentRequirement: rowToRequirement(cancelled) });
}
