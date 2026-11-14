import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { createStructuredLogger } from './lib/logger.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = String(process.env.ERP_DB_BACKEND || 'sqlite').toLowerCase();
const dataDir = join(root, 'data');
// Only the SQLite backend needs the local data directory. Creating it
// unconditionally crashed the process on a read-only release directory
// (the production layout keeps the release under /opt and the data under
// /var/lib), because the service account cannot mkdir there.
if (backend === 'sqlite') {
  const sqlitePath = process.env.ERP_DB_PATH || join(dataDir, 'erp.db');
  const sqliteDir = dirname(resolve(sqlitePath));
  if (!existsSync(sqliteDir)) mkdirSync(sqliteDir, { recursive: true });
}
const db = backend === 'sqlite'
  ? createDatabase(process.env.ERP_DB_PATH || join(dataDir, 'erp.db'))
  : createDatabase();
const port = Number(process.env.PORT || 3001);
const host = String(process.env.HOST || '127.0.0.1');
const logger = createStructuredLogger();
const server = createServer(createApp(db, { distDir: join(root, 'dist'), logger }));

server.on('error', (error) => {
  logger.error('server_error', { category: error?.code || error?.name || 'Error', message: error?.message || String(error) });
  process.exit(1);
});

server.listen(port, host, () => {
  logger.info('server_started', { host, port, backend });
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
