import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const children = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit' }),
  spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js')], { stdio: 'inherit' })
];

function stop() {
  for (const child of children) child.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await Promise.race(children.map((child) => new Promise((resolve) => child.on('exit', resolve))));
stop();
