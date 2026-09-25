import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const children = [
  spawn(process.execPath, ['--watch', resolve(repoRoot, 'server/index.js')], { cwd: repoRoot, stdio: 'inherit' }),
  spawn(process.execPath, [resolve(repoRoot, 'node_modules/vite/bin/vite.js')], { cwd: repoRoot, stdio: 'inherit' })
];

function stop() {
  for (const child of children) child.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await Promise.race(children.map((child) => new Promise((resolve) => child.on('exit', resolve))));
stop();
