// SC80 — Sales Gross Profit  ·  SC81 — Sales Ranking
//
// Canonical-fact consumption contract (Requirement §34.3.16):
//
//   "Reporting 必须消费 canonical facts；不允许 reporting shadow ledger."
//
// This module therefore:
//   * contains NO table creation, NO cached balance table and NO second
//     valuation engine;
//   * reads the canonical revenue documents (CONFIRMED sales_deliveries,
//     CONFIRMED service_fulfillments, CONFIRMED SALES return_orders);
//   * reads the canonical cost evidence already posted by Inventory /
//     Finance (`inventory_valuation_movements`, movement_type
//     'SALES_DELIVERY_COGS' and 'SALES_RETURN_COGS_REVERSAL');
//   * aggregates with integer cents only — never floats.
//
// Revenue / cost sign model
// ------------------------
//   delivery line       revenue = +sdi.amount_cents      cost = -SUM(value_delta_cents)
//   service fulfillment revenue = +recognition_amount    cost = 0 (no inventory leg exists)
//   return item         revenue = -roi.amount_cents      cost = -SUM(value_delta_cents)
//
// A COGS issue movement stores a NEGATIVE value_delta_cents (stock value
// leaves the balance) and a COGS reversal stores a POSITIVE one (stock value
// comes back). The cost column therefore negates the movement sum, so that
// `costCents` is always "cost incurred" expressed as a positive number and
// gross profit is `revenueCents - costCents`.
//
// Gift-line rule (Requirement §34.3.5 SC29 + SC07)
// -------------------------------------------------
// A gift line has selling price 0 and revenue 0, but it still consumes
// inventory and therefore still posts COGS. Because the cost side is read
// from the canonical valuation movements and NOT derived from the revenue
// side, a gift line automatically yields revenue 0 / cost > 0 / gross
// profit < 0. The report never treats a gift line as free inventory.
//
// Service-line rule (Wave 8)
// --------------------------
// A pure service delivery produces no inventory movement and no COGS at
// all — there is no canonical cost movement to read. Its cost is therefore
// reported as 0 with the explicit cost basis `NO_COGS_APPLICABLE`, NOT as
// a silently assumed zero. `costBasis` on every row states which rule
// produced the cost column.
//
// Reporting-side grouping is derived, never stored: the by-dimension rows
// are computed from the canonical line facts on every request.

const MAX_RANK_ROWS = 500;

export const SALES_RANKING_DIMENSIONS = Object.freeze(['customer', 'material', 'salesperson', 'salesGroup']);

const SALES_GROSS_PROFIT_DATE_BASIS = Object.freeze({
  delivery: '出货按确认出货日期（sales_deliveries.delivery_date）',
  service: '服务履约按业务日期（service_fulfillments.business_date）',
  return: '退货按退货日期（return_orders.return_date）',
});

const SALES_GROSS_PROFIT_COMPONENTS = Object.freeze([
  { key: 'deliveryRevenue', label: '销售出库收入', source: 'sales_deliveries.total_cents / sales_delivery_items.amount_cents' },
  { key: 'serviceRevenue', label: '服务履约收入', source: 'service_fulfillments.recognition_amount_cents' },
  { key: 'returnRevenue', label: '销售退货冲减收入', source: 'return_orders.total_cents / return_order_items.amount_cents' },
  { key: 'deliveryCost', label: '销售出库成本', source: "inventory_valuation_movements 'SALES_DELIVERY_COGS'" },
  { key: 'returnCost', label: '销售退货冲回成本', source: "inventory_valuation_movements 'SALES_RETURN_COGS_REVERSAL'" },
]);

// A delivery line's cost is the canonical COGS valuation movement issued
// for exactly that delivery line. `source_item_id` is the delivery item
// id (the writer posts SALES_DELIVERY_COGS with sourceItemId = delivery
// item id), so the join is line-exact and never guesses.
function deliveryLineFacts(db, filters) {
  const where = ["sd.status = 'CONFIRMED'", "sd.delivery_date IS NOT NULL", "sd.delivery_date <> ''"];
  const params = [];
  if (filters.dateFrom) { where.push('sd.delivery_date >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push('sd.delivery_date <= ?'); params.push(filters.dateTo); }
  if (filters.customerId) { where.push('sd.customer_id = ?'); params.push(filters.customerId); }
  const rows = db.prepare(`
    SELECT sd.id AS documentId, sd.delivery_no AS documentNo, sd.delivery_date AS businessDate,
           sd.customer_id AS customerId, so.salesperson_id AS salespersonId, so.sales_group_id AS salesGroupId,
           sdi.id AS lineId, sdi.product_id AS productId, sdi.amount_cents AS revenueCents,
           COALESCE(oi.is_gift_line, 0) AS isGiftLine,
           COALESCE((SELECT SUM(vm.value_delta_cents) FROM inventory_valuation_movements vm
                     WHERE vm.source_type = 'SALES_DELIVERY' AND vm.source_id = sd.id
                       AND vm.source_item_id = sdi.id AND vm.movement_type = 'SALES_DELIVERY_COGS'), 0) AS costValueDeltaCents,
           (SELECT COUNT(*) FROM inventory_valuation_movements vm
            WHERE vm.source_type = 'SALES_DELIVERY' AND vm.source_id = sd.id
              AND vm.source_item_id = sdi.id AND vm.movement_type = 'SALES_DELIVERY_COGS') AS costMovementCount,
           (SELECT COUNT(*) FROM inventory_valuation_movements vm
            WHERE vm.source_type = 'SALES_DELIVERY' AND vm.source_id = sd.id
              AND vm.source_item_id = sdi.id AND vm.movement_type = 'SALES_DELIVERY_COGS'
              AND vm.status = 'LEGACY_UNVALUED') AS legacyUnvaluedCount
    FROM sales_deliveries sd
    JOIN sales_delivery_items sdi ON sdi.delivery_id = sd.id
    LEFT JOIN sales_orders so ON so.id = sd.sales_order_id
    LEFT JOIN sales_order_items oi ON oi.id = sdi.sales_order_item_id
    WHERE ${where.join(' AND ')}
    ORDER BY sd.delivery_date, sd.delivery_no, sdi.line_no, sdi.id
  `).all(...params);
  return rows.map((row) => {
    const costMovementCount = Number(row.costMovementCount);
    const legacyUnvaluedCount = Number(row.legacyUnvaluedCount);
    return {
      kind: 'delivery',
      documentId: row.documentId,
      documentNo: row.documentNo,
      lineId: row.lineId,
      businessDate: row.businessDate,
      customerId: row.customerId,
      salespersonId: row.salespersonId || null,
      salesGroupId: row.salesGroupId || null,
      productId: row.productId,
      // The canonical gift-line flag lives on the source ORDER line. It is
      // read (not inferred from the amount) so a 100%-discount line is not
      // mistaken for a gift and a gift line is never mistaken for free stock.
      isGiftLine: Number(row.isGiftLine) === 1,
      revenueCents: Number(row.revenueCents),
      // Cost is negated so that it reads as "cost incurred" (positive).
      costCents: -Number(row.costValueDeltaCents),
      costBasis: costMovementCount === 0
        ? 'NO_COGS_POSTED'
        : legacyUnvaluedCount > 0
          ? 'LEGACY_UNVALUED'
          : 'POSTED_VALUATION',
      costEvidenceAvailable: costMovementCount > 0,
    };
  });
}

// A confirmed service fulfillment recognises revenue through the Finance
// recognition path and produces no inventory movement at all. There is
// therefore no canonical cost movement for it. The cost is 0 with the
// explicit basis `NO_COGS_APPLICABLE` — never an implicit assumption.
function serviceLineFacts(db, filters) {
  const where = ["sf.confirmation_state = 'CONFIRMED'", "sf.business_date IS NOT NULL", "sf.business_date <> ''"];
  const params = [];
  if (filters.dateFrom) { where.push('sf.business_date >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push('sf.business_date <= ?'); params.push(filters.dateTo); }
  if (filters.customerId) { where.push('sf.customer_id = ?'); params.push(filters.customerId); }
  const rows = db.prepare(`
    SELECT sf.id AS documentId, sf.fulfillment_no AS documentNo, sf.business_date AS businessDate,
           sf.customer_id AS customerId, sf.sales_group_id AS salesGroupId,
           sf.sales_order_id AS salesOrderId, sf.product_id AS productId,
           sf.recognition_amount_cents AS revenueCents, so.salesperson_id AS salespersonId
    FROM service_fulfillments sf
    LEFT JOIN sales_orders so ON so.id = sf.sales_order_id
    WHERE ${where.join(' AND ')}
    ORDER BY sf.business_date, sf.fulfillment_no, sf.id
  `).all(...params);
  return rows.map((row) => ({
    kind: 'service',
    documentId: row.documentId,
    documentNo: row.documentNo,
    lineId: row.documentId,
    businessDate: row.businessDate,
    customerId: row.customerId,
    salespersonId: row.salespersonId || null,
    salesGroupId: row.salesGroupId || null,
    productId: row.productId,
    revenueCents: Number(row.revenueCents),
    costCents: 0,
    costBasis: 'NO_COGS_APPLICABLE',
    costEvidenceAvailable: false,
  }));
}

// A confirmed sales return reverses revenue and reverses the cost that the
// original delivery issued. The reversal movement is posted against the
// RETURN item, so the join is line-exact.
function returnLineFacts(db, filters) {
  const where = ["ro.source_type = 'SALES'", "ro.status = 'CONFIRMED'", "ro.return_date IS NOT NULL", "ro.return_date <> ''"];
  const params = [];
  if (filters.dateFrom) { where.push('ro.return_date >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push('ro.return_date <= ?'); params.push(filters.dateTo); }
  if (filters.customerId) { where.push('ro.customer_id = ?'); params.push(filters.customerId); }
  const rows = db.prepare(`
    SELECT ro.id AS documentId, ro.return_no AS documentNo, ro.return_date AS businessDate,
           ro.customer_id AS customerId, so.salesperson_id AS salespersonId, so.sales_group_id AS salesGroupId,
           roi.id AS lineId, roi.product_id AS productId, roi.amount_cents AS revenueCents,
           COALESCE((SELECT SUM(vm.value_delta_cents) FROM inventory_valuation_movements vm
                     WHERE vm.source_type = 'SALES_RETURN' AND vm.source_id = ro.id
                       AND vm.source_item_id = roi.id AND vm.movement_type = 'SALES_RETURN_COGS_REVERSAL'), 0) AS costValueDeltaCents,
           (SELECT COUNT(*) FROM inventory_valuation_movements vm
            WHERE vm.source_type = 'SALES_RETURN' AND vm.source_id = ro.id
              AND vm.source_item_id = roi.id AND vm.movement_type = 'SALES_RETURN_COGS_REVERSAL') AS costMovementCount
    FROM return_orders ro
    JOIN return_order_items roi ON roi.return_id = ro.id
    -- A SALES return's source_id points at the originating sales DELIVERY,
    -- so the salesperson / sales group are reached through
    -- delivery -> sales order. The order is the canonical owner of the
    -- commercial attribution.
    LEFT JOIN sales_deliveries sd ON sd.id = ro.source_id
    LEFT JOIN sales_orders so ON so.id = sd.sales_order_id
    WHERE ${where.join(' AND ')}
    ORDER BY ro.return_date, ro.return_no, roi.line_no, roi.id
  `).all(...params);
  return rows.map((row) => {
    const costMovementCount = Number(row.costMovementCount);
    return {
      kind: 'return',
      documentId: row.documentId,
      documentNo: row.documentNo,
      lineId: row.lineId,
      businessDate: row.businessDate,
      customerId: row.customerId,
      salespersonId: row.salespersonId || null,
      salesGroupId: row.salesGroupId || null,
      productId: row.productId,
      // A return REDUCES revenue, therefore its revenue contribution is negative.
      revenueCents: -Number(row.revenueCents),
      // The reversal movement is positive (stock value came back), so the
      // negated sum is a negative cost — i.e. the cost is reduced again.
      costCents: -Number(row.costValueDeltaCents),
      costBasis: costMovementCount === 0 ? 'NO_COGS_REVERSAL_POSTED' : 'POSTED_VALUATION',
      costEvidenceAvailable: costMovementCount > 0,
    };
  });
}

export function querySalesGrossProfitLines(db, filters) {
  return [
    ...deliveryLineFacts(db, filters),
    ...serviceLineFacts(db, filters),
    ...returnLineFacts(db, filters),
  ].sort((left, right) => {
    if (left.businessDate !== right.businessDate) return left.businessDate < right.businessDate ? -1 : 1;
    if (left.documentNo !== right.documentNo) return left.documentNo.localeCompare(right.documentNo);
    return String(left.lineId).localeCompare(String(right.lineId));
  });
}

function sumByKind(lines, kind, field) {
  return lines.filter((line) => line.kind === kind).reduce((sum, line) => sum + line[field], 0);
}

// SC80 — Sales Gross Profit.
//
// The report is built from the canonical line facts; it never keeps a
// balance of its own.
export function buildSalesGrossProfit(db, filters, options = {}) {
  const lines = querySalesGrossProfitLines(db, filters);
  const deliveryRevenueCents = sumByKind(lines, 'delivery', 'revenueCents');
  const serviceRevenueCents = sumByKind(lines, 'service', 'revenueCents');
  const returnRevenueCents = sumByKind(lines, 'return', 'revenueCents');
  const deliveryCostCents = sumByKind(lines, 'delivery', 'costCents');
  const returnCostCents = sumByKind(lines, 'return', 'costCents');
  const serviceCostCents = sumByKind(lines, 'service', 'costCents');
  const revenueCents = deliveryRevenueCents + serviceRevenueCents + returnRevenueCents;
  const costCents = deliveryCostCents + returnCostCents + serviceCostCents;
  const grossProfitCents = revenueCents - costCents;
  // A gift line is identified by the canonical `is_gift_line` flag on the
  // source order line, never by the amount alone.
  const giftLineCount = lines.filter((line) => line.isGiftLine === true).length;
  // Any other zero-revenue but cost-bearing line (for example an
  // authoritative 100% discount) is disclosed separately so it is never
  // confused with a gift.
  const zeroRevenueCostBearingLineCount = lines.filter(
    (line) => line.isGiftLine !== true && line.revenueCents === 0 && line.costCents > 0,
  ).length;
  const serviceLineCount = lines.filter((line) => line.kind === 'service').length;
  const noCogsLineCount = lines.filter((line) => line.costBasis === 'NO_COGS_APPLICABLE').length;
  const noCogsPostedLineCount = lines.filter((line) => line.costBasis === 'NO_COGS_POSTED').length;
  return {
    revenueCents,
    costCents,
    grossProfitCents,
    components: {
      deliveryRevenueCents,
      serviceRevenueCents,
      returnRevenueCents,
      deliveryCostCents,
      returnCostCents,
      serviceCostCents,
    },
    lineCount: lines.length,
    lineCounts: {
      delivery: lines.filter((line) => line.kind === 'delivery').length,
      service: serviceLineCount,
      return: lines.filter((line) => line.kind === 'return').length,
    },
    // A gift line is zero-revenue but still cost-bearing. It is disclosed
    // explicitly so an operator can never read the gross profit as if the
    // gift inventory were free.
    giftBearingLineCount: giftLineCount,
    zeroRevenueCostBearingLineCount,
    serviceLineCount,
    noCogsApplicableLineCount: noCogsLineCount,
    noCogsPostedLineCount,
    accuracy: (noCogsPostedLineCount > 0 || lines.some((line) => line.costBasis === 'LEGACY_UNVALUED'))
      ? 'LIMITED'
      : 'COMPLETE',
    accuracyNotice: noCogsPostedLineCount > 0
      ? `${noCogsPostedLineCount} 条出货行没有对应的已过账成本证据，其成本按 0 计入并在 costBasis 中标记为 NO_COGS_POSTED。`
      : null,
    componentSources: SALES_GROSS_PROFIT_COMPONENTS,
    dateBasis: SALES_GROSS_PROFIT_DATE_BASIS,
    lines: options.includeLines ? lines : undefined,
  };
}

// SC81 — Sales Ranking.
//
// Four dimensions: customer / material / salesperson / sales group.
// The ranking metric is gross profit (reusing SC80), with the revenue
// amount exposed alongside it. Rows are grouped over the SAME canonical
// line facts that SC80 consumes, so a ranking can never disagree with the
// gross-profit report.
const RANK_DIMENSION_CONFIG = Object.freeze({
  customer: { key: 'customer', label: '客户', idColumn: 'customerId', lookup: 'customers', codeColumn: 'code' },
  material: { key: 'material', label: '物料', idColumn: 'productId', lookup: 'products', codeColumn: 'code' },
  salesperson: { key: 'salesperson', label: '销售员', idColumn: 'salespersonId', lookup: 'salesperson_profiles', codeColumn: 'salesperson_code' },
  salesGroup: { key: 'salesGroup', label: '销售组', idColumn: 'salesGroupId', lookup: 'sales_groups', codeColumn: 'group_code' },
});

function lookupEntity(db, table, id, codeColumn) {
  if (!id) return null;
  const row = db.prepare(`SELECT id, ${codeColumn} AS code, name FROM ${table} WHERE id = ?`).get(id);
  return row ? { id: row.id, code: row.code, name: row.name } : { id, code: null, name: null };
}

// Exported so the CSV export can label a canonical entity without
// duplicating the lookup contract.
export function lookupRankingEntity(db, table, id, codeColumn = 'code') {
  return lookupEntity(db, table, id, codeColumn);
}

export function buildSalesRanking(db, filters, dimension) {
  const config = RANK_DIMENSION_CONFIG[dimension];
  if (!config) return null;
  const lines = querySalesGrossProfitLines(db, filters);
  const buckets = new Map();
  for (const line of lines) {
    const rawId = line[config.idColumn] || null;
    // A line without a dimension key is still real revenue / cost. It is
    // aggregated under the explicit `UNASSIGNED` bucket so it is never
    // silently dropped from the ranking.
    const key = rawId || '__UNASSIGNED__';
    const bucket = buckets.get(key) || {
      key,
      id: rawId,
      entity: rawId ? lookupEntity(db, config.lookup, rawId, config.codeColumn) : null,
      revenueCents: 0,
      costCents: 0,
      grossProfitCents: 0,
      lineCount: 0,
    };
    bucket.revenueCents += line.revenueCents;
    bucket.costCents += line.costCents;
    bucket.grossProfitCents += line.revenueCents - line.costCents;
    bucket.lineCount += 1;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].sort((left, right) => {
    if (right.grossProfitCents !== left.grossProfitCents) return right.grossProfitCents - left.grossProfitCents;
    if (right.revenueCents !== left.revenueCents) return right.revenueCents - left.revenueCents;
    const leftCode = left.entity?.code || left.key;
    const rightCode = right.entity?.code || right.key;
    return String(leftCode).localeCompare(String(rightCode));
  });
  let rank = 0;
  let previousProfit = null;
  const rows = ranked.slice(0, MAX_RANK_ROWS).map((bucket) => {
    // Dense competition ranking: equal metric values share the same rank.
    if (previousProfit === null || bucket.grossProfitCents !== previousProfit) {
      rank += 1;
      previousProfit = bucket.grossProfitCents;
    }
    return {
      rank,
      dimension: config.key,
      dimensionLabel: config.label,
      key: bucket.key,
      id: bucket.id,
      entity: bucket.entity,
      code: bucket.entity?.code || null,
      name: bucket.entity?.name || null,
      unassigned: bucket.id === null,
      revenueCents: bucket.revenueCents,
      costCents: bucket.costCents,
      grossProfitCents: bucket.grossProfitCents,
      lineCount: bucket.lineCount,
    };
  });
  return {
    dimension: config.key,
    dimensionLabel: config.label,
    metric: 'GROSS_PROFIT',
    metricLabel: '毛利（分）',
    rows,
    totalRowCount: ranked.length,
    truncated: ranked.length > rows.length,
  };
}
