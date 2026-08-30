const fs = require("fs");
const path = require("path");
const appPath = path.join(__dirname, "app.js");
let app = fs.readFileSync(appPath, "utf8");

const routes = [
  "if (pathname === '/api/departments' && req.method === 'GET') return listDepartments(db, res, actor, url);",
  "if (pathname === '/api/departments' && req.method === 'POST') return createDepartment(db, req, res, actor);",
  "if (pathname === '/api/aux-projects' && req.method === 'GET') return listProjects(db, res, actor, url);",
  "if (pathname === '/api/aux-projects' && req.method === 'POST') return createProject(db, req, res, actor);",
  "if (pathname === '/api/currencies' && req.method === 'GET') return listCurrencies(db, res, actor);",
  "if (pathname === '/api/voucher-words' && req.method === 'GET') return listVoucherWords(db, res, actor);",
  "if (pathname === '/api/voucher-words' && req.method === 'POST') return createVoucherWord(db, req, res, actor);",
  "if (pathname === '/api/voucher-templates' && req.method === 'GET') return listVoucherTemplates(db, res, actor, url);",
  "if (pathname === '/api/period-closures' && req.method === 'GET') return listPeriodClosures(db, res, actor, url);",
  "if (pathname === '/api/period-closures' && req.method === 'POST') return createPeriodClosure(db, req, res, actor);",
  "if (pathname === '/api/bank-statements' && req.method === 'GET') return listBankStatements(db, res, actor, url);",
  "if (pathname === '/api/bank-statements' && req.method === 'POST') return createBankStatement(db, req, res, actor);",
  "if (pathname === '/api/bank-reconciliations' && req.method === 'GET') return listBankReconciliations(db, res, actor, url);",
  "if (pathname === '/api/bank-reconciliations' && req.method === 'POST') return createBankReconciliation(db, req, res, actor);",
  "if (pathname === '/api/reports/trial-balance' && req.method === 'GET') return getTrialBalance(db, req, res, actor, url);",
  "if (pathname === '/api/accounting-vouchers' && req.method === 'POST') return createAccountingVoucher(db, req, res, actor);",
];

const insertPoint = "if (avMatch && req.method === 'GET') return getAccountingVoucher(db, res, actor, avMatch[1]);";
let routesBlock = "\n" + routes.join("\n") + "\n";

app = app.replace(insertPoint, insertPoint + routesBlock);

fs.writeFileSync(appPath, app);
console.log("Routes added!");
