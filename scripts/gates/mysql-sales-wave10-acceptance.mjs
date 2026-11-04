import { WAVE10_MYSQL_SUITES } from './mysql-sales-wave10-manifest.mjs';
import { runProtectedMySqlCampaign } from './mysql-wave10-runner-support.mjs';
import { blockUnmigratedAck4Entry } from './ack4/ack4-runtime.mjs';

blockUnmigratedAck4Entry('mysql-sales-wave10-acceptance.mjs');

await runProtectedMySqlCampaign({
  campaign: 'WAVE 10 MYSQL ACCEPTANCE',
  suites: WAVE10_MYSQL_SUITES,
});
