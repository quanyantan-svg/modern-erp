import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV === 'production') {
  console.error('错误：生产环境禁止执行 reset-data。');
  console.error('如需重置数据，请先关闭服务，使用 backup / restore 流程，或在受控环境手动操作。');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const database = join(root, 'data', 'erp.db');
for (const file of [database, `${database}-shm`, `${database}-wal`]) {
  if (existsSync(file)) rmSync(file);
}
console.log('演示数据已清除；下次启动时会自动重新初始化。');
