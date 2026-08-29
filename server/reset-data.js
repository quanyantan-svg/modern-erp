import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const database = join(root, 'data', 'erp.db');
for (const file of [database, `${database}-shm`, `${database}-wal`]) {
  if (existsSync(file)) rmSync(file);
}
console.log('演示数据已清除；下次启动时会自动重新初始化。');
