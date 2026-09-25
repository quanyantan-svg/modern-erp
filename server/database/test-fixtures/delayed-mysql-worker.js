import { parentPort } from 'node:worker_threads';
import { encodeWorkerResponse } from '../mysql-worker-protocol.js';

parentPort.on('message', async ({ action, payload, shared, requestId }) => {
  if (action === 'connect') {
    encodeWorkerResponse(shared, requestId, { connected: true });
    return;
  }
  if (action === 'close') {
    encodeWorkerResponse(shared, requestId, { closed: true });
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, payload.params[0]));
  encodeWorkerResponse(shared, requestId, { rows: [{ request: payload.sql }] });
});
