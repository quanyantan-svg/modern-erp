import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';
import { ensurePayableSource, ensureReceivableSource } from './settlement-core.js';
import { assertFinanceBusinessDateOpen } from './finance-business-close.js';
import { createProvisionalAR } from './finance-ar-open-item.js';
import { createProvisionalAP } from './finance-ap-open-item.js';
import { convertProvisionalToFinancial } from './finance-provisional-conversion.js';
import { RECOGNITION_MODES, resolveRecognitionPolicy } from './finance-recognition-policy.js';

const TABLES = {
  AR: { table: 'account_receivables', partyColumn: 'customer_id', ensure: ensureReceivableSource, provisional: createProvisionalAR },
  AP: { table: 'account_payables', partyColumn: 'supplier_id', ensure: ensurePayableSource, provisional: createProvisionalAP },
};

const atomic = (db, work) => db.isTransaction ? work() : transaction(db, work);

function validateInput(input) {
  if (!TABLES[input.side]) throw new HttpError(400, 'side 必须为 AR/AP');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new HttpError(400, 'amountCents 必须为正整数分');
  if (!input.source?.sourceType || !input.source?.sourceId || !input.source?.sourceNo) throw new HttpError(400, 'recognition source 不完整');
  if (!input.partyId || !input.businessDate || !input.actorId) throw new HttpError(400, 'recognition 上下文不完整');
}

function sourcePolicy(db, side, source, businessDate) {
  return resolveRecognitionPolicy(db, side, source.sourceType, source.sourceId, businessDate).mode;
}

export function resolveRecognitionModeForSources(db, side, sources, businessDate) {
  const modes = [...new Set(sources.map((source) => sourcePolicy(db, side, source, businessDate)))];
  if (modes.length !== 1) throw new HttpError(409, '同一发票/账单的来源确认模式不一致');
  return modes[0];
}

function setExposureIdentity(db, side, openItemId, recognitionMode, itemKind, provisionalOriginId = null) {
  const { table } = TABLES[side];
  db.prepare(`UPDATE ${table} SET recognition_mode=?,item_kind=?,conversion_state='OPEN',provisional_origin_id=?,item_class='SOURCE',updated_at=? WHERE id=?`)
    .run(recognitionMode, itemKind, provisionalOriginId, new Date().toISOString(), openItemId);
}

function assertExistingExposure(row, input, itemKind) {
  if (!row) return;
  const partyColumn = TABLES[input.side].partyColumn;
  if (row[partyColumn] !== input.partyId || Number(row.amount_cents) !== input.amountCents || row.item_kind !== itemKind) {
    throw new HttpError(409, '同一来源已存在不同的财务暴露');
  }
}

function createFinalExposure(db, input, recognitionMode, provisionalOriginId = null) {
  const spec = TABLES[input.side];
  const existing = db.prepare(`SELECT * FROM ${spec.table} WHERE source_type=? AND source_id=?`).get(input.source.sourceType, input.source.sourceId);
  if (existing) {
    assertExistingExposure(existing, input, 'FINAL');
    return existing.id;
  }
  const openItemId = spec.ensure(db, {
    id: input.source.sourceId,
    sourceType: input.source.sourceType,
    sourceNo: input.source.sourceNo,
    partyId: input.partyId,
    businessDate: input.businessDate,
    paymentTermsDays: input.paymentTermsDays,
    effectCents: input.amountCents,
    creatorId: input.actorId,
    createdAt: input.createdAt,
  });
  setExposureIdentity(db, input.side, openItemId, recognitionMode, 'FINAL', provisionalOriginId);
  return openItemId;
}

function createProvisionalExposure(db, input) {
  const spec = TABLES[input.side];
  const existing = db.prepare(`SELECT * FROM ${spec.table} WHERE source_type=? AND source_id=?`).get(input.source.sourceType, input.source.sourceId);
  if (existing) {
    assertExistingExposure(existing, input, 'PROVISIONAL');
    return existing.id;
  }
  return spec.provisional(db, {
    sourceType: input.source.sourceType,
    sourceId: input.source.sourceId,
    sourceNo: input.source.sourceNo,
  }, input.amountCents, input.businessDate, input.partyId, { id: input.actorId });
}

// ---------------------------------------------------------------------------
// solution.md §35.22.3 — A3 composable invoice source lock plan.
//
// §35.18.11.5 fixes the order SO Line -> Fulfillment -> FINAL AR -> Invoice/Link. The plan is
// used ONLY to decide what to lock; capacity is always recomputed by the existing joins inside
// the locked transaction, so an unlocked capacity SUM can never justify an over-allocation.
// ---------------------------------------------------------------------------

const planLock = (db) => (db.dialect === 'mysql' ? ' FOR UPDATE' : '');
const placeholders = (values) => (values.length ? values.map(() => '?').join(',') : `''`);

function invoicePlanSnapshot(row) {
  return row && {
    id: row.id,
    status: row.status,
    customerId: row.customer_id,
    grossCents: Number(row.gross_cents),
    creditedAmountCents: Number(row.credited_amount_cents || 0),
    remainingCreditableAmountCents: Number(row.remaining_creditable_amount_cents || 0),
    creditState: row.credit_state || 'NONE',
  };
}

function linkPlanSnapshot(row) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    invoiceSide: row.invoice_side,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceLineId: row.source_line_id,
    invoicedQuantity: Number(row.invoiced_quantity),
    invoicedAmountCents: Number(row.invoiced_amount_cents),
  };
}

export function discoverInvoiceSourcePlan(db, invoiceId) {
  const invoice = db.prepare(`SELECT id,status,customer_id,gross_cents,credited_amount_cents,
      remaining_creditable_amount_cents,credit_state FROM sales_invoices WHERE id=?`).get(invoiceId);
  if (!invoice) return { invoiceId, salesOrderItemIds: [], fulfillmentIds: [], finalArIds: [] };
  const orderItemIds = db.prepare(`SELECT DISTINCT d.sales_order_item_id id FROM sales_invoice_items i
    JOIN sales_delivery_items d ON d.id=i.delivery_item_id
    JOIN product_commercial_classification c ON c.product_id=i.product_id
    WHERE i.invoice_id=? AND d.sales_order_item_id IS NOT NULL AND c.service_classification=1 AND c.active=1
    ORDER BY id`).all(invoiceId).map((row) => row.id);
  const fulfillmentIds = orderItemIds.length
    ? db.prepare(`SELECT DISTINCT f.id id FROM service_fulfillments f
        WHERE f.sales_order_item_id IN (${placeholders(orderItemIds)}) AND f.confirmation_state='CONFIRMED'
        ORDER BY id`).all(...orderItemIds).map((row) => row.id)
    : [];
  const finalArIds = fulfillmentIds.length
    ? db.prepare(`SELECT DISTINCT a.id id FROM account_receivables a
        WHERE a.source_type='SERVICE_FULFILLMENT' AND a.source_id IN (${placeholders(fulfillmentIds)}) AND a.item_kind='FINAL'
        ORDER BY id`).all(...fulfillmentIds).map((row) => row.id)
    : [];
  const existingLinks = db.prepare(`SELECT id,invoice_id,invoice_side,source_type,source_id,source_line_id,
      invoiced_quantity,invoiced_amount_cents FROM finance_invoice_source_links
      WHERE invoice_id=? AND invoice_side='SALES_INVOICE' ORDER BY id`).all(invoiceId).map(linkPlanSnapshot);
  const applicable = orderItemIds.length > 0 || existingLinks.some((row) => row.sourceType === 'SERVICE_FULFILLMENT');
  if (!applicable) return { invoiceId, salesOrderItemIds: [], fulfillmentIds: [], finalArIds: [] };
  return {
    invoiceId,
    salesOrderItemIds: orderItemIds,
    fulfillmentIds,
    finalArIds,
    invoiceSnapshot: invoicePlanSnapshot(invoice),
    existingLinks,
  };
}

// Must be the first row lock the caller-owned transaction takes.
export function lockInvoiceSourcePlan(db, plan) {
  if (!plan?.invoiceSnapshot) return;
  const lock = planLock(db);
  if (plan.salesOrderItemIds.length) {
    db.prepare(`SELECT id FROM sales_order_items WHERE id IN (${placeholders(plan.salesOrderItemIds)}) ORDER BY id${lock}`).all(...plan.salesOrderItemIds);
  }
  if (plan.fulfillmentIds.length) {
    db.prepare(`SELECT id FROM service_fulfillments WHERE id IN (${placeholders(plan.fulfillmentIds)}) ORDER BY id${lock}`).all(...plan.fulfillmentIds);
  }
  if (plan.finalArIds.length) {
    db.prepare(`SELECT id FROM account_receivables WHERE id IN (${placeholders(plan.finalArIds)}) ORDER BY id${lock}`).all(...plan.finalArIds);
  }
  // The invoice is the authority for both lifecycle and the absence of not-yet-created
  // links. Existing links are then locked in stable id order. We never rely on an empty
  // link query to create a gap lock: every A3 writer first owns this invoice row, while
  // the link tuple UNIQUE remains the final insert-time collision guard.
  db.prepare(`SELECT id FROM sales_invoices WHERE id=?${lock}`).get(plan.invoiceId);
  const linkIds = plan.existingLinks.map((row) => row.id);
  if (linkIds.length) {
    db.prepare(`SELECT id FROM finance_invoice_source_links WHERE id IN (${placeholders(linkIds)}) ORDER BY id${lock}`).all(...linkIds);
  }

  // Authoritative re-read beneath all five lock stages. Any candidate, invoice economic
  // identity or persisted-link change invalidates the discovered plan and forces a fresh
  // outer attempt; capacity is never computed from this snapshot.
  const current = discoverInvoiceSourcePlan(db, plan.invoiceId);
  if (JSON.stringify(current) !== JSON.stringify(plan)) {
    throw new HttpError(409, '发票来源锁计划已过期，请在新事务重试', {
      code: 'A3_INVOICE_SOURCE_PLAN_STALE', planned: plan, current,
    });
  }
  return current;
}

function recordInvoiceLinks(db, invoice, sources) {
  const now = new Date().toISOString();
  for (const source of sources) {
    const quantity = source.invoicedQuantity;
    const amount = source.invoicedAmountCents;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || !Number.isSafeInteger(amount) || amount < 0) {
      throw new HttpError(409, 'Invoice source allocation is not a safe integer', { code: 'FINANCE_INVOICE_SOURCE_LINK_INVALID' });
    }
    if (source.sourceType === 'SERVICE_FULFILLMENT' && amount === 0) continue;
    if (source.sourceType === 'SERVICE_FULFILLMENT' && (quantity <= 0 || !source.sourceLineId || source.sourceLineId !== source.sourceId)) {
      throw new HttpError(409, 'Service invoice source identity is invalid', { code: 'FINANCE_INVOICE_SOURCE_LINK_INVALID' });
    }
    const existing = db.prepare(`SELECT * FROM finance_invoice_source_links WHERE invoice_id=? AND invoice_side=? AND source_type=? AND source_id=? AND source_line_id=?${planLock(db)}`)
      .get(invoice.id, invoice.type, source.sourceType, source.sourceId, source.sourceLineId || '');
    if (existing) {
      if (Number(existing.invoiced_quantity) !== quantity || Number(existing.invoiced_amount_cents) !== amount) {
        throw new HttpError(409, 'Invoice source allocation conflicts with persisted evidence', { code: 'FINANCE_INVOICE_SOURCE_LINK_CONFLICT' });
      }
      continue;
    }
    if (source.sourceType === 'SERVICE_FULFILLMENT') {
      const fulfillment = db.prepare(`SELECT * FROM service_fulfillments WHERE id=? AND confirmation_state='CONFIRMED'${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(source.sourceId);
      const open = db.prepare(`SELECT * FROM account_receivables WHERE source_type='SERVICE_FULFILLMENT' AND source_id=? AND item_kind='FINAL'${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(source.sourceId);
      if (!fulfillment || !open) throw new HttpError(409, 'Service fulfillment Finance source is unavailable', { code: 'SERVICE_INVOICE_SOURCE_UNAVAILABLE' });
      const used = db.prepare(`SELECT COALESCE(SUM(l.invoiced_quantity),0) quantity,COALESCE(SUM(l.invoiced_amount_cents),0) amount
        FROM finance_invoice_source_links l JOIN sales_invoices i ON i.id=l.invoice_id
        WHERE l.source_type='SERVICE_FULFILLMENT' AND l.source_id=? AND i.status='POSTED'`).get(source.sourceId);
      if (Number(used.quantity) + quantity > Number(fulfillment.confirmation_qty_micros)
          || Number(used.amount) + amount > Number(open.amount_cents)) {
        throw new HttpError(409, 'Service fulfillment invoice capacity exceeded', { code: 'SERVICE_INVOICE_CAPACITY_EXCEEDED' });
      }
    }
    db.prepare(`INSERT INTO finance_invoice_source_links(id,invoice_id,invoice_side,source_type,source_id,source_line_id,invoiced_quantity,invoiced_amount_cents,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      id(),
      invoice.id, invoice.type, source.sourceType, source.sourceId, source.sourceLineId || '',
      Number.isSafeInteger(source.invoicedQuantity) ? source.invoicedQuantity : 0,
      Number.isSafeInteger(source.invoicedAmountCents) ? source.invoicedAmountCents : 0,
      now,
    );
  }
}

function updateInvoiceRecognition(db, invoice, recognitionMode, openItemId, provisionalOriginId) {
  const table = invoice.type === 'SALES_INVOICE' ? 'sales_invoices' : 'supplier_bills';
  db.prepare(`UPDATE ${table} SET recognition_mode=?,open_item_id=?,provisional_origin_id=? WHERE id=?`)
    .run(recognitionMode, openItemId || null, provisionalOriginId || null, invoice.id);
}

export function recognizeFinanceExposure(db, input) {
  validateInput(input);
  return atomic(db, () => {
    assertFinanceBusinessDateOpen(db, input.side, input.businessDate);
    const sources = input.sources?.length ? input.sources : [input.source];
    const recognitionMode = input.recognitionMode || resolveRecognitionModeForSources(db, input.side, sources, input.businessDate);

    if (!input.invoice) {
      if (recognitionMode === RECOGNITION_MODES.INVOICE_DRIVEN) {
        return { openItemId: null, itemKind: null, recognizedCents: 0, recognitionMode, links: [] };
      }
      const openItemId = recognitionMode === RECOGNITION_MODES.PROVISIONAL
        ? createProvisionalExposure(db, input)
        : createFinalExposure(db, input, recognitionMode);
      audit(db, input.actorId, 'RECOGNIZE_FINANCE_EXPOSURE', `${input.side}_OPEN_ITEM`, openItemId, recognitionMode);
      return { openItemId, itemKind: recognitionMode === RECOGNITION_MODES.PROVISIONAL ? 'PROVISIONAL' : 'FINAL', recognizedCents: input.amountCents, recognitionMode, links: [] };
    }

    recordInvoiceLinks(db, input.invoice, sources);
    if (recognitionMode === RECOGNITION_MODES.DIRECT) {
      const openItems = [...new Set(sources.map((source) => {
        const row = db.prepare(`SELECT id,item_kind FROM ${TABLES[input.side].table} WHERE source_type=? AND source_id=?`).get(source.sourceType, source.sourceId);
        if (!row || row.item_kind !== 'FINAL') throw new HttpError(409, '直接业务确认模式缺少来源最终 open item');
        return row.id;
      }))];
      updateInvoiceRecognition(db, input.invoice, recognitionMode, openItems.length === 1 ? openItems[0] : null, null);
      audit(db, input.actorId, 'LINK_INVOICE_EXPOSURE', input.invoice.type, input.invoice.id, openItems.join(','));
      return { openItemId: openItems.length === 1 ? openItems[0] : null, itemKind: 'FINAL', recognizedCents: 0, recognitionMode, links: openItems };
    }

    const invoiceSource = { sourceType: input.invoice.type, sourceId: input.invoice.id, sourceNo: input.invoice.no };
    if (recognitionMode === RECOGNITION_MODES.INVOICE_DRIVEN) {
      const openItemId = createFinalExposure(db, { ...input, source: invoiceSource }, recognitionMode);
      updateInvoiceRecognition(db, input.invoice, recognitionMode, openItemId, null);
      audit(db, input.actorId, 'RECOGNIZE_INVOICE_EXPOSURE', input.invoice.type, input.invoice.id, openItemId);
      return { openItemId, itemKind: 'FINAL', recognizedCents: input.amountCents, recognitionMode, links: [openItemId] };
    }

    if (sources.some((source) => source.fullyInvoiced !== true)) {
      throw new HttpError(409, '暂估转财务模式必须完整开票后转换，避免 provisional/final 重复或遗漏');
    }
    const provisionalRows = [...new Map(sources.map((source) => {
      const row = db.prepare(`SELECT * FROM ${TABLES[input.side].table} WHERE source_type=? AND source_id=?`).get(source.sourceType, source.sourceId);
      if (!row || row.item_kind !== 'PROVISIONAL' || row.conversion_state !== 'OPEN') throw new HttpError(409, '暂估来源不存在或已转换');
      return [row.id, row];
    })).values()];
    const firstOriginId = provisionalRows[0]?.id || null;
    const openItemId = createFinalExposure(db, { ...input, source: invoiceSource }, recognitionMode, firstOriginId);
    for (const provisional of provisionalRows) {
      convertProvisionalToFinancial(db, { provisionalOpenItemId: provisional.id, finalOpenItemId: openItemId, side: input.side, actor: { id: input.actorId } });
    }
    updateInvoiceRecognition(db, input.invoice, recognitionMode, openItemId, firstOriginId);
    audit(db, input.actorId, 'CONVERT_PROVISIONAL_EXPOSURE', input.invoice.type, input.invoice.id, openItemId);
    return { openItemId, itemKind: 'FINAL', recognizedCents: input.amountCents, recognitionMode, links: provisionalRows.map((row) => row.id) };
  });
}
