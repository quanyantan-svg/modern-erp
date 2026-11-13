// Sales & Customer — domain-level browser UAT fixture.
//
// The fixture builds a REAL Sales world in the disposable SQLite database of
// `sales-customer-domain-responsive-uat.mjs`. An empty-state-only pass is weak
// evidence, so every surface the gate visits must be able to paint real rows.
//
// The seeding follows the pattern already proven by
// `server/sales-customer-batch-a.test.js` and
// `server/sales-customer-parameters-closure.test.js`: the sales foundation rows
// (parameters, groups, salespersons, memberships, classifications) and the
// commercial extension of the customer are written directly, and the business
// documents that can be produced through the production writers (quotation,
// sales order, delivery notice, order change, reservation intent, service
// fulfillment, consignment document) are written through the PRODUCTION HTTP
// writers with a real administrator session, so the derived keys, price
// snapshots and state transitions are the ones the production code produces.
//
// Nothing here modifies a shared fixture file: the fixture is private to the
// browser gate.

export const BUSINESS_DATE = '2026-10-15';
export const DELIVERY_DATE = '2026-10-20';
export const UOM_FALLBACK = 'PCS';

function stamp() {
  return new Date().toISOString();
}

function uomOf(db) {
  const row = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get();
  return row?.base_uom_code || UOM_FALLBACK;
}

/**
 * Seed the Sales foundation rows the four configuration work surfaces read.
 * The SYSTEM parameter row plus one DOCUMENT_TYPE row are both written, so
 * 「销售参数」 really shows two scopes instead of one.
 */
export function seedSalesFoundation(db) {
  const now = stamp();
  const uom = uomOf(db);
  db.prepare('INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)')
    .run(uom, uom, now, now);

  // A second customer, dedicated to the over-limit Credit scenario. It must be
  // a DIFFERENT customer: a customer with two effective credit objects makes
  // the production Credit Check refuse to guess the applicable scope
  // (`CREDIT_CREDIT_OBJECT_AMBIGUOUS`), which would break every sales
  // document of the main customer.
  db.prepare('INSERT OR IGNORE INTO customers(id,code,name,contact,phone,address,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('uat-sc-customer-override', 'C-UAT-OVR', 'UAT 特别审批客户', '', '', '', now, now);

  db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
    sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
    active,created_at,updated_at,created_by,updated_by)
    VALUES('SYSTEM','SYSTEM',NULL,0,0,1,1,1,'BOTH','DISABLED',1,?,?,?,?)`)
    .run(now, now, 'user-admin', 'user-admin');
  db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
    sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
    active,created_at,updated_at,created_by,updated_by)
    VALUES('DOCUMENT_TYPE:SALES_ORDER','DOCUMENT_TYPE','SALES_ORDER',1,1,1,1,1,'BOTH','INVENTORY_LOCK',1,?,?,?,?)`)
    .run(now, now, 'user-admin', 'user-admin');

  db.prepare("INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('uat-sc-group','UATSC','UAT 销售组',1,?,?)")
    .run(now, now);
  db.prepare("INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('uat-sc-group-2','UATSC2','UAT 第二销售组',1,?,?)")
    .run(now, now);
  db.prepare("INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('uat-sc-salesperson','UATSP','UAT 销售员',NULL,1,?,?)")
    .run(now, now);
  // The sales specialist of the canonical repository actors is linked to a
  // salesperson profile: a sales-group scoped document requires the actor to be
  // mapped to an active salesperson.
  db.prepare("UPDATE salesperson_profiles SET user_id='user-sales', updated_at=? WHERE id='uat-sc-salesperson'").run(now);
  db.prepare("INSERT OR IGNORE INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('uat-sc-salesperson-reviewer','UATSPR','UAT 销售主管','user-reviewer',1,?,?)")
    .run(now, now);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
    VALUES('uat-sc-membership-reviewer','uat-sc-salesperson-reviewer','uat-sc-group','2026-01-01',1,1,?,?,?,?)`)
    .run(now, now, 'user-admin', 'user-admin');
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
    VALUES('uat-sc-membership','uat-sc-salesperson','uat-sc-group','2026-01-01',1,1,?,?,?,?)`)
    .run(now, now, 'user-admin', 'user-admin');
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
    VALUES('uat-sc-membership-2','uat-sc-salesperson','uat-sc-group-2','2026-01-01',0,1,?,?,?,?)`)
    .run(now, now, 'user-admin', 'user-admin');

  db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
    default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
    VALUES('uat-sc-classification','product-001',1,?,?,1000,500,0,1,?,?)`).run(uom, uom, now, now);
  // A second, service-classified material: the service fulfillment writer
  // refuses a line that is not an ACTIVE A-61 service classification.
  db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
    default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,service_kind,active,created_at,updated_at)
    VALUES('uat-sc-classification-service','product-002',1,?,?,0,0,1,'INSTALLED',1,?,?)`).run(uom, uom, now, now);

  db.prepare(`INSERT INTO sales_sellable_scope_rules(id,scope_dimension,customer_id,salesperson_id,product_id,effect,effective_from,effective_to,active,created_at,updated_at,created_by,updated_by)
    VALUES('uat-sc-scope-rule','CUSTOMER_PRODUCT','customer-001',NULL,'product-001','ALLOW','2026-01-01',NULL,1,?,?,?,?)`)
    .run(now, now, 'user-admin', 'user-admin');
  db.prepare(`INSERT INTO sales_sellable_scope_rules(id,scope_dimension,customer_id,salesperson_id,product_id,effect,effective_from,effective_to,active,created_at,updated_at,created_by,updated_by)
    VALUES('uat-sc-scope-rule-2','SALESPERSON_PRODUCT',NULL,'uat-sc-salesperson','product-002','DENY','2026-01-01',NULL,1,?,?,?,?)`)
    .run(now, now, 'user-admin', 'user-admin');

  return { uom };
}

/**
 * The price list that gives the sales order lines an authoritative price, and
 * the commercial extension that binds the customer to the sales person, the
 * sales group and the price list.
 */
export function seedCommercialPricing(db) {
  const now = stamp();
  const uom = uomOf(db);
  const priceListId = '33333333-3333-4333-8333-333333333333';
  db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,effective_from,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
    VALUES(?,'UATSC-PL','UAT 销售价格表','CNY',0,'2026-01-01','ACTIVE',?,'user-admin',?,'user-admin',?,'user-admin')`)
    .run(priceListId, now, now, now);
  const materialKey = `M:${Buffer.from('product-001').toString('hex').toUpperCase()}`;
  const pricingKey = `U:${Buffer.from(uom).toString('hex').toUpperCase()}|Q:0000000000000000|D:20260101`;
  db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
    pricing_uom_code,pricing_identity_key,qty_break_min_micros,effective_from,created_at,created_by)
    VALUES('uat-sc-price-entry',?,'product-001',NULL,'ALL',?,'A',?,?,0,'2026-01-01',?,'user-admin')`)
    .run(priceListId, materialKey, uom, pricingKey, now);
  db.prepare("INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES('uat-sc-price-version','uat-sc-price-entry',1,1250,'{}',?,'user-admin')")
    .run(now);
  // A second entry for the service-classified material, so the service order
  // line also resolves an authoritative price.
  const serviceMaterialKey = `M:${Buffer.from('product-002').toString('hex').toUpperCase()}`;
  db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
    pricing_uom_code,pricing_identity_key,qty_break_min_micros,effective_from,created_at,created_by)
    VALUES('uat-sc-price-entry-service',?,'product-002',NULL,'ALL',?,'A',?,?,0,'2026-01-01',?,'user-admin')`)
    .run(priceListId, serviceMaterialKey, uom, pricingKey, now);
  db.prepare("INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES('uat-sc-price-version-service','uat-sc-price-entry-service',1,880,'{}',?,'user-admin')")
    .run(now);

  db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,payer_customer_id,
    default_salesperson_id,default_sales_group_id,default_payment_terms_days,default_settlement_method,sellable_scope_mode,created_at,updated_at,
    created_by,updated_by,default_pricing_list_id)
    VALUES('customer-001','2026-01-01','customer-001','customer-001','uat-sc-salesperson','uat-sc-group',30,'MONTHLY','ALL_SALES_ENABLED',?,?,?,?,?)`)
    .run(now, now, 'user-admin', 'user-admin', priceListId);

  return { priceListId, uom };
}

/** A warehouse and a consignment location for the delivery / consignment facts. */
export function seedWarehouse(db) {
  const now = stamp();
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
    VALUES('uat-sc-warehouse','UATSC-WH','UAT 仓库','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO consignment_commodity_locations(id,location_code,customer_id,name,address_text,physical_warehouse_id,
    physical_bin_id,active,effective_from,effective_to,version,created_at,updated_at,created_by,updated_by)
    VALUES('uat-sc-location','UATSC-LOC','customer-001','UAT 寄售位','','uat-sc-warehouse',NULL,1,'2026-01-01',NULL,1,?,?,?,?)`)
    .run(now, now, 'user-admin', 'user-admin');
  // Stock for the delivery writer: the sales delivery path requires on-hand
  // quantity at the target warehouse for a non-service classification.
  const stock = db.prepare('SELECT id, quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get('uat-sc-warehouse', 'product-001');
  if (!stock) {
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at)
      VALUES('uat-sc-inventory','uat-sc-warehouse','product-001',100,?)`).run(now);
  } else {
    db.prepare('UPDATE inventory SET quantity=100, updated_at=? WHERE id=?').run(now, stock.id);
  }
}

/**
 * The Credit world for 「信用管理基础」 / 「信用检查」 / 「信用额度与例外查询」:
 * one credit parameter, one credit rule and one credit profile.
 *
 * The credit fixtures of `server/test-utils/wave11-a-credit-query-fixture.js`
 * cover a far larger world; the browser gate only needs the three families to
 * be non-empty so the surfaces paint real rows instead of an empty state.
 */
export async function seedCreditWorld(db, { adminPost, adminGet }) {
  const now = stamp();
  // The parameter code MUST be the canonical one the production resolver
  // reads (`CREDIT_PARAMETERS.MANAGEMENT_ENABLED` in
  // `server/modules/credit-check.js`). A private code compiles but leaves the
  // Credit management switched off, so the Credit Check returns
  // `CREDIT_MANAGEMENT_DISABLED` and writes NO evidence — the 「信用检查」
  // and 「信用特别审批」 lists then stay permanently empty.
  const parameter = await adminPost('/api/credit/policy/parameters', {
    code: 'CREDIT_MANAGEMENT_ENABLED',
    valueBool: 1,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
  }, `uat-credit-parameter-${now}`);
  const rule = await adminPost('/api/credit/policy/rules', {
    ruleCode: 'UAT_CREDIT_SO_SUBMIT',
    businessStage: 'SO_SUBMIT',
    scenario: 'WARNING_ONLY',
    checkTiming: 'BEFORE_WRITE',
    controlStrength: 'WARNING',
    creditItem: 'ORDER_EXPOSURE',
    effectiveFrom: '2026-01-01',
    status: 'ACTIVE',
    resultPayload: { identity: 'uat' },
  }, `uat-credit-rule-${now}`);
  const profile = await adminPost('/api/credit/profiles', {
    customerId: 'customer-001',
    salespersonId: null,
    creditObjectType: 'SALES_ORDER',
    creditObjectId: 'CREDIT-UAT-CUSTOMER-001',
    creditLimitCents: 5000000,
    initialState: 'NORMAL',
    status: 'ACTIVE',
    ratingGrade: 'A',
    overdueDayPolicy: '15',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
  }, `uat-credit-profile-${now}`);
  // A second, deliberately tight credit object. It belongs to a DIFFERENT
  // customer on purpose: a customer with two effective credit objects makes
  // the production Credit Check refuse to guess the applicable scope
  // (`CREDIT_CREDIT_OBJECT_AMBIGUOUS`). It is the credit object a Credit
  // Special Approval is requested against: a check on it concludes
  // `SPECIAL_APPROVAL_REQUIRED` (the OVERRIDE_REQUEST rule), which is the
  // ONLY conclusion a special approval may be requested against. Without it
  // the 「信用特别审批」 list would be legitimately empty.
  const overrideProfile = await adminPost('/api/credit/profiles', {
    customerId: 'uat-sc-customer-override',
    salespersonId: null,
    creditObjectType: 'SALES_ORDER',
    creditObjectId: 'CREDIT-UAT-OVERRIDE-001',
    creditLimitCents: 1000,
    initialState: 'NORMAL',
    status: 'ACTIVE',
    ratingGrade: 'B',
    overdueDayPolicy: '15',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
  }, `uat-credit-override-profile-${now}`);
  // The override rule lives on the SO_APPROVE stage on purpose: two rules of
  // the SAME stage compete and the strongest outcome wins, so an
  // OVERRIDE_REQUEST rule sharing the SO_SUBMIT stage with the WARNING_ONLY
  // rule would be masked by the stronger WARNING conclusion.
  const overrideRule = await adminPost('/api/credit/policy/rules', {
    ruleCode: 'UAT_CREDIT_SO_APPROVE_OVERRIDE',
    businessStage: 'SO_APPROVE',
    scenario: 'OVERRIDE_REQUEST',
    checkTiming: 'BEFORE_WRITE',
    controlStrength: 'WARNING',
    creditItem: 'ORDER_EXPOSURE',
    effectiveFrom: '2026-01-01',
    status: 'ACTIVE',
    resultPayload: { identity: 'uat-override' },
  }, `uat-credit-override-rule-${now}`);

  const problems = Object.entries({ parameter, rule, profile, overrideProfile, overrideRule })
    .filter(([, value]) => value.status >= 400)
    .map(([key, value]) => `${key}:${value.status}:${JSON.stringify(value.body).slice(0, 240)}`);
  if (problems.length) throw new Error(`UAT_CREDIT_WORLD_SEED_FAILED ${problems.join(' | ')}`);

  const history = await adminGet('/api/credit/check-results');
  return { parameter, rule, profile, overrideProfile, overrideRule, historyStatus: history.status };
}

/**
 * The Credit EVIDENCE of the two Credit surfaces the browser gate visits.
 *
 * 「信用检查」 renders the `credit_check_results` of the customer and
 * 「信用特别审批」 renders the `credit_special_approval` rows. Neither list
 * has a row of its own: both are written by a production action, so the
 * fixture has to PERFORM the actions, not fabricate the rows.
 *
 * The actions are performed through the production HTTP writers with a real
 * administrator session, so the check group, the scope result and the
 * approval identity are the ones the production code produces.
 *
 * This MUST run after the business documents exist: the Credit Check needs a
 * real source document (the approved sales order) to compute the exposure
 * against.
 */
export async function seedCreditEvidence(db, { baseUrl, tokens, orderId }) {
  const post = async (path, body, key, actor = 'admin') => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokens[actor]}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  };

  // --- the Credit Check ----------------------------------------------------
  // The source document is the approved sales order of the fixture. The
  // proposed delta is a real exposure increment, so the check produces a
  // scope result and writes the evidence row.
  const check = await post('/api/credit/check', {
    customerId: 'customer-001',
    stage: 'SO_SUBMIT',
    businessDate: BUSINESS_DATE,
    proposedDeltaCents: 100000,
    salesOrderId: orderId,
  }, 'uat-credit-check');
  if (check.status >= 400) {
    throw new Error(`UAT_CREDIT_CHECK_SEED_FAILED ${check.status}:${JSON.stringify(check.data).slice(0, 400)}`);
  }
  const scopeResults = check.data.scopeResults || [];
  // The scope result carries the scope type, not the evidence row identity.
  // The row identity is `${checkGroupId}:${scopeType}`, so it is read back from
  // the persisted evidence instead of being assembled here.
  const checkResultId = (() => {
    const group = check.data.checkGroupId;
    if (!group) return null;
    const row = db.prepare('SELECT id FROM credit_check_results WHERE check_group_id=? ORDER BY scope_type LIMIT 1').get(group);
    return row?.id || null;
  })();

  // --- the over-limit Credit Check ------------------------------------------
  // The check above concludes PASS, because the customer's generous credit
  // object covers the exposure. A Credit Special Approval may only be
  // requested against a check that concluded something releasable, so the
  // fixture runs a SECOND check against the tight credit object, whose
  // OVERRIDE_REQUEST rule concludes `SPECIAL_APPROVAL_REQUIRED`.
  const overrideCheck = await post('/api/credit/check', {
    customerId: 'uat-sc-customer-override',
    creditObjectType: 'SALES_ORDER',
    creditObjectId: 'CREDIT-UAT-OVERRIDE-001',
    stage: 'SO_APPROVE',
    businessDate: BUSINESS_DATE,
    proposedDeltaCents: 500000,
    salesOrderId: orderId,
  }, 'uat-credit-check-override');
  const overrideResultId = (() => {
    const group = overrideCheck.data?.checkGroupId;
    if (!group) return null;
    const row = db.prepare('SELECT id FROM credit_check_results WHERE check_group_id=? ORDER BY scope_type LIMIT 1').get(group);
    return row?.id || null;
  })();

  // --- the Credit Special Approval -----------------------------------------
  // A special approval can only be requested against a Credit Check result
  // that concluded something releasable. The over-limit check is that result.
  let approval = { status: null, data: {} };
  const approvalSourceId = overrideResultId || checkResultId;
  if (approvalSourceId) {
    approval = await post('/api/credit/special-approvals', {
      sourceCreditCheckResultId: approvalSourceId,
      reason: 'UAT 浏览器验收：为超限订单申请一次性特别审批',
      requestedOverrideCents: 50000,
      requestedCeilingCents: 100000,
      requestedExpiryBusinessDate: '2026-12-31',
      scopeMode: 'ONE_TIME',
    }, 'uat-credit-special-approval');
    if (approval.status >= 400) {
      // The approval is only legal against a check that concluded something
      // releasable. A PASS has nothing to override, so the approval list stays
      // legitimately empty; that is reported, not hidden.
      approval = { status: approval.status, data: approval.data, skipped: true };
    }
  }

  const results = db.prepare('SELECT id,scope_type,decision,business_date FROM credit_check_results ORDER BY evaluated_at DESC,id DESC').all();
  const approvals = db.prepare('SELECT id,decision,scope_mode FROM credit_special_approval').all();

  return {
    check: { status: check.status, decision: check.data.decision, reasonCodes: check.data.reasonCodes || [] },
    checkResultId,
    overrideCheck: { status: overrideCheck.status, decision: overrideCheck.data?.decision || null },
    overrideResultId,
    approval: { status: approval.status, id: approval.data?.approval?.id || null, skipped: Boolean(approval.skipped) },
    resultCount: results.length,
    approvalCount: approvals.length,
  };
}

/**
 * The business documents. They are created through the PRODUCTION HTTP writers
 * with a real administrator session wherever the production writer is
 * reachable without an external balance (Planning / Finance / Inventory
 * master), and written directly where a writer has an unreachable external
 * prerequisite. The direct writes use the production schema, so the rows are
 * real facts with real keys — not placeholders.
 */
export async function seedBusinessDocuments(db, { baseUrl, tokens, uom }) {
  // The actors are the canonical repository actors: the sales specialist
  // creates the documents, the sales supervisor approves them. The segregation
  // of duties is a production contract, so the fixture honours it instead of
  // letting one actor approve its own order.
  const post = async (path, body, key, actor = 'sales') => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokens[actor]}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  };
  const problems = [];
  const record = (label, result) => {
    if (result.status >= 400) problems.push(`${label}:${result.status}:${JSON.stringify(result.data).slice(0, 240)}`);
    return result;
  };

  // --- Sales order -------------------------------------------------------
  const order = record('sales-order', await post('/api/sales-orders', {
    customerId: 'customer-001',
    orderDate: BUSINESS_DATE,
    requestedDeliveryDate: DELIVERY_DATE,
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '10' }],
  }, 'uat-sc-order-create'));
  if (order.status >= 400) throw new Error(`UAT_SALES_ORDER_SEED_FAILED ${problems.join(' | ')}`);
  const orderId = order.data.id;
  const orderItem = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no LIMIT 1').get(orderId);

  record('sales-order-submit', await post(`/api/sales-orders/${orderId}/submit`, {}, 'uat-sc-order-submit'));
  record('sales-order-approve', await post(`/api/sales-orders/${orderId}/approve`, {}, 'uat-sc-order-approve', 'reviewer'));

  // --- Sales quotation ----------------------------------------------------
  const quotation = record('quotation', await post('/api/sales-quotations', {
    customerId: 'customer-001',
    validFrom: BUSINESS_DATE,
    validTo: '2026-12-31',
    items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '4' }],
  }, 'uat-sc-quotation-create'));
  record('quotation-publish', await post(`/api/sales-quotations/${quotation.data.quotation.id}/effective-publish`, {}, 'uat-sc-quotation-publish'));

  // --- Delivery notice ----------------------------------------------------
  const notice = record('delivery-notice', await post('/api/delivery-notices', {
    salesOrderId: orderId,
    warehouseId: 'uat-sc-warehouse',
    businessDate: BUSINESS_DATE,
    plannedDeliveryDate: DELIVERY_DATE,
    lines: [{ salesOrderItemId: orderItem.id, scheduledQtyMicros: 4_000_000 }],
  }, 'uat-sc-delivery-notice'));

  // --- Sales order change -------------------------------------------------
  const change = record('order-change', await post('/api/sales-order-changes', {
    path: 'CONTROLLED_DOCUMENT',
    salesOrderId: orderId,
    reason: 'UAT 浏览器验收：客户追加数量',
    lines: [{ op: 'MODIFY', salesOrderItemId: orderItem.id, quantityMicros: 12_000_000 }],
  }, 'uat-sc-order-change'));

  // --- Service fulfillment --------------------------------------------------
  // The service fulfillment writer requires a line whose material carries an
  // ACTIVE A-61 service classification, so a dedicated service order line is
  // created for it.
  let fulfillment = { data: {} };
  const serviceOrder = record('service-order', await post('/api/sales-orders', {
    customerId: 'customer-001',
    orderDate: BUSINESS_DATE,
    requestedDeliveryDate: DELIVERY_DATE,
    items: [{ productId: 'product-002', uomCode: uom, quantityDecimal: '3' }],
  }, 'uat-sc-service-order-create'));
  if (serviceOrder.status < 400) {
    const serviceOrderId = serviceOrder.data.id;
    record('service-order-submit', await post(`/api/sales-orders/${serviceOrderId}/submit`, {}, 'uat-sc-service-order-submit'));
    record('service-order-approve', await post(`/api/sales-orders/${serviceOrderId}/approve`, {}, 'uat-sc-service-order-approve', 'reviewer'));
    const serviceItem = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no LIMIT 1').get(serviceOrderId);
    fulfillment = record('service-fulfillment', await post('/api/service-fulfillments', {
      salesOrderItemId: serviceItem.id,
      confirmationQtyMicros: 2_000_000,
      businessDate: BUSINESS_DATE,
    }, 'uat-sc-service-fulfillment'));
  }

  // --- Consignment commercial document ---------------------------------------
  const consignment = record('consignment', await post('/api/consignment-commercial-documents', {
    customerId: 'customer-001',
    sourceWarehouseId: 'uat-sc-warehouse',
    businessDate: BUSINESS_DATE,
    currencyCode: 'CNY',
    lines: [{
      productId: 'product-001',
      consignmentCommodityLocationId: 'uat-sc-location',
      consignedQtyMicros: 1_000_000,
      unitPriceCents: 1250,
    }],
  }, 'uat-sc-consignment'));

  // --- Reservation intent --------------------------------------------------
  const reservation = record('reservation-intent', await post('/api/sales-reservation-intents', {
    salesOrderId: orderId,
    salesOrderItemId: orderItem.id,
    productId: 'product-001',
    warehouseId: 'uat-sc-warehouse',
    reservationMode: 'INVENTORY_LOCK',
    quantity: 3,
  }, 'uat-sc-reservation-intent'));

  // --- Prepayment gate ----------------------------------------------------
  const requirement = record('prepayment-requirement', await post('/api/sales-prepayment-requirements', {
    salesOrderId: orderId,
    lineNo: 0,
    requiredAmountCents: 100000,
    ratioBasis: 'ORDER_VALUE',
    effectiveFrom: BUSINESS_DATE,
    effectiveTo: null,
  }, 'uat-sc-prepayment-requirement'));

  // --- Sales delivery -----------------------------------------------------
  // The production writer requires an APPROVED order, an active warehouse and
  // on-hand stock; all three are prepared above. The logistics actor holds
  // `SALES_DELIVERIES_MANAGE`.
  const delivery = record('sales-delivery', await post('/api/sales-deliveries', {
    salesOrderId: orderId,
    customerId: 'customer-001',
    warehouseId: 'uat-sc-warehouse',
    deliveryDate: BUSINESS_DATE,
    billingMode: 'DIRECT_BILL',
    sourceMode: 'DIRECT_ORDER',
    items: [{ productId: 'product-001', uomCode: uom, quantity: '2', salesOrderItemId: orderItem.id }],
  }, 'uat-sc-sales-delivery', 'admin'));

  if (problems.length) throw new Error(`UAT_BUSINESS_DOCUMENT_SEED_FAILED ${problems.join(' | ')}`);

  return {
    orderId,
    orderItemId: orderItem.id,
    quotationId: quotation.data.quotation.id,
    noticeId: notice.data?.notice?.id || notice.data?.id,
    changeId: change.data?.change?.id || change.data?.id,
    deliveryId: delivery.data?.id || delivery.data?.deliveryId,
    requirementId: requirement.data?.requirement?.id || requirement.data?.id,
    reservationId: reservation.data?.intent?.id || reservation.data?.id,
    fulfillmentId: fulfillment.data?.fulfillment?.id || fulfillment.data?.id,
    consignmentId: consignment.data?.document?.id || consignment.data?.id,
  };
}
