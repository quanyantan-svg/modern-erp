import { readJson, send } from '../lib/http.js';
import { listFinanceParameters, upsertFinanceParameter } from './finance-parameters.js';
import { listRecognitionPolicies, upsertRecognitionPolicy } from './finance-recognition-policy.js';
import { listFinancePaymentTerms, upsertFinancePaymentTerm } from './finance-terms.js';
import { listSettlementSchemes, upsertSettlementScheme } from './finance-settlement-scheme.js';
import { listDueSchedules, upsertDueSchedules } from './finance-due-schedule.js';
import { createManualAccountReceivable } from './finance-ar-open-item.js';
import { createManualAccountPayable } from './finance-ap-open-item.js';
import { listArInitialization, postArOpening } from './finance-ar-init.js';
import { listApInitialization, postApOpening } from './finance-ap-init.js';
import { postTreasuryOpening } from './finance-treasury-init.js';
import { postCounterpartyTransfer } from './finance-counterparty-transfer.js';
import { postBadDebtProvision } from './finance-bad-debt-provision.js';
import { postTreasuryTransfer } from './finance-treasury-movement.js';
import { closeBusiness, listBusinessCloseHistory, listBusinessCloseState, reopenBusiness } from './finance-business-close.js';
import { apSummary, arAging, arSummary, settlementAccountBalance, treasuryGlReconcile, treasuryMovementLedger } from './finance-reports.js';
import {
  actOnNote, actOnPaymentRequest, bankReconciliationUnmatched, confirmCashCount,
  createBankReconciliation, createCashCount, createNote, createPaymentRequest,
  createSettlementAccount, importBankStatement, listBankReconciliations,
  listBankStatements, listCashCounts, listNotes, listPaymentRequests,
  listSettlementAccounts, listTreasuryMovements, matchBankReconciliation,
  postCashOperation,
} from './finance-treasury-operations.js';

// Canonical Finance Operations HTTP namespace. Returns true only when a route
// was handled so app.js can keep legacy aliases without duplicating services.
export async function handleFinanceRoute(db, req, res, actor, url) {
  const path = url.pathname; let match;
  if (path === '/api/finance/parameters' && req.method === 'GET') { listFinanceParameters(db, res, actor); return true; }
  if (path === '/api/finance/parameters' && ['POST', 'PATCH'].includes(req.method)) { await upsertFinanceParameter(db, req, res, actor); return true; }
  if (path === '/api/finance/recognition-policy' && req.method === 'GET') { listRecognitionPolicies(db, res, actor); return true; }
  if (path === '/api/finance/recognition-policy' && ['POST', 'PATCH'].includes(req.method)) { await upsertRecognitionPolicy(db, req, res, actor); return true; }
  if (path === '/api/finance/payment-terms' && req.method === 'GET') { listFinancePaymentTerms(db, res, actor); return true; }
  if (path === '/api/finance/payment-terms' && ['POST', 'PATCH'].includes(req.method)) { await upsertFinancePaymentTerm(db, req, res, actor); return true; }
  if (path === '/api/finance/settlement-schemes' && req.method === 'GET') { listSettlementSchemes(db, res, actor); return true; }
  if (path === '/api/finance/settlement-schemes' && ['POST', 'PATCH'].includes(req.method)) { await upsertSettlementScheme(db, req, res, actor); return true; }
  if ((match = path.match(/^\/api\/finance\/due-schedules\/(AR|AP)\/([^/]+)$/i)) && req.method === 'GET') { listDueSchedules(db, res, actor, match[1].toUpperCase(), match[2]); return true; }
  if (path === '/api/finance/due-schedules' && ['POST', 'PATCH'].includes(req.method)) { await upsertDueSchedules(db, req, res, actor); return true; }

  if (path === '/api/accounts-receivable' && req.method === 'POST') { await createManualAccountReceivable(db, req, res, actor); return true; }
  if (path === '/api/accounts-payable' && req.method === 'POST') { await createManualAccountPayable(db, req, res, actor); return true; }
  if (path === '/api/finance/initialization/ar' && req.method === 'GET') { listArInitialization(db, res, actor); return true; }
  if (path === '/api/finance/initialization/ar' && req.method === 'POST') { return send(res, 201, { id: postArOpening(db, await readJson(req), actor) }) || true; }
  if (path === '/api/finance/initialization/ap' && req.method === 'GET') { listApInitialization(db, res, actor); return true; }
  if (path === '/api/finance/initialization/ap' && req.method === 'POST') { return send(res, 201, { id: postApOpening(db, await readJson(req), actor) }) || true; }
  if (path === '/api/finance/initialization/treasury' && req.method === 'POST') { await postTreasuryOpening(db, req, res, actor); return true; }
  if (path === '/api/finance/transfers' && req.method === 'POST') { await postCounterpartyTransfer(db, req, res, actor); return true; }
  if (path === '/api/finance/bad-debt-provisions' && req.method === 'POST') { await postBadDebtProvision(db, req, res, actor); return true; }

  if (path === '/api/finance/settlement-accounts' && req.method === 'GET') { listSettlementAccounts(db, res, actor); return true; }
  if (path === '/api/finance/settlement-accounts' && req.method === 'POST') { await createSettlementAccount(db, req, res, actor); return true; }
  if (path === '/api/finance/treasury-movements' && req.method === 'GET') { listTreasuryMovements(db, res, actor, url); return true; }
  if (path === '/api/finance/treasury-transfers' && req.method === 'POST') { await postTreasuryTransfer(db, req, res, actor); return true; }
  if (path === '/api/finance/treasury/cash-deposit' && req.method === 'POST') { await postCashOperation(db, req, res, actor, 'deposit'); return true; }
  if (path === '/api/finance/treasury/cash-withdrawal' && req.method === 'POST') { await postCashOperation(db, req, res, actor, 'withdrawal'); return true; }

  if (path === '/api/finance/notes' && req.method === 'GET') { listNotes(db, res, actor, url); return true; }
  if (path === '/api/finance/notes' && req.method === 'POST') { await createNote(db, req, res, actor); return true; }
  if ((match = path.match(/^\/api\/finance\/notes\/([^/]+)\/(hold|endorse|discount|settle|cancel)$/)) && req.method === 'POST') { await actOnNote(db, req, res, actor, match[1], match[2]); return true; }
  if (path === '/api/finance/payment-requests' && req.method === 'GET') { listPaymentRequests(db, res, actor); return true; }
  if (path === '/api/finance/payment-requests' && req.method === 'POST') { await createPaymentRequest(db, req, res, actor); return true; }
  if ((match = path.match(/^\/api\/finance\/payment-requests\/([^/]+)\/(submit|approve|reject|execute|cancel)$/)) && req.method === 'POST') { await actOnPaymentRequest(db, req, res, actor, match[1], match[2]); return true; }
  if (path === '/api/finance/cash-counts' && req.method === 'GET') { listCashCounts(db, res, actor); return true; }
  if (path === '/api/finance/cash-counts' && req.method === 'POST') { await createCashCount(db, req, res, actor); return true; }
  if ((match = path.match(/^\/api\/finance\/cash-counts\/([^/]+)\/confirm$/)) && req.method === 'POST') { await confirmCashCount(db, req, res, actor, match[1]); return true; }

  if (path === '/api/finance/bank-statements' && req.method === 'GET') { listBankStatements(db, res, actor); return true; }
  if (path === '/api/finance/bank-statements/import' && req.method === 'POST') { await importBankStatement(db, req, res, actor); return true; }
  if (path === '/api/finance/bank-reconciliations' && req.method === 'GET') { listBankReconciliations(db, res, actor); return true; }
  if (path === '/api/finance/bank-reconciliations' && req.method === 'POST') { await createBankReconciliation(db, req, res, actor); return true; }
  if ((match = path.match(/^\/api\/finance\/bank-reconciliations\/([^/]+)\/matches$/)) && req.method === 'POST') { await matchBankReconciliation(db, req, res, actor, match[1]); return true; }
  if ((match = path.match(/^\/api\/finance\/bank-reconciliations\/([^/]+)\/unmatched$/)) && req.method === 'GET') { bankReconciliationUnmatched(db, res, actor, match[1]); return true; }

  if (path === '/api/finance/business-close' && req.method === 'GET') { listBusinessCloseState(db, res, actor); return true; }
  if (path === '/api/finance/business-close/history' && req.method === 'GET') { listBusinessCloseHistory(db, res, actor, url.searchParams.get('closeType')); return true; }
  if ((match = path.match(/^\/api\/finance\/business-close\/(ar|ap|treasury)\/(close|reopen)$/i)) && req.method === 'POST') {
    if (match[2].toLowerCase() === 'close') await closeBusiness(db, req, res, actor, match[1].toUpperCase()); else await reopenBusiness(db, req, res, actor, match[1].toUpperCase());
    return true;
  }

  if (path === '/api/finance/reports/ar/summary' && req.method === 'GET') { arSummary(db, res, actor); return true; }
  if (path === '/api/finance/reports/ar/aging' && req.method === 'GET') { arAging(db, res, actor); return true; }
  if (path === '/api/finance/reports/ap/summary' && req.method === 'GET') { apSummary(db, res, actor); return true; }
  if (path === '/api/finance/reports/treasury/movements' && req.method === 'GET') { treasuryMovementLedger(db, res, actor); return true; }
  if ((match = path.match(/^\/api\/finance\/reports\/treasury\/accounts\/([^/]+)$/)) && req.method === 'GET') { settlementAccountBalance(db, res, actor, match[1]); return true; }
  if ((match = path.match(/^\/api\/finance\/reports\/treasury\/gl-reconciliation\/([^/]+)$/)) && req.method === 'GET') { treasuryGlReconcile(db, res, actor, match[1]); return true; }
  return false;
}
