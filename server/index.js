import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const db = createDatabase(process.env.ERP_DB_PATH || join(dataDir, 'erp.db'));
const port = Number(process.env.PORT || 3001);
const server = createServer(createApp(db, { distDir: join(root, 'dist') }));

server.listen(port, '127.0.0.1', () => {
  console.log(`Modern ERP 已启动：http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
