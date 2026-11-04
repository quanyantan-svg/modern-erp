import { readFileSync } from 'node:fs';
import { resolveDatabaseConfig } from '../database/config.js';
import { MySqlSyncAdapter } from '../database/mysql-adapter.js';
import { readWave10ConnectedIdentity } from './mysql-wave10-campaign-target.js';

/**
 * Opens the already-bootstrapped disposable schema without running bootstrap,
 * schema reconciliation or migration. The returned session is identity-pinned
 * to the preflight target proof.
 */
export function openM1CoreG07ExistingAdapter({ targetProofPath }) {
  const config = resolveDatabaseConfig({ backend: 'mysql' });
  const target = JSON.parse(readFileSync(targetProofPath, 'utf8'));
  for (const key of ['host', 'port', 'database', 'user']) {
    if (String(config[key]) !== String(target[key])) throw new Error(`M1_G07_CHILD_TARGET_CONFIG_DRIFT:${key}`);
  }
  const db = new MySqlSyncAdapter(config);
  try {
    const actual = readWave10ConnectedIdentity(db);
    if (actual.database !== target.selectedDatabase || actual.currentUser !== target.currentUser
      || actual.serverUuid !== target.serverUuid || actual.grantDigest.toLowerCase() !== target.grantsSha256.toLowerCase()) {
      throw new Error('M1_G07_CHILD_CONNECTED_TARGET_DRIFT');
    }
    return { db, config, target };
  } catch (error) {
    db.close();
    throw error;
  }
}
