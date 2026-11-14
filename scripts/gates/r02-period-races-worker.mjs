#!/usr/bin/env node

// R-02 期间控制真实 MySQL campaign 的竞态 worker。
//
// 一个进程 = 一个独立的 MySQL 会话。每个动作都调用**生产模块的 canonical 入口**
// （库存 mutation dispatcher / 库存关账命令 / 法定关账 handler / 系统凭证 / 经营关账 /
// 经营归集），raw lock 只作为竞态编排手段暴露，绝不作为生产结果证据。
//
// 与其它域 campaign 的 worker **独立实现**：本 worker 的证据链不依赖任何其它 campaign
// 的 worker 行为，夹具动作名也带 R02_PERIOD 前缀。
//
// 协议：
//   stdin  —— 一行 JSON 指令；
//   stdout —— 一行 JSON 结果；
//   闸门   —— worker 先写 `<gate>/ready-<name>`，再等 `<gate>/release` 出现才执行。
//              两个 worker 因此在同一瞬间进入被争用的代码路径，竞态发生在真实的
//              MySQL 8 服务器上，而不是同一个事件循环里的同步调用交错。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { applyInventoryMutation } from '../../server/lib/inventory-mutation.js';
import { closeInventoryPeriodCommand } from '../../server/modules/inventory-period-close.js';
import { closePeriod } from '../../server/modules/accounting-period-control.js';
import { createSystemVoucher, receiveSourceValue } from '../../server/modules/financial-inventory.js';
import { closeOperatingPeriod, collectOperatingLedger } from '../../server/modules/management-accounting.js';

// The worker opens the SAME database the suite opened.
//
// Inside the ACK-4 campaign that is the leased MySQL target. Outside the campaign
// — the offline SQLite validation mode — the suite hands the worker the temporary
// SQLite file through `ERP_R02_RACE_DB_PATH`. The offline mode exists only to
// prove the fixtures and the assertions are self-consistent; it is NEVER
// real-MySQL evidence.
const offlineDbPath = String(process.env.ERP_R02_RACE_DB_PATH || '').trim();
const gateDir = String(process.env.ERP_R02_RACE_GATE_DIR || '').trim();
const workerName = String(process.env.ERP_R02_RACE_WORKER || 'worker').trim();

let db;
if (offlineDbPath) {
  db = new DatabaseSync(offlineDbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 20000;');
} else {
  const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
  db = new MySqlSyncAdapter(mysqlConfig);
}

// Minimal request/response stand-ins for the canonical handlers that read a
// JSON body and answer with a JSON envelope. The handlers themselves are the
// production ones; only the transport is stubbed.
function mockRequest(body) {
  const payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8');
  return {
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield payload; },
  };
}

function mockResponse() {
  return {
    statusCode: 0,
    body: null,
    setHeader() {},
    end(chunk) { this.body = chunk ? String(chunk) : ''; },
  };
}

// The workers act as real operators: the canonical handlers check their own
// permissions, so the actor carries the permissions of the roles the campaign
// exercises (period close, management accounting, accounting view).
const CAMPAIGN_PERMISSIONS = Object.freeze([
  'PERIOD_CLOSE_MANAGE', 'PERIOD_CLOSE_VIEW',
  'MANAGEMENT_ACCOUNTING_MANAGE', 'MANAGEMENT_ACCOUNTING_VIEW',
  'ACCOUNTING_VIEW', 'ACCOUNTING_RECONCILIATION_VIEW',
]);

function actorOf(id) {
  return { id, roleCode: 'ADMIN', permissions: [...CAMPAIGN_PERMISSIONS] };
}

async function readCommand() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) throw new Error('R02_RACE_WORKER_EMPTY_COMMAND');
  return JSON.parse(raw);
}

async function waitForRelease() {
  if (!gateDir) return;
  writeFileSync(join(gateDir, `ready-${workerName}`), new Date().toISOString());
  const releasePath = join(gateDir, 'release');
  const deadline = Date.now() + 30_000;
  while (!existsSync(releasePath)) {
    if (Date.now() >= deadline) throw new Error('R02_RACE_WORKER_GATE_TIMEOUT');
    await delay(10);
  }
}

// The canonical handlers are async: the outcome helper must await them,
// otherwise a rejected promise would be reported as a success.
async function outcomeOf(work) {
  try {
    const value = await work();
    return { ok: true, value: value ?? null };
  } catch (error) {
    return { ok: false, code: error?.code || error?.name || 'ERROR', message: String(error?.message || error) };
  }
}

async function run() {
  const command = await readCommand();
  await waitForRelease();
  let result;
  switch (command.action) {
    // 库存关账：canonical command（server/modules/inventory-period-close.js）。
    case 'inventoryClose': {
      result = { action: command.action, ...(await outcomeOf(() => closeInventoryPeriodCommand(
        db, actorOf(command.actorId), { period: command.period }, { today: command.today },
      ))) };
      break;
    }
    // 库存 mutation：canonical dispatcher（server/lib/inventory-mutation.js）。
    case 'inventoryMutation': {
      result = { action: command.action, ...(await outcomeOf(async () => {
        // The canonical receipt path: the mutation dispatcher writes the
        // physical movement and the valuation primitive writes the matching
        // value. A movement without its valuation would fail the inventory
        // close precheck (quantity / value consistency), so the campaign must
        // use the same pair the production receipt path uses.
        const mutation = applyInventoryMutation({
          db,
          sourceType: command.sourceType || 'OTHER_RECEIPT',
          sourceId: command.sourceId,
          businessDate: command.businessDate,
          actor: actorOf(command.actorId),
          movementKind: command.movementKind || 'IN',
          quantity: Number(command.quantity),
          toPosition: {
            productId: command.productId,
            warehouseId: command.warehouseId,
            ownerType: 'ENTERPRISE',
            stockStatus: 'AVAILABLE',
          },
          idempotencyKey: command.idempotencyKey,
          // The receipt path owns its valuation explicitly (canonical pattern:
          // the dispatcher must not write its own best-effort valuation).
          trackingMode: 'EXTERNAL',
          valuationMode: 'EXTERNAL',
        });
        receiveSourceValue(db, {
          businessDate: command.businessDate,
          productId: command.productId,
          warehouseId: command.warehouseId,
          quantity: Number(command.quantity),
          // A movement without value breaks the inventory close precheck
          // (quantity / value consistency), so the campaign carries the value.
          valueCents: Number(command.valueCents ?? Number(command.quantity) * 1000),
          sourceType: command.sourceType || 'OTHER_RECEIPT',
          sourceId: command.sourceId,
          sourceItemId: command.sourceItemId || command.sourceId,
          movementType: command.sourceType || 'OTHER_RECEIPT',
        });
        // The inventory value must exist on the ledger as well: the inventory
        // close precheck reconciles the inventory value against the inventory
        // GL role, so the campaign's movement carries its GL leg (the same
        // shape the production adjustment path posts).
        const valueCents = Number(command.valueCents ?? Number(command.quantity) * 1000);
        createSystemVoucher(db, {
          sourceType: command.sourceType || 'OTHER_RECEIPT',
          sourceId: command.sourceId,
          businessDate: command.businessDate,
          actorId: command.actorId,
          entries: [
            { role: 'OTHER_INVENTORY', direction: 'DEBIT', amountCents: valueCents, summary: 'R-02 竞态库存入账' },
            { role: 'GRNI', direction: 'CREDIT', amountCents: valueCents, summary: 'R-02 竞态库存入账' },
          ],
        });
        return mutation;
      })) };
      break;
    }
    // 法定关账：canonical handler（server/modules/accounting-period-control.js）。
    case 'legalClose': {
      result = { action: command.action, ...(await outcomeOf(async () => {
        const res = mockResponse();
        await closePeriod(db, mockRequest({}), res, actorOf(command.actorId), command.closureId);
        return { status: res.statusCode };
      })) };
      break;
    }
    // 系统凭证：canonical 写入口（server/modules/financial-inventory.js），内部走
    // canonical 期间守卫（LEGAL_VOUCHER）。
    case 'voucherPost': {
      result = { action: command.action, ...(await outcomeOf(() => createSystemVoucher(db, {
        sourceType: command.sourceType || 'R02_RACE',
        sourceId: command.sourceId,
        businessDate: command.businessDate,
        actorId: command.actorId,
        entries: command.entries,
      }))) };
      break;
    }
    // 经营关账：canonical handler（server/modules/management-accounting.js）。
    case 'operatingClose': {
      result = { action: command.action, ...(await outcomeOf(async () => {
        const res = mockResponse();
        await closeOperatingPeriod(db, mockRequest({ managementBookId: command.managementBookId, period: command.period }), res, actorOf(command.actorId));
        return { status: res.statusCode };
      })) };
      break;
    }
    // 经营归集：canonical handler（server/modules/management-accounting.js）。
    case 'operatingCollect': {
      result = { action: command.action, ...(await outcomeOf(async () => {
        const res = mockResponse();
        await collectOperatingLedger(db, mockRequest({
          managementBookId: command.managementBookId,
          period: command.period,
          source: command.source,
          profitCenterId: command.profitCenterId,
        }), res, actorOf(command.actorId));
        return { status: res.statusCode };
      })) };
      break;
    }
    default:
      throw new Error(`R02_RACE_WORKER_ACTION_INVALID:${command.action}`);
  }
  if (result && typeof result.then === 'function') result = await result;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  await run();
} finally {
  db.close();
}
