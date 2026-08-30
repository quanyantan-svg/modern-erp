export function migrateExtendedSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      parent_id TEXT, manager TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, FOREIGN KEY (parent_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS aux_projects (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RUNNING', start_date TEXT, end_date TEXT,
      budget_cents INTEGER NOT NULL DEFAULT 0, manager TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS currencies (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT NOT NULL,
      exchange_rate REAL NOT NULL DEFAULT 1, is_base INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voucher_words (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      prefix TEXT NOT NULL, current_no INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voucher_templates (
      id TEXT PRIMARY KEY, template_code TEXT NOT NULL UNIQUE, template_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'GENERAL',
      entries_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
      creator_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS period_closures (
      id TEXT PRIMARY KEY, period TEXT NOT NULL UNIQUE, period_year INTEGER NOT NULL,
      period_month INTEGER NOT NULL, closure_type TEXT NOT NULL DEFAULT 'MONTH',
      status TEXT NOT NULL DEFAULT 'OPEN', closed_by TEXT, closed_at TEXT,
      checklist_passed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      FOREIGN KEY (closed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS voucher_sequences (
      id TEXT PRIMARY KEY, voucher_word_id TEXT NOT NULL, year INTEGER NOT NULL,
      month INTEGER NOT NULL, current_no INTEGER NOT NULL DEFAULT 0,
      UNIQUE(voucher_word_id, year, month)
    );

    CREATE TABLE IF NOT EXISTS bank_statements (
      id TEXT PRIMARY KEY, bank_account_id TEXT NOT NULL, statement_no TEXT NOT NULL UNIQUE,
      statement_date TEXT NOT NULL, period TEXT NOT NULL, opening_balance_cents INTEGER NOT NULL DEFAULT 0,
      closing_balance_cents INTEGER NOT NULL DEFAULT 0, total_debit_cents INTEGER NOT NULL DEFAULT 0,
      total_credit_cents INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 0,
      creator_id TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id), FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS bank_statement_items (
      id TEXT PRIMARY KEY, statement_id TEXT NOT NULL, line_no INTEGER NOT NULL,
      transaction_date TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      debit_cents INTEGER NOT NULL DEFAULT 0, credit_cents INTEGER NOT NULL DEFAULT 0,
      balance_cents INTEGER NOT NULL DEFAULT 0, counterparty TEXT NOT NULL DEFAULT '',
      reference_no TEXT NOT NULL DEFAULT '', FOREIGN KEY (statement_id) REFERENCES bank_statements(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bank_reconciliations (
      id TEXT PRIMARY KEY, bank_account_id TEXT NOT NULL, reconciliation_no TEXT NOT NULL UNIQUE,
      period TEXT NOT NULL, statement_balance_cents INTEGER NOT NULL,
      book_balance_cents INTEGER NOT NULL, difference_cents INTEGER NOT NULL DEFAULT 0,
      reconciled_by TEXT NOT NULL, reconciled_at TEXT NOT NULL, remark TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id), FOREIGN KEY (reconciled_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS mrp_plans (
      id TEXT PRIMARY KEY, plan_no TEXT NOT NULL UNIQUE, plan_type TEXT NOT NULL DEFAULT 'SALES_ORDER',
      status TEXT NOT NULL DEFAULT 'DRAFT', planned_date TEXT NOT NULL,
      total_items INTEGER NOT NULL DEFAULT 0, total_cost_cents INTEGER NOT NULL DEFAULT 0,
      creator_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS mrp_plan_items (
      id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, product_id TEXT NOT NULL,
      demand_type TEXT NOT NULL, demand_source_id TEXT, gross_requirement REAL NOT NULL DEFAULT 0,
      on_hand REAL NOT NULL DEFAULT 0, scheduled_receipt REAL NOT NULL DEFAULT 0,
      planned_receipt REAL NOT NULL DEFAULT 0, planned_order_quantity REAL NOT NULL DEFAULT 0,
      due_date TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
      FOREIGN KEY (plan_id) REFERENCES mrp_plans(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS work_centers (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'PRODUCTION', capacity_hours REAL NOT NULL DEFAULT 0,
      efficiency REAL NOT NULL DEFAULT 1, unit_cost_cents INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS routing_operations (
      id TEXT PRIMARY KEY, bom_id TEXT NOT NULL, operation_no INTEGER NOT NULL,
      work_center_id TEXT NOT NULL, work_time_minutes REAL NOT NULL DEFAULT 0,
      setup_time_minutes REAL NOT NULL DEFAULT 0, wait_time_minutes REAL NOT NULL DEFAULT 0,
      move_time_minutes REAL NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE,
      FOREIGN KEY (work_center_id) REFERENCES work_centers(id)
    );

    CREATE TABLE IF NOT EXISTS production_labor_records (
      id TEXT PRIMARY KEY, record_no TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL,
      operation_id TEXT, worker_id TEXT NOT NULL, work_date TEXT NOT NULL,
      hours REAL NOT NULL, output_quantity REAL NOT NULL DEFAULT 0,
      reject_quantity REAL NOT NULL DEFAULT 0, labor_cost_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'CONFIRMED', remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES production_orders(id),
      FOREIGN KEY (operation_id) REFERENCES routing_operations(id), FOREIGN KEY (worker_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS iqc_inspections (
      id TEXT PRIMARY KEY, iqc_no TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL,
      receipt_id TEXT, inspection_type TEXT NOT NULL DEFAULT 'SAMPLING', status TEXT NOT NULL DEFAULT 'PENDING',
      result TEXT, total_quantity REAL NOT NULL DEFAULT 0, sample_quantity REAL NOT NULL DEFAULT 0,
      qualified_quantity REAL NOT NULL DEFAULT 0, reject_quantity REAL NOT NULL DEFAULT 0,
      inspector_id TEXT, inspected_at TEXT, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id), FOREIGN KEY (inspector_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS iqc_inspection_items (
      id TEXT PRIMARY KEY, iqc_id TEXT NOT NULL, product_id TEXT NOT NULL,
      batch_no TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL DEFAULT 0,
      sample_size REAL NOT NULL DEFAULT 0, qualified INTEGER NOT NULL DEFAULT 1,
      reject_reason TEXT NOT NULL DEFAULT '', FOREIGN KEY (iqc_id) REFERENCES iqc_inspections(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS oqc_inspections (
      id TEXT PRIMARY KEY, oqc_no TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL,
      delivery_id TEXT, inspection_type TEXT NOT NULL DEFAULT 'SAMPLING', status TEXT NOT NULL DEFAULT 'PENDING',
      result TEXT, total_quantity REAL NOT NULL DEFAULT 0, sample_quantity REAL NOT NULL DEFAULT 0,
      qualified_quantity REAL NOT NULL DEFAULT 0, reject_quantity REAL NOT NULL DEFAULT 0,
      inspector_id TEXT, inspected_at TEXT, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id), FOREIGN KEY (inspector_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS oqc_inspection_items (
      id TEXT PRIMARY KEY, oqc_id TEXT NOT NULL, product_id TEXT NOT NULL,
      batch_no TEXT NOT NULL DEFAULT '', quantity REAL NOT NULL DEFAULT 0,
      sample_size REAL NOT NULL DEFAULT 0, qualified INTEGER NOT NULL DEFAULT 1,
      reject_reason TEXT NOT NULL DEFAULT '', FOREIGN KEY (oqc_id) REFERENCES oqc_inspections(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS supplier_evaluations (
      id TEXT PRIMARY KEY, evaluation_no TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL,
      evaluation_type TEXT NOT NULL DEFAULT 'REGULAR', evaluation_date TEXT NOT NULL,
      quality_score REAL NOT NULL, delivery_score REAL NOT NULL, price_score REAL NOT NULL,
      service_score REAL NOT NULL, overall_score REAL NOT NULL, grade TEXT NOT NULL,
      evaluator_id TEXT NOT NULL, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id), FOREIGN KEY (evaluator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id TEXT PRIMARY KEY, request_no TEXT NOT NULL UNIQUE, leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, total_days REAL NOT NULL,
      reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', applicant_id TEXT NOT NULL,
      approver_id TEXT, approved_at TEXT, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      FOREIGN KEY (applicant_id) REFERENCES users(id), FOREIGN KEY (approver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS expense_claims (
      id TEXT PRIMARY KEY, claim_no TEXT NOT NULL UNIQUE, claim_type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL, expense_date TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING', applicant_id TEXT NOT NULL, approver_id TEXT,
      approved_at TEXT, remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      FOREIGN KEY (applicant_id) REFERENCES users(id), FOREIGN KEY (approver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS expense_claim_items (
      id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, item_date TEXT NOT NULL,
      item_type TEXT NOT NULL, amount_cents INTEGER NOT NULL, description TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (claim_id) REFERENCES expense_claims(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY, rule_code TEXT NOT NULL UNIQUE, rule_name TEXT NOT NULL,
      alert_type TEXT NOT NULL, condition_type TEXT NOT NULL, threshold_value REAL NOT NULL DEFAULT 0,
      threshold_unit TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
      notify_users TEXT NOT NULL DEFAULT '[]', remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_records (
      id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'INFO', source_type TEXT, source_id TEXT,
      is_resolved INTEGER NOT NULL DEFAULT 0, resolved_by TEXT, resolved_at TEXT,
      resolved_remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      FOREIGN KEY (rule_id) REFERENCES alert_rules(id), FOREIGN KEY (resolved_by) REFERENCES users(id)
    );
  `);
}
