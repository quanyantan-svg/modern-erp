import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { createStructuredLogger } from './lib/logger.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const backend = String(process.env.ERP_DB_BACKEND || 'sqlite').toLowerCase();
const db = backend === 'sqlite'
  ? createDatabase(process.env.ERP_DB_PATH || join(dataDir, 'erp.db'))
  : createDatabase();
const port = Number(process.env.PORT || 3001);
const logger = createStructuredLogger();
const server = createServer(createApp(db, { distDir: join(root, 'dist'), logger }));

server.listen(port, '127.0.0.1', () => {
  logger.info('server_started', { host: '127.0.0.1', port, backend });
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
