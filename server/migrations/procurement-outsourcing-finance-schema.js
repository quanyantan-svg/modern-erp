// Procurement & Outsourcing — Finance handoff schema (OUT-20 / OUT-21).
//
// Contract source:
//   - Requirement MC-REQ-15 (docs/requirements/procurement-outsourcing.md §31.13)
//     的 `C-P01..C-P04` 裁定结论：本轮由业务所有者裁定「真正实现正式过账」，
//     不再是 SAFE_CLOSE 延期边界。
//   - Design §26.20 Processing Fee Partial Billing / Cost Evidence (OUT-21)。
//
// 本文件只做**加法**（additive）：
//   1. `outsourcing_processing_fee_accounting_profiles` —— C-P02 的科目角色档案。
//      加工费过账**必须**通过档案读取角色码，不得在业务代码里硬编码科目；
//      档案缺位或角色映射缺位一律 fail closed（409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`）。
//   2. `outsourcing_processing_fee_reversals` —— C-P03 的红冲事实。
//   3. `supplier_bills` 的加工费过账状态列（普通采购账单恒为 NULL）。
//   4. `outsourcing_cost_evidences` 的 FINAL 口径金额列（OUT-21）。
//
// 两引擎语义对等：全部 DDL 幂等，可重放；唯一性用两引擎等价的
// (source_id, supplier_id) 组合键，不用任何单引擎行为。

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function safeAddColumn(db, table, column, ddl) {
  if (!tableExists(db, table)) return false;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((row) => String(row.name).toLowerCase() === column.toLowerCase())) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

function columnExists(db, table, column) {
  if (!tableExists(db, table)) return false;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((row) => String(row.name).toLowerCase() === column.toLowerCase());
}

// 加工费的借方科目角色。科目本身是会计政策（C-P02），因此角色码与科目码
// 只在**档案**里出现一次；业务代码只读档案，永远不硬编码科目码。
//
// `OUTSOURCING_PROCESSING_FEE` 走 6408「委外加工费」：委外收货没有在途物资腿
// （成品在收货生效时直接按消耗材料价值 + 加工费入账），因此**不得**套用普通
// 采购的 `Dr GRNI / Cr AP`（MC-REQ-15 / M1-D-16 明确禁止）。
const PROCESSING_FEE_SUBJECT = ['subject-022', '6408', '委外加工费', 'EXPENSE', 'DEBIT'];
const PROCESSING_FEE_ROLE = 'OUTSOURCING_PROCESSING_FEE';

export function migrateProcurementOutsourcingFinanceSchema(db) {
  // ── 1. 加工费科目与角色映射（canonical 科目登记簿的加法扩展） ──
  const insertSubject = db.prepare('INSERT OR IGNORE INTO accounting_subjects(id,code,name,type,direction,active) VALUES(?,?,?,?,?,1)');
  insertSubject.run(...PROCESSING_FEE_SUBJECT);
  db.prepare('INSERT OR IGNORE INTO account_role_mappings(role_code,subject_id,updated_at) SELECT ?,id,? FROM accounting_subjects WHERE code=?')
    .run(PROCESSING_FEE_ROLE, new Date().toISOString(), PROCESSING_FEE_SUBJECT[1]);

  // ── 2. C-P02 会计科目档案 ──
  // 一行 = 一套被批准的加工费过账角色集。`processing_fee_role` 是借方；
  // `input_tax_role` / `tax_mode` 表达 C-P02 的税务口径；
  // `variance_role` 表达加工费实际与暂估的差异去向。
  //
  // 档案是**唯一**的科目来源：过账路径只读档案，档案缺位即 fail closed。
  // `scope='GLOBAL'` 是默认档案；`scope='SUPPLIER'` 可按供应商覆盖。
  db.exec(`
    CREATE TABLE IF NOT EXISTS outsourcing_processing_fee_accounting_profiles (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      supplier_id TEXT,
      profile_code TEXT NOT NULL,
      tax_mode TEXT NOT NULL DEFAULT 'NO_TAX',
      processing_fee_role TEXT NOT NULL,
      input_tax_role TEXT,
      variance_role TEXT,
      approval_state TEXT NOT NULL DEFAULT 'APPROVED',
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(scope IN ('GLOBAL','SUPPLIER')),
      CHECK(tax_mode IN ('NO_TAX','EXCLUSIVE','INCLUSIVE')),
      CHECK(approval_state IN ('APPROVED','SUSPENDED')),
      CHECK((scope='GLOBAL' AND supplier_id IS NULL) OR (scope='SUPPLIER' AND supplier_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_processing_fee_profiles_lookup
      ON outsourcing_processing_fee_accounting_profiles(scope, supplier_id, effective_from);

    CREATE TABLE IF NOT EXISTS outsourcing_processing_fee_reversals (
      id TEXT PRIMARY KEY,
      reversal_no TEXT NOT NULL UNIQUE,
      supplier_bill_id TEXT NOT NULL,
      supplier_bill_item_id TEXT NOT NULL,
      outsourcing_receipt_id TEXT NOT NULL,
      outsourcing_receipt_item_id TEXT NOT NULL,
      reversal_quantity REAL NOT NULL,
      reversal_amount_cents INTEGER NOT NULL,
      business_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONFIRMED',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_bill_id) REFERENCES supplier_bills(id),
      FOREIGN KEY (supplier_bill_item_id) REFERENCES supplier_bill_items(id),
      FOREIGN KEY (outsourcing_receipt_id) REFERENCES outsourcing_receipts(id),
      FOREIGN KEY (outsourcing_receipt_item_id) REFERENCES outsourcing_receipt_items(id),
      CHECK(reversal_quantity > 0),
      CHECK(reversal_amount_cents > 0),
      CHECK(status IN ('CONFIRMED','REVERSED'))
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_processing_fee_reversals_bill
      ON outsourcing_processing_fee_reversals(supplier_bill_id);
    CREATE INDEX IF NOT EXISTS idx_outsourcing_processing_fee_reversals_item
      ON outsourcing_processing_fee_reversals(supplier_bill_item_id);
  `);

  // ── 3. 供应商账单的加工费过账状态（普通采购账单恒为 NULL） ──
  // `posting_state` 记录**已过账**加工费账单的可红冲性：
  //   NULL   —— 不是加工费账单，或尚未过账（普通采购账单恒为 NULL）
  //   POSTED —— 已过账，可按行红冲
  //   REVERSED —— 已被红冲冲平，不再可红冲
  safeAddColumn(db, 'supplier_bills', 'processing_fee_posting_state', "processing_fee_posting_state TEXT");
  safeAddColumn(db, 'supplier_bills', 'processing_fee_profile_id', 'processing_fee_profile_id TEXT');
  safeAddColumn(db, 'supplier_bills', 'processing_fee_reversed_cents', 'processing_fee_reversed_cents INTEGER NOT NULL DEFAULT 0');

  // ── 4. OUT-21 FINAL 成本证据口径 ──
  // `processing_fee_actual_cents` = canonical 账单实际金额（不得手算）。
  // `variance_cents` = actual - provisional。
  // `processing_fee_basis_cents` 记录**收货生效时**确认的加工费金额（C-P01），
  // 它是 provisional 与 variance 的比较基准，任何时候都不被账单改写。
  safeAddColumn(db, 'outsourcing_cost_evidences', 'processing_fee_basis_cents', 'processing_fee_basis_cents INTEGER');
  safeAddColumn(db, 'outsourcing_cost_evidences', 'finalized_bill_id', 'finalized_bill_id TEXT');
  safeAddColumn(db, 'outsourcing_cost_evidences', 'finalized_at', 'finalized_at TEXT');

  // ── 5. 默认全局档案（C-P02 的唯一默认口径） ──
  // 只预置**一套**全局默认档案；它引用既有 canonical 角色码 + 新增的
  // 加工费角色码。不预置任何供应商级档案，也不预置任何税务政策选择
  // （tax_mode 默认 NO_TAX，对应「加工费不计进项税」这一显式声明）。
  const now = new Date().toISOString();
  const defaultProfileId = 'oppaf-default-no-tax';
  const existingDefault = db.prepare('SELECT id FROM outsourcing_processing_fee_accounting_profiles WHERE id=?').get(defaultProfileId);
  if (!existingDefault) {
    const roleExists = db.prepare('SELECT 1 FROM account_role_mappings WHERE role_code=?').get(PROCESSING_FEE_ROLE);
    if (roleExists) {
      db.prepare(`INSERT INTO outsourcing_processing_fee_accounting_profiles(
        id,scope,supplier_id,profile_code,tax_mode,processing_fee_role,input_tax_role,variance_role,
        approval_state,effective_from,effective_to,created_by,created_at,updated_at)
        VALUES(?,'GLOBAL',NULL,'DEFAULT_NO_TAX','NO_TAX',?,NULL,NULL,'APPROVED','1970-01-01',NULL,'system',?,?)`)
        .run(defaultProfileId, PROCESSING_FEE_ROLE, now, now);
    }
  }

  void columnExists;
}
