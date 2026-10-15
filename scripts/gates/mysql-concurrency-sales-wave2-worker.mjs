import { createInterface } from 'node:readline';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { readTransaction } from '../../server/db.js';
import { updateCustomerCommercialExtension } from '../../server/modules/sales-commercial-foundation.js';
import { activatePriceList, appendPriceVersion, resolveSalesPrice, retirePriceList } from '../../server/modules/sales-pricing.js';

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);
const actor = { id: '00000000-0000-4000-8000-000000000001', permissions: ['SALES_PRICING_VIEW', 'SALES_PRICING_MANAGE', 'SALES_COMMERCIAL_MANAGE'] };

function connectionId() { return Number(db.prepare('SELECT CONNECTION_ID() id').get().id); }
function request(body, key) {
  return { headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body ?? {})); } };
}
function response() {
  return { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; } };
}
async function invoke(fn) {
  const res = response();
  try {
    await fn(res);
    return { status: res.statusCode, body: res.body, connectionId: connectionId(), processId: process.pid };
  } catch (error) {
    return { status: error.status || 500, code: error.code, message: error.message,
      transactionRetryExhausted: Boolean(error.transactionRetryExhausted), connectionId: connectionId(), processId: process.pid };
  }
}

async function execute(command) {
  if (command.action === 'register') return { dialect: db.dialect, connectionId: connectionId(), processId: process.pid };
  if (command.action === 'resolve-price-delay') {
    return invoke(async (res) => {
      const pricing = readTransaction(db, () => {
        const result = resolveSalesPrice(db, command.body, actor);
        db.prepare('SELECT SLEEP(?) slept').get(command.delaySeconds ?? 2);
        return result;
      });
      res.statusCode = 200;
      res.body = { pricing };
    });
  }
  if (command.action === 'resolve-price') {
    return invoke(async (res) => {
      res.statusCode = 200;
      res.body = { pricing: readTransaction(db, () => resolveSalesPrice(db, command.body, actor)) };
    });
  }
  if (command.action === 'append-price-version') return invoke((res) => appendPriceVersion(db, request(command.body), res, actor, command.listId, command.entryId));
  if (command.action === 'activate-price-list') return invoke((res) => activatePriceList(db, request({}, command.key), res, actor, command.listId));
  if (command.action === 'retire-price-list') return invoke((res) => retirePriceList(db, request({}, command.key), res, actor, command.listId));
  if (command.action === 'update-customer-default') return invoke((res) => updateCustomerCommercialExtension(db, request(command.body), res, actor, command.versionId));
  if (command.action === 'close') { db.close(); return { closed: true }; }
  throw new Error(`Unknown action: ${command.action}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async (line) => {
  let envelope;
  try {
    envelope = JSON.parse(line);
    const result = await execute(envelope.command);
    process.stdout.write(`${JSON.stringify({ id: envelope.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: envelope?.id, ok: false, error: { message: error.message, code: error.code } })}\n`);
  }
});
lines.on('close', () => { try { db.close(); } catch {} });
