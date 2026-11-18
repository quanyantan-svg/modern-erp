#!/usr/bin/env node
// 客户测试环境播种脚本（VMI 结算链 + 委外 + 组装 + 期初库存）。
//
// 用途：把客户测试环境播种到「每笔库存变动都有对应总账、权威结账 BLOCKING 全绿」的可演示
// 状态，并让 VMI 结算链（协议 → 收货 → 消耗 → 结算期 → 账单 → 过账）完整可跑。
//
// **只用应用的 HTTP API**：脚本不直连数据库，也不 import 任何 `server/` 模块。
// 直连数据库会在本机触发一次完整 bootstrap 并把进程打死（schema 迁移链不欢迎第二个写入者）。
//
// 幂等：脚本**可重复运行**。每一步先按业务键探测既有事实，已存在则跳过该步并复用其 id；
// 主数据重复创建返回 409 时脚本把它当作「已存在」处理并改为查询既有记录，而不是中断。
//
// 口令**从环境变量读**，脚本与仓库都不保存任何口令：
//   ERP_SEED_BASE_URL   目标站点（默认 http://127.0.0.1:3001）
//   ERP_SEED_USERNAME   登录用户名（默认 admin）
//   ERP_SEED_PASSWORD   登录口令（**无默认值**，缺失即报错退出）
//
// 用法：
//   ERP_SEED_PASSWORD='...' node scripts/acceptance/customer-env-seed.mjs
//   ERP_SEED_PASSWORD='...' node scripts/acceptance/customer-env-seed.mjs --dry-run
//
// 前提：目标库必须是**干净库**（客户环境已于 2026-11-18 清库重播种）。带演示种子的库
// 本身就有 268 分的 `INVENTORY_QUANTITY_VS_VALUATION` 失配（演示货品有数量、无估值流水），
// 与本脚本无关；脚本在末尾如实打印权威结账，不隐藏这类既有失配。
//
// 退出码：0 = 全部步骤完成且权威结账 FAILING=0；1 = 有步骤失败或权威结账未归零。

import process from 'node:process';

const BASE_URL = (process.env.ERP_SEED_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const USERNAME = process.env.ERP_SEED_USERNAME || 'admin';
const PASSWORD = process.env.ERP_SEED_PASSWORD || '';
const DRY_RUN = process.argv.includes('--dry-run');

// 播种的业务键（幂等锚点）。改动它们等于换一批演示数据。
const CODES = {
  warehouseRaw: 'SEED-WH-RAW',
  warehouseWip: 'SEED-WH-WIP',
  productRaw: 'SEED-P-RAW',
  productVmi: 'SEED-P-VMI',
  productFg: 'SEED-P-FG',
  supplier: 'SEED-SUP-OUT',
};
// VMI 协议单价（分/件）。**VMI 货品的期初成本必须与它相同**：移动加权池的平均单价一旦
// 与协议单价不同，消耗腿的「价值流水按池均价」与「总账按协议单价」就会错位
// （`INVENTORY_VALUE_TO_GL` 出现差额）。客户环境实测用的是同一价。
const VMI_PRICE_CENTS = 1000;
const VMI_RECEIVE_QTY = 20;
const VMI_CONSUME_QTY = 5;
// 组装链的原材料：期初成本 2000 分/件，与 VMI 货品分开，避免两个价混入同一移动加权池。
const RAW_UNIT_COST_CENTS = 2000;
const OPENING_QTY = 1000;

const isoDate = (offsetDays = 0) => {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return value.toISOString().slice(0, 10);
};

let token = null;
const steps = [];
let failures = 0;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function record(name, status, detail) {
  steps.push({ name, status, detail });
  log(`  [${status.padEnd(4)}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function ok(name, detail) {
  record(name, 'OK', detail);
}

function skip(name, detail) {
  record(name, 'SKIP', detail);
}

function fail(name, detail) {
  failures += 1;
  record(name, 'FAIL', detail);
}

/** 一次 HTTP 调用。返回 { status, data }；网络错误以 status 0 返回并带 error。 */
async function call(method, path, body, options = {}) {
  const headers = {};
  if (token && !options.anonymous) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return { status: 0, data: { error: `网络错误：${error.message}` } };
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: response.status, data };
}

/**
 * 执行一步。失败即登记 FAIL 并返回 null —— 脚本**不中断**：后续步骤可能仍能跑通，
 * 而末尾的权威结账汇总会把整体状态说清楚。
 */
async function step(name, fn) {
  if (DRY_RUN) {
    log(`  [DRY ] ${name}`);
    return null;
  }
  try {
    const detail = await fn();
    if (detail === undefined) ok(name, '');
    else if (typeof detail === 'string') ok(name, detail);
    else ok(name, detail.note || '');
    return detail;
  } catch (error) {
    fail(name, error.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 主数据：按业务键探测 + 幂等创建
// ---------------------------------------------------------------------------

/** 从列表结果里按 code 找既有记录。 */
async function findByCode(path, code, extract) {
  const result = await call('GET', path);
  if (result.status !== 200) return null;
  const rows = extract(result.data);
  if (!Array.isArray(rows)) return null;
  return rows.find((row) => row.code === code) || null;
}

/**
 * 创建主数据；已存在（409 或查询命中）则复用。
 * 返回 { id, created }。
 */
async function ensureMasterData({ label, listPath, code, createPath, body, extract }) {
  const existing = await findByCode(listPath, code, extract);
  if (existing) {
    skip(`${label}（已存在）`, `${code} → ${existing.id}`);
    return { id: existing.id, created: false };
  }
  const created = await call('POST', createPath, body);
  if (created.status === 201 && created.data.id) {
    ok(`${label}（新建）`, `${code} → ${created.data.id}`);
    return { id: created.data.id, created: true };
  }
  if (created.status === 409) {
    // 并发或历史数据：重建一次查询再取。
    const again = await findByCode(listPath, code, extract);
    if (again) {
      skip(`${label}（已存在）`, `${code} → ${again.id}`);
      return { id: again.id, created: false };
    }
  }
  throw new Error(`${label} 失败：HTTP ${created.status} ${created.data.error || JSON.stringify(created.data)}`);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  if (!PASSWORD) {
    log('缺少 ERP_SEED_PASSWORD 环境变量（脚本与仓库都不保存口令）。');
    log('用法：ERP_SEED_PASSWORD=\'...\' node scripts/acceptance/customer-env-seed.mjs');
    process.exit(1);
  }

  log(`客户环境播种 → ${BASE_URL}（用户 ${USERNAME}${DRY_RUN ? '，dry-run' : ''}）`);

  const login = await call('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD }, { anonymous: true });
  if (login.status !== 200 || !login.data.token) {
    log(`登录失败：HTTP ${login.status} ${login.data.error || ''}`);
    process.exit(1);
  }
  token = login.data.token;
  log('登录成功 ✓\n');

  // -- 1. 主数据：2 仓库 / 3 货品 / 1 委外供应商 ------------------------------
  log('1. 主数据');
  const rawWarehouse = await step('仓库（原材料）', () => ensureMasterData({
    label: '仓库（原材料）',
    listPath: '/api/warehouses',
    code: CODES.warehouseRaw,
    createPath: '/api/warehouses',
    body: { code: CODES.warehouseRaw, name: '原材料仓（播种）' },
    extract: (data) => data.warehouses || [],
  }));
  const wipWarehouse = await step('仓库（委外 WIP）', () => ensureMasterData({
    label: '仓库（委外 WIP）',
    listPath: '/api/warehouses',
    code: CODES.warehouseWip,
    createPath: '/api/warehouses',
    body: { code: CODES.warehouseWip, name: '委外 WIP 仓（播种）' },
    extract: (data) => data.warehouses || [],
  }));
  const rawProduct = await step('货品（原材料 / 组装组件）', () => ensureMasterData({
    label: '货品（原材料 / 组装组件）',
    listPath: '/api/products',
    code: CODES.productRaw,
    createPath: '/api/products',
    body: {
      code: CODES.productRaw, name: '原材料（播种）', unit: 'EA', priceCents: RAW_UNIT_COST_CENTS,
      standardManufacturingCostCents: RAW_UNIT_COST_CENTS,
      inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'NONE',
    },
    extract: (data) => data.products || [],
  }));
  const vmiProduct = await step('货品（VMI）', () => ensureMasterData({
    label: '货品（VMI）',
    listPath: '/api/products',
    code: CODES.productVmi,
    createPath: '/api/products',
    body: {
      code: CODES.productVmi, name: 'VMI 货品（播种）', unit: 'EA', priceCents: VMI_PRICE_CENTS,
      standardManufacturingCostCents: VMI_PRICE_CENTS,
      inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'NONE',
    },
    extract: (data) => data.products || [],
  }));
  const fgProduct = await step('货品（组装成品 / 委外成品）', () => ensureMasterData({
    label: '货品（组装成品 / 委外成品）',
    listPath: '/api/products',
    code: CODES.productFg,
    createPath: '/api/products',
    body: {
      code: CODES.productFg, name: '组装成品（播种）', unit: 'EA', priceCents: 5000,
      standardManufacturingCostCents: RAW_UNIT_COST_CENTS,
      inventoryClassification: 'FINISHED_GOOD', trackingPolicy: 'NONE',
    },
    extract: (data) => data.products || [],
  }));
  const supplier = await step('供应商（委外 + VMI）', () => ensureMasterData({
    label: '供应商（委外 + VMI）',
    listPath: '/api/suppliers',
    code: CODES.supplier,
    createPath: '/api/suppliers',
    body: {
      code: CODES.supplier, name: '委外供应商（播种）', contact: '播种联系人',
      phone: '13800000000', address: '播种地址', paymentTermsDays: 30,
    },
    extract: (data) => data.suppliers || [],
  }));

  const ids = {
    rawWarehouseId: rawWarehouse && rawWarehouse.id,
    wipWarehouseId: wipWarehouse && wipWarehouse.id,
    rawProductId: rawProduct && rawProduct.id,
    vmiProductId: vmiProduct && vmiProduct.id,
    fgProductId: fgProduct && fgProduct.id,
    supplierId: supplier && supplier.id,
  };
  const missing = Object.entries(ids).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    log(`\n主数据不完整（缺 ${missing.join(', ')}），终止（不猜 id）。`);
    process.exit(1);
  }

  // -- 2. 供应商资质（委外 + VMI 都需要） ------------------------------------
  log('\n2. 供应商资质');
  await step('供应商资质（委外 + VMI + 委外 WIP 仓）', async () => {
    const result = await call('PATCH', `/api/suppliers/${ids.supplierId}/profile`, {
      procurementEnabled: true,
      outsourcingEnabled: true,
      category: 'OUTSOURCE',
      qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30),
      qualificationValidTo: isoDate(180),
      supplierWipWarehouseId: ids.wipWarehouseId,
    });
    if (result.status !== 200) throw new Error(`HTTP ${result.status} ${result.data.error || ''}`);
    return `资质合格（${ids.supplierId}）`;
  });

  // -- 3. OUTSOURCE 货源 + 组装 BOM ------------------------------------------
  log('\n3. 货源与 BOM');
  await step('OUTSOURCE 货源（委外成品 ↔ 委外供应商）', async () => {
    // OUT-02：委外订单创建时校验的是**被委外货品**的货源，不是组件的货源。
    // 货源条目是「版本化」事实：重复创建会关闭旧条目并开新版本（不是重复数据，
    // 但会让脚本重复运行时多出一条版本）。因此先查既有有效条目，存在即跳过。
    const list = await call('GET', `/api/procurement/source-entries?supplierId=${ids.supplierId}&productId=${ids.fgProductId}&sourceType=OUTSOURCE`);
    const rows = (list.data && (list.data.sourceEntries || list.data.entries || list.data.rows)) || [];
    const existing = rows.find((row) => String(row.sourceType || '').toUpperCase() === 'OUTSOURCE');
    if (existing) return `已存在（${existing.id}），按幂等跳过`;
    const result = await call('POST', '/api/procurement/source-entries', {
      supplierId: ids.supplierId, productId: ids.fgProductId,
      sourceType: 'OUTSOURCE', effectiveFrom: isoDate(-30),
    });
    if (result.status === 201) return `已建立（${result.data.id}）`;
    if (result.status === 409) return '已存在（409），按幂等跳过';
    throw new Error(`HTTP ${result.status} ${result.data.error || ''}`);
  });

  await step('组装 BOM（成品 ← 原材料）', async () => {
    const result = await call('POST', '/api/engineering/boms', {
      productId: ids.fgProductId,
      version: '1.0',
      purpose: 'SELF_MAKE',
      remark: '播种用组装 BOM',
      effectiveFrom: isoDate(-30),
      approvalStatus: 'APPROVED',
      items: [{ productId: ids.rawProductId, quantity: 1 }],
    });
    if (result.status === 201) return `已建立（${result.data.id}）`;
    if (result.status === 409) return '已存在（409），按幂等跳过';
    throw new Error(`HTTP ${result.status} ${result.data.error || ''}`);
  });

  const outsourceBomId = await step('委外 BOM（成品 ← 原材料）', async () => {
    // 版本号必须与组装 BOM 不同：`boms` 对 (product_id, version) 唯一。
    const result = await call('POST', '/api/engineering/boms', {
      productId: ids.fgProductId,
      version: '1.1',
      purpose: 'OUTSOURCE',
      remark: '播种用委外 BOM',
      effectiveFrom: isoDate(-30),
      approvalStatus: 'APPROVED',
      items: [{ productId: ids.rawProductId, quantity: 1 }],
    });
    if (result.status === 201) return { id: result.data.id, note: `已建立（${result.data.id}）` };
    if (result.status === 409) {
      // 已存在：按产品 + 用途查回既有 BOM（委外订单必须绑定它）。
      const list = await call('GET', `/api/engineering/boms?product=${ids.fgProductId}&purpose=OUTSOURCE`);
      const rows = (list.data && (list.data.boms || list.data.rows)) || [];
      const found = rows.find((row) => String(row.purpose || '').toUpperCase() === 'OUTSOURCE');
      if (found) return { id: found.id, note: `已存在（${found.id}），按幂等跳过` };
      return { id: null, note: '已存在（409），但未查回既有 BOM id' };
    }
    throw new Error(`HTTP ${result.status} ${result.data.error || ''}`);
  });

  // -- 4. 期初库存（走应用自己的期初接口） ----------------------------------
  log('\n4. 期初库存');
  const openingState = await step('期初初始化状态', async () => {
    const result = await call('GET', '/api/inventory-initialization');
    if (result.status !== 200) throw new Error(`HTTP ${result.status} ${result.data.error || ''}`);
    const status = result.data.initialization && result.data.initialization.status;
    return status || 'NOT_STARTED';
  });
  if (openingState === 'CLOSED') {
    await step('重开期初初始化', async () => {
      const result = await call('POST', '/api/inventory-initialization/reopen', { reason: '客户环境播种' });
      if (result.status !== 200) throw new Error(`HTTP ${result.status} ${result.data.error || ''}`);
      return '已重开为 OPEN';
    });
  } else if (openingState !== 'OPEN') {
    await step('开启期初初始化', async () => {
      const result = await call('POST', '/api/inventory-initialization/open', {});
      if (result.status !== 200) throw new Error(`HTTP ${result.status} ${result.data.error || ''}`);
      return '已开启为 OPEN';
    });
  }

  /**
   * 建一张已确认的期初单。期初行必须带**成本单价**，否则该腿永远停在未估值状态
   * （Requirement §33.3 / F-02）。
   */
  async function seedOpening(productId, quantity, unitCostCents, marker) {
    const list = await call('GET', '/api/inventory/opening-documents');
    const documents = (list.data && list.data.openingDocuments) || [];
    const existing = documents.find((doc) => doc.status === 'CONFIRMED' && (doc.items || []).some(
      (item) => item.productId === productId && item.warehouseId === ids.rawWarehouseId,
    ));
    if (existing) return `已存在已确认期初单 ${existing.docNo}，跳过`;
    const created = await call('POST', '/api/inventory/opening-documents', {
      businessDate: isoDate(-1),
      notes: marker,
      items: [{
        productId,
        warehouseId: ids.rawWarehouseId,
        quantity,
        unitCostCents,
        ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE',
      }],
    });
    if (created.status !== 201) throw new Error(`HTTP ${created.status} ${created.data.error || ''}`);
    const confirmed = await call('POST', `/api/inventory/opening-documents/${created.data.id}/confirm`, {});
    if (confirmed.status !== 200) throw new Error(`确认失败：HTTP ${confirmed.status} ${confirmed.data.error || ''}`);
    return `已建立并确认 ${created.data.docNo}（${quantity} 件 @ ${unitCostCents} 分）`;
  }

  await step('期初单（原材料 1000 件 @ 2000 分）', () => seedOpening(
    ids.rawProductId, OPENING_QTY, RAW_UNIT_COST_CENTS, '客户环境播种期初（原材料）',
  ));
  await step('期初单（VMI 货品 100 件 @ 协议单价）', () => seedOpening(
    ids.vmiProductId, 100, VMI_PRICE_CENTS, '客户环境播种期初（VMI 货品）',
  ));

  // -- 5. 委外订单（下达 + 发料） --------------------------------------------
  log('\n5. 委外订单');
  await step('委外订单（下达 + 发料）', async () => {
    const list = await call('GET', '/api/procurement/outsourcing/orders');
    const orders = (list.data && (list.data.outsourcingOrders || list.data.orders || list.data.rows)) || [];
    // 列表读模型不暴露 remark，因此幂等锚点用「供应商 + 成品 + 业务日期 + 数量」这一
    // 组业务键，而不是客户端自填的备注。
    const existing = orders.find((order) => order.supplierId === ids.supplierId
      && order.productId === ids.fgProductId
      && order.businessDate === isoDate(0)
      && Number(order.orderQuantity) === 10);
    if (existing && existing.status === 'RELEASED') {
      return `已下达（${existing.orderNo || existing.id}），按幂等跳过`;
    }
    const created = await call('POST', '/api/procurement/outsourcing/orders', {
      supplierId: ids.supplierId,
      productId: ids.fgProductId,
      orderQuantity: 10,
      unit: 'EA',
      businessDate: isoDate(0),
      remark: '客户环境播种委外订单',
      // 委外订单必须绑定**已批准的 OUTSOURCE BOM**（委外基础 BOM 校验）。
      ...(outsourceBomId && outsourceBomId.id ? { bomId: outsourceBomId.id } : {}),
    });
    if (created.status !== 201) throw new Error(`创建失败：HTTP ${created.status} ${created.data.error || ''}`);
    const orderId = created.data.id;

    // 用料快照 → CONFIRM_PLAN → RELEASE → 发料。
    const snapshot = await call('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, {
      items: [{ productId: ids.rawProductId, sourceWarehouseId: ids.rawWarehouseId }],
    });
    if (snapshot.status !== 200) throw new Error(`用料快照失败：HTTP ${snapshot.status} ${snapshot.data.error || ''}`);
    const materials = (snapshot.data && (snapshot.data.materials || snapshot.data.materialList)) || [];
    const materialListId = materials[0] && (materials[0].id || materials[0].materialListId);

    const confirmPlan = await call('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, { action: 'CONFIRM_PLAN' });
    if (confirmPlan.status !== 200) throw new Error(`CONFIRM_PLAN 失败：HTTP ${confirmPlan.status} ${confirmPlan.data.error || ''}`);
    const release = await call('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, { action: 'RELEASE' });
    if (release.status !== 200) throw new Error(`RELEASE 失败：HTTP ${release.status} ${release.data.error || ''}`);

    if (materialListId) {
      const issue = await call('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, {
        materialListId, quantity: 10, issuedDate: isoDate(0), idempotencyKey: `seed-issue-${orderId}`,
      });
      if (issue.status !== 201 && issue.status !== 200) {
        throw new Error(`发料失败：HTTP ${issue.status} ${issue.data.error || ''}`);
      }
    }
    return `已下达并发料（${created.data.orderNo || orderId}）`;
  });

  // -- 6. 组装单（确认） ----------------------------------------------------
  log('\n6. 组装单');
  await step('组装单（确认）', async () => {
    const list = await call('GET', '/api/inventory/assembly-orders');
    const docs = (list.data && (list.data.assemblyOrders || list.data.orders || list.data.rows || list.data.documents)) || [];
    const existing = docs.find((doc) => doc.remark === '客户环境播种组装单');
    if (existing && existing.status === 'CONFIRMED') return `已确认（${existing.docNo || existing.id}），跳过`;
    const created = await call('POST', '/api/inventory/assembly-orders', {
      warehouseId: ids.rawWarehouseId,
      productId: ids.fgProductId,
      quantity: 5,
      businessDate: isoDate(0),
      remark: '客户环境播种组装单',
    });
    if (created.status !== 201) throw new Error(`创建失败：HTTP ${created.status} ${created.data.error || ''}`);
    const confirmed = await call('POST', `/api/inventory/assembly-orders/${created.data.id}/confirm`, {});
    if (confirmed.status !== 200) throw new Error(`确认失败：HTTP ${confirmed.status} ${confirmed.data.error || ''}`);
    return `已确认 ${created.data.docNo || created.data.id}`;
  });

  // -- 7. VMI 结算链 ---------------------------------------------------------
  log('\n7. VMI 结算链');
  const vmiAgreementId = await step('VMI 协议（协议单价 1000 分/件）', async () => {
    const list = await call('GET', '/api/procurement/vmi/agreements');
    const agreements = (list.data && list.data.agreements) || [];
    const existing = agreements.find((agreement) => agreement.productId === ids.vmiProductId);
    if (existing) return { id: existing.id, note: `已存在（${existing.id}），跳过` };
    const created = await call('POST', '/api/procurement/vmi/agreements', {
      supplierId: ids.supplierId,
      warehouseId: ids.rawWarehouseId,
      productId: ids.vmiProductId,
      minStock: 10,
      maxStock: 100,
      reorderLevel: 20,
      effectiveFrom: isoDate(-10),
      unitPriceCents: VMI_PRICE_CENTS,
    });
    if (created.status !== 201) throw new Error(`HTTP ${created.status} ${created.data.error || ''}`);
    return { id: created.data.id, note: `已建立（${created.data.id}）` };
  });

  let vmiReceiptId = null;
  await step('VMI 收货（20 件）并确认', async () => {
    const receipt = await call('POST', '/api/procurement/vmi/receipts', {
      supplierId: ids.supplierId,
      warehouseId: ids.rawWarehouseId,
      productId: ids.vmiProductId,
      quantity: VMI_RECEIVE_QTY,
      receivedDate: isoDate(0),
      idempotencyKey: 'seed-vmi-receipt-1',
    });
    if (receipt.status !== 201) throw new Error(`HTTP ${receipt.status} ${receipt.data.error || ''}`);
    vmiReceiptId = receipt.data.id;
    // 幂等键重放会返回**同一张**收货单；若它已被确认，确认会 409（「只有待确认状态
    // 可以确认」）。因此确认失败且报文指向该状态时，视为「已确认」而不是失败。
    const confirmed = await call('POST', `/api/procurement/vmi/receipts/${vmiReceiptId}/confirm`, {});
    if (confirmed.status === 200) return `已确认（${receipt.data.receiptNo || vmiReceiptId}）`;
    if (confirmed.status === 409 && /待确认/.test(String(confirmed.data.error || ''))) {
      return `已存在且已确认（${receipt.data.receiptNo || vmiReceiptId}），按幂等跳过`;
    }
    throw new Error(`确认失败：HTTP ${confirmed.status} ${confirmed.data.error || ''}`);
  });

  await step('VMI 消耗（5 件）', async () => {
    if (!vmiReceiptId) throw new Error('没有可消耗的 VMI 收货');
    const consumption = await call('POST', '/api/procurement/vmi/consumptions', {
      vmiReceiptId,
      quantity: VMI_CONSUME_QTY,
      consumedDate: isoDate(0),
      destination: 'PRODUCTION',
      idempotencyKey: 'seed-vmi-consumption-1',
    });
    if (consumption.status !== 201) throw new Error(`HTTP ${consumption.status} ${consumption.data.error || ''}`);
    return `已建立（${consumption.data.id}）`;
  });

  const periodId = await step('VMI 结算期（开启 → 关闭）', async () => {
    const periodKey = `SEED-${isoDate(0).slice(0, 7)}`;
    const opened = await call('POST', '/api/procurement/vmi/settlement-periods', {
      agreementId: vmiAgreementId.id, periodKey, windowKind: 'CUSTOM',
      windowStart: isoDate(0), windowEnd: isoDate(0),
    });
    if (opened.status !== 201) throw new Error(`开期失败：HTTP ${opened.status} ${opened.data.error || ''}`);
    const id = opened.data.id;
    // 开期按确定性业务键幂等；重放会返回**同一个**结算期。若它已关闭，关期会 409。
    const read = await call('GET', `/api/procurement/vmi/settlement-periods/${id}`);
    const status = read.data && read.data.period && read.data.period.status;
    if (status === 'CLOSED') return { id, note: `已关闭（${id}），按幂等跳过` };
    const closed = await call('POST', `/api/procurement/vmi/settlement-periods/${id}/close`, {});
    if (closed.status !== 200) {
      throw new Error(`关期失败：HTTP ${closed.status} ${closed.data.error || ''}（容差严格 0，五组恒等式必须成立）`);
    }
    return { id, note: `已开启并关闭（${id}）` };
  });

  await step('VMI 结算账单（生成 → 过账）', async () => {
    if (!periodId) throw new Error('没有已关闭的结算期');
    const bill = await call('POST', `/api/procurement/vmi/settlement-periods/${periodId.id}/bills`, {});
    if (bill.status === 201) return `已过账 ${bill.data.billNo}（grossCents=${bill.data.grossCents}）`;
    // 幂等键重放：返回同一张账单。
    if (bill.status === 201 || bill.data.replayed) {
      return `已存在（${bill.data.billNo || bill.data.id}），按幂等跳过`;
    }
    if (bill.status === 409 && /已生成结算账单/.test(String(bill.data.error || ''))) {
      return '该结算期已生成结算账单，按幂等跳过';
    }
    throw new Error(`生成失败：HTTP ${bill.status} ${bill.data.error || ''}`);
  });

  await step('VMI 读模型', async () => {
    const summary = await call('GET', `/api/procurement/vmi/summary/${ids.supplierId}`);
    if (summary.status !== 200) throw new Error(`HTTP ${summary.status} ${summary.data.error || ''}`);
    const rows = (summary.data && summary.data.summary) || [];
    const row = rows.find((item) => item.productId === ids.vmiProductId);
    if (!row) return '汇总里没有该货品的行';
    return `received ${row.received} / consumed ${row.consumed} / grossRemaining ${row.grossRemaining} / ${row.reconciliationStatus} / billableQuantity ${row.billableQuantity} / billable ${row.billable}`;
  });

  // -- 8. 权威结账汇总 -------------------------------------------------------
  log('\n8. 权威结账');
  const health = await call('GET', '/api/system-health');
  if (health.status !== 200) {
    fail('权威结账', `HTTP ${health.status} ${health.data.error || ''}`);
  } else {
    const checks = (health.data && health.data.checks) || [];
    const blocking = checks.filter((row) => String(row.severity || '').toUpperCase() === 'BLOCKING');
    const failing = blocking.filter((row) => String(row.status || '').toUpperCase() !== 'PASS');
    log(`  BLOCKING 检查 ${blocking.length} 项；FAILING = ${failing.length}`);
    for (const row of blocking) {
      const difference = row.difference !== undefined ? `difference=${row.difference}` : '';
      log(`    ${String(row.status).toUpperCase().padEnd(4)} ${row.code} ${difference}`);
    }
    if (failing.length) {
      fail('权威结账 FAILING=0', `${failing.length} 项未通过：${failing.map((row) => row.code).join(', ')}`);
    } else {
      ok('权威结账 FAILING=0', `BLOCKING ${blocking.length} 项全部 PASS`);
    }
  }

  // -- 9. 汇总 ---------------------------------------------------------------
  const passed = steps.filter((s) => s.status === 'OK').length;
  const skipped = steps.filter((s) => s.status === 'SKIP').length;
  log(`\n汇总：OK ${passed} / SKIP ${skipped} / FAIL ${failures}`);
  log(`委外供应商：${ids.supplierId}`);
  log(`原材料仓：${ids.rawWarehouseId}；委外 WIP 仓：${ids.wipWarehouseId}`);
  if (failures) {
    log('\n有步骤失败 —— 请检查上面的 FAIL 行。');
    process.exit(1);
  }
  log('\n播种完成 ✓');
}

main().catch((error) => {
  log(`播种异常终止：${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
