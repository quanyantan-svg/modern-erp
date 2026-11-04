import { assertCompleteG07Contract, M1_CORE_G07_SCENARIOS } from '../../server/test-support/m1-core-g07-contract.js';
import {
  assertFixedFixtureManifest, M1_CORE_G07_FIXED_SCENARIOS, M1_CORE_G07_GOVERNANCE_REVIEW, M1_CORE_G07_SUBJECTS,
  M1_CORE_G07_TECHNICAL_L2_PREREQUISITES,
} from '../../server/test-support/m1-core-g07-fixtures.js';
import { M1_CORE_MANIFEST } from './ack4/ack4-runtime.mjs';

const REQUIRED_ENVIRONMENT = Object.freeze([
  'ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD',
  'ERP_DB_BACKEND', 'ERP_TEST_DB_BACKEND', 'ERP_MYSQL_TEST_DISPOSABLE_TARGET',
  'ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID', 'ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER',
  'ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256',
]);

function assertTarget(target) {
  for (const key of ['host', 'port', 'database', 'user', 'selectedDatabase', 'currentUser', 'serverUuid', 'grantsSha256']) {
    if (target?.[key] === undefined || target?.[key] === null || String(target[key]).trim() === '') throw new Error(`M1_G07_STATIC_TARGET_${key.toUpperCase()}_REQUIRED`);
  }
  if (target.database !== target.selectedDatabase || !/^[0-9a-f]{64}$/.test(target.grantsSha256)) throw new Error('M1_G07_STATIC_TARGET_BINDING_INVALID');
}

export function assertM1CoreG07StaticPreflight({ target, environment = process.env, subjectCredentials }) {
  assertCompleteG07Contract();
  const fixture = assertFixedFixtureManifest();
  if (fixture.scenarioCount !== 9 || M1_CORE_G07_FIXED_SCENARIOS.length !== 9 || M1_CORE_G07_SCENARIOS.length !== 9) throw new Error('M1_G07_STATIC_CR_SET_INVALID');
  for (const scenario of M1_CORE_G07_FIXED_SCENARIOS) {
    for (const request of [...scenario.setup, ...scenario.raceRequests]) {
      if (request.method === 'TECHNICAL_L2') continue;
      if (!request.route.startsWith('/api/') || !['GET', 'POST', 'PUT', 'PATCH'].includes(request.method)) throw new Error(`${scenario.id}_STATIC_ROUTE_INVALID`);
      if (request.method === 'GET' && Object.hasOwn(request, 'body')) throw new Error(`${scenario.id}_STATIC_GET_BODY_FORBIDDEN`);
      if (request.body !== undefined && (typeof request.body !== 'object' || Array.isArray(request.body))) throw new Error(`${scenario.id}_STATIC_BODY_INVALID`);
    }
  }
  const subjects = Object.keys(M1_CORE_G07_SUBJECTS);
  if (!subjectCredentials || subjects.some((subject) => subjectCredentials[subject]?.username !== M1_CORE_G07_SUBJECTS[subject].login)) throw new Error('M1_G07_STATIC_SUBJECT_BINDING_INVALID');
  const l2Ids = M1_CORE_G07_TECHNICAL_L2_PREREQUISITES.map((item) => item.id);
  for (const required of ['DISPOSABLE_TARGET', 'TRANSACTION_GATE_TABLE', 'RBAC_TEST_IDENTITIES', 'M15_IDENTITY_KEY_SCHEMA', 'SOURCE_INVENTORY_SEED']) if (!l2Ids.includes(required)) throw new Error(`M1_G07_STATIC_L2_${required}_MISSING`);
  for (const name of REQUIRED_ENVIRONMENT) if (!String(environment[name] || '').trim()) throw new Error(`M1_G07_STATIC_ENV_${name}_REQUIRED`);
  if (JSON.stringify(M1_CORE_G07_GOVERNANCE_REVIEW.adminOnlyAuthorizationGaps) !== JSON.stringify(['RECEIPT_NOTICE_MANAGE', 'PO_CHANGE_MANAGE', 'PROCUREMENT_CONFIG_MANAGE', 'ENGINEERING_BOM_MANAGE'])
    || M1_CORE_G07_GOVERNANCE_REVIEW.sourceInventorySeed.physicalBusinessFact !== 'PRODUCTION_HTTP'
    || M1_CORE_G07_GOVERNANCE_REVIEW.sourceInventorySeed.valuationPrerequisite !== 'CANONICAL_VALUATION_L2') throw new Error('M1_G07_STATIC_GOVERNANCE_REVIEW_INVALID');
  if (environment.ERP_DB_BACKEND !== 'mysql' || environment.ERP_TEST_DB_BACKEND !== 'mysql') throw new Error('M1_G07_STATIC_MYSQL_BACKEND_REQUIRED');
  if (JSON.stringify(M1_CORE_MANIFEST) !== JSON.stringify(['RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA', 'RUN_M1_HTTP_FIXTURES', 'CLEANUP_SCHEMA_POST_RUN'])) throw new Error('M1_G07_STATIC_OPERATION_MANIFEST_INVALID');
  assertTarget(target);
  return Object.freeze({ fixtureDigest: fixture.digest, crCount: 9, subjects: Object.freeze(subjects), technicalL2: Object.freeze(l2Ids), operations: M1_CORE_MANIFEST, target: Object.freeze({ ...target }) });
}

export const M1_G07_REQUIRED_ENVIRONMENT = REQUIRED_ENVIRONMENT;
