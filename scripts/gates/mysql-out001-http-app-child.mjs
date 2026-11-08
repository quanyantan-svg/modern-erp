#!/usr/bin/env node

// M2 fixture: one process owns exactly one HTTP server and one MySQL adapter.
// It never bootstraps or cleans the schema; the protected Root owns those
// operations. The parent receives only the loopback URL and test login tokens.

import { createProcurementFixture } from '../../server/test-support/procurement-http-fixture.js';

let fixture;
try {
  fixture = await createProcurementFixture(`modern-erp-out001-app-${process.pid}-`);
  process.send?.({ type: 'READY', baseUrl: fixture.baseUrl, tokens: fixture.tokens, pid: process.pid });
} catch (error) {
  process.send?.({ type: 'ERROR', message: error?.message || String(error) });
  throw error;
}

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try { await fixture?.close(); } finally { process.exit(0); }
}

process.on('message', (message) => {
  if (message?.type === 'STOP') void close();
});
process.on('disconnect', () => void close());
