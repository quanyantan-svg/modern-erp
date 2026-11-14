#!/usr/bin/env node

// Platform 域真实 MySQL 8 campaign 的竞态 worker。
//
// 一个进程 = 一个独立的 MySQL 会话。每个动作都调用**生产模块**的入口（编号服务 /
// 通知生产者），raw lock 只作为竞态编排手段暴露，绝不作为生产结果证据。
//
// 该 worker 是 `sales-customer-domain-races-worker.mjs` 的**独立实现**：本域 campaign
// 的证据链不依赖任何其它 campaign 的 worker 行为，夹具动作名也带 PLATFORM 前缀。
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
import { allocateDocumentNumber } from '../../server/modules/platform-numbering.js';
import { notifyEvent } from '../../server/modules/platform-notifications.js';

// The worker opens the SAME database the suite opened.
//
// Inside the ACK-4 campaign that is the leased MySQL target. Outside the campaign
// — the offline SQLite validation mode — the suite hands the worker the temporary
// SQLite file through `ERP_PLATFORM_RACE_DB_PATH`. The offline mode exists only
// to prove the fixtures and the assertions are self-consistent; it is NEVER
// real-MySQL evidence.
const offlineDbPath = String(process.env.ERP_PLATFORM_RACE_DB_PATH || '').trim();
const gateDir = String(process.env.ERP_PLATFORM_RACE_GATE_DIR || '').trim();
const workerName = String(process.env.ERP_PLATFORM_RACE_WORKER || 'worker').trim();

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

async function readCommand() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) throw new Error('PLATFORM_RACE_WORKER_EMPTY_COMMAND');
  return JSON.parse(raw);
}

async function waitForRelease() {
  if (!gateDir) return;
  writeFileSync(join(gateDir, `ready-${workerName}`), new Date().toISOString());
  const releasePath = join(gateDir, 'release');
  const deadline = Date.now() + 30_000;
  while (!existsSync(releasePath)) {
    if (Date.now() >= deadline) throw new Error('PLATFORM_RACE_WORKER_GATE_TIMEOUT');
    await delay(10);
  }
}

async function run() {
  const command = await readCommand();
  await waitForRelease();
  let result;
  switch (command.action) {
    case 'allocate': {
      const allocation = allocateDocumentNumber(
        db, command.documentType, command.businessDate, command.idempotencyKey, command.options || {},
      );
      result = { action: command.action, documentNo: allocation.documentNo, replayed: allocation.replayed };
      break;
    }
    case 'notify': {
      const notified = notifyEvent(db, {
        eventType: command.eventType,
        category: command.category,
        recipients: [{ type: 'USER', value: command.recipientId }],
        title: command.title,
        content: command.content || '',
        dedupeKey: command.dedupeKey,
      });
      result = { action: command.action, created: notified.created, skipped: notified.skipped };
      break;
    }
    default:
      throw new Error(`PLATFORM_RACE_WORKER_ACTION_INVALID:${command.action}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  await run();
} finally {
  db.close();
}
