import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db.js';
import { ensureCreditLockAnchor } from '../modules/credit-anchor.js';

const db = new DatabaseSync(workerData.dbPath);
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
try {
  let anchor;
  transaction(db, () => {
    anchor = ensureCreditLockAnchor(db, workerData.shape);
  });
  parentPort.postMessage({ id: anchor.id, anchorKey: anchor.anchor_key });
} catch (error) {
  parentPort.postMessage({ error: error?.stack || String(error) });
} finally {
  db.close();
}
