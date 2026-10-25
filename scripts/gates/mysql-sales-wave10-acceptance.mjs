import { WAVE10_MYSQL_SUITES } from './mysql-sales-wave10-manifest.mjs';
import { runProtectedMySqlCampaign } from './mysql-wave10-runner-support.mjs';

await runProtectedMySqlCampaign({
  campaign: 'WAVE 10 MYSQL ACCEPTANCE',
  suites: WAVE10_MYSQL_SUITES,
});
