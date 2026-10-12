import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { transaction } from '../db.js';
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

function recordInvoiceLinks(db, invoice, sources) {
  const now = new Date().toISOString();
  for (const source of sources) {
    const existing = db.prepare(`SELECT id FROM finance_invoice_source_links WHERE invoice_id=? AND invoice_side=? AND source_type=? AND source_id=? AND source_line_id=?`)
      .get(invoice.id, invoice.type, source.sourceType, source.sourceId, source.sourceLineId || '');
    if (existing) continue;
    db.prepare(`INSERT INTO finance_invoice_source_links(id,invoice_id,invoice_side,source_type,source_id,source_line_id,invoiced_quantity,invoiced_amount_cents,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      `${invoice.id}:${source.sourceLineId || source.sourceId}`,
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
