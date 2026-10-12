# Finance Operations Capability Matrix

Frozen source: `document.md §33`; design: `solution.md §28`. Status vocabulary is intentionally limited to the four approved final dispositions.

| ID | Capability | Primary service | API / UI / config surface | Canonical schema | Test / UAT evidence | Status |
|---|---|---|---|---|---|---|
| FO01 | Finance parameters | finance-parameters | `/api/finance/parameters` | finance_parameters | wave-a / UAT-01 | IMPLEMENTED_NEW |
| FO02 | Recognition policy | finance-recognition-policy | `/api/finance/recognition-policies` | finance_recognition_policies | recognition-production / UAT-04..09 | IMPLEMENTED_NEW |
| FO03 | Payment terms | finance-terms | `/api/finance/payment-terms` | finance_payment_terms | wave-a / UAT-01..02 | IMPLEMENTED_NEW |
| FO04 | Due schedule | finance-due-schedule | `/api/finance/due-schedules` | finance_due_schedule_lines | wave-a / UAT-10 | IMPLEMENTED_NEW |
| FO05 | Settlement scheme | finance-settlement-scheme | `/api/finance/settlement-schemes` | finance_settlement_schemes | wave-a / UAT-14 | IMPLEMENTED_NEW |
| FO06 | AR initialization | finance-ar-init | AR opening action | account_receivables | wave-a / UAT-01 | IMPLEMENTED_NEW |
| FO07 | AP initialization | finance-ap-init | AP opening action | account_payables | wave-a / UAT-02 | IMPLEMENTED_NEW |
| FO08 | Treasury initialization | finance-treasury-init | settlement-account opening action | bank_accounts, finance_treasury_movements | wave-d / UAT-03 | IMPLEMENTED_NEW |
| FO09 | Final AR | finance-recognition | delivery/invoice adapters | account_receivables | recognition-production / UAT-04..06 | CONVERGED |
| FO10 | Final AP | finance-recognition | receipt/bill adapters | account_payables | recognition-production / UAT-07..09 | CONVERGED |
| FO11 | Provisional AR | finance-ar-open-item | source adapter | account_receivables | wave-c / UAT-06 | IMPLEMENTED_NEW |
| FO12 | Provisional AP | finance-ap-open-item | source adapter | account_payables | recognition-production / UAT-09 | IMPLEMENTED_NEW |
| FO13 | Provisional conversion | finance-provisional-conversion | invoice/bill post | account_receivables, account_payables | recognition-production / UAT-06,09 | IMPLEMENTED_NEW |
| FO14 | Manual AR/AP | finance-manual-ar-ap | AR/AP actions | account_receivables, account_payables | wave-a / UAT-01..02 | CONVERGED |
| FO15 | Counterparty transfer | finance-counterparty-transfer | `/api/finance/transfers` | finance_counterparty_transfers | wave-b / UAT-22..23 | IMPLEMENTED_NEW |
| FO16 | Collection | settlement | `/api/payment-collections` | payment_collections | m8 / UAT-11 | EXISTING_REUSE |
| FO17 | Payment | settlement | `/api/payment-disbursements` | payment_disbursements | m8 / UAT-12 | EXISTING_REUSE |
| FO18 | Allocation | settlement-core | settlement item actions | payment_collection_items, payment_disbursement_items | m8 / UAT-13 | CONVERGED |
| FO19 | Automatic reconciliation | settlement-core | reconciliation action | canonical allocation facts | m8 / UAT-14 | CONVERGED |
| FO20 | Manual reconciliation | settlement | collection/payment editor | canonical allocation facts | m8 / UAT-14 | CONVERGED |
| FO21 | Settlement trace | settlement-core | AR/AP detail | settlement source tables | phase6a / UAT-13,19 | CONVERGED |
| FO22 | Settlement reversal | finance-settlement-reversal | settlement reverse action | settlement_reversals, settlement_reversal_items | phase6a / UAT-19 | IMPLEMENTED_NEW |
| FO23 | Advance/prepayment | finance-unapplied-balance | collection/payment actions | settlement_unapplied_balances | wave-b / UAT-15..16 | CONVERGED |
| FO24 | Unapplied balance | finance-unapplied-balance | unapplied balance list | settlement_unapplied_balances | phase6a / UAT-15..17 | CONVERGED |
| FO25 | Balance application | finance-unapplied-balance | apply action | balance_applications | wave-b / UAT-17 | CONVERGED |
| FO26 | Refund | financial-controls | `/api/financial-refunds` | financial_refunds | phase6a / UAT-18 | CONVERGED |
| FO27 | Write-off | financial-controls | `/api/financial-write-offs` | financial_write_offs | phase6a / UAT-20 | CONVERGED |
| FO28 | Bad debt | finance-bad-debt-provision | `/api/finance/bad-debt-provisions` | finance_bad_debt_provisions | wave-b / UAT-21 | IMPLEMENTED_NEW |
| FO29 | Sales invoice | commercial-golive | `/api/sales-invoices` | sales_invoices | invoice-lifecycle / UAT-24 | CONVERGED |
| FO30 | Purchase invoice | commercial-golive | `/api/supplier-bills` | supplier_bills | commercial-golive / UAT-25 | CONVERGED |
| FO31 | Invoice source cardinality | finance-recognition | invoice source links | finance_invoice_source_links | wave-c / UAT-24..25 | IMPLEMENTED_NEW |
| FO32 | Invoice to AR/AP | finance-recognition | invoice/bill post | invoice links + open items | recognition-production / UAT-24..25 | IMPLEMENTED_NEW |
| FO33 | Credit/red invoice | commercial-golive | `/api/commercial-credit-notes` | commercial_credit_notes | commercial-golive / UAT-24..25 | EXISTING_REUSE |
| FO34 | Invoice void | commercial-golive | invoice cancel/void actions | sales_invoices, financial_credit_adjustments | invoice-lifecycle / UAT-24 | CONVERGED |
| FO35 | Input verification | commercial-golive | bill verify/certify/reject | supplier_bills.verification_state | invoice-lifecycle / UAT-25 | IMPLEMENTED_NEW |
| FO36 | Invoice reports | finance-reports | invoice hub/reports | invoice projections | wave-e / UAT-32 | CONVERGED |
| FO37 | Settlement account | finance-treasury-movement | `/api/finance/settlement-accounts` | bank_accounts | wave-d / UAT-26 | CONVERGED |
| FO38 | Settlement method/purpose | finance routes | Treasury editor/config | canonical document fields | recovery-api / UAT-26 | CONVERGED |
| FO39 | Treasury movement | finance-treasury-movement | `/api/finance/treasury/movements` | finance_treasury_movements | wave-d / UAT-27 | IMPLEMENTED_NEW |
| FO40 | Cash deposit/withdrawal | finance-treasury-operations | Treasury cash action | finance_treasury_movements | wave-d / UAT-27 | CONVERGED |
| FO41 | Internal transfer | finance-treasury-movement | Treasury transfer action | finance_treasury_movements | wave-d / UAT-27 | IMPLEMENTED_NEW |
| FO42 | Notes receivable | finance-treasury-operations | `/api/finance/notes` | finance_notes | recovery-api / UAT-28 | IMPLEMENTED_NEW |
| FO43 | Notes payable | finance-treasury-operations | `/api/finance/notes` | finance_notes | recovery-api / UAT-28 | IMPLEMENTED_NEW |
| FO44 | Payment request | finance-treasury-operations | `/api/finance/payment-requests` | finance_payment_requests | recovery-api / UAT-28 | IMPLEMENTED_NEW |
| FO45 | Cash count | finance-treasury-operations | `/api/finance/cash-counts` | finance_cash_counts, finance_cash_count_lines | recovery-api / UAT-29 | IMPLEMENTED_NEW |
| FO46 | Bank statement | finance-treasury-operations | bank statement APIs | bank_statements, bank_statement_items | recovery-api / UAT-30 | CONVERGED |
| FO47 | Statement import | finance-treasury-operations | `/api/finance/bank-statements/import` | finance_bank_statement_imports | recovery-api / UAT-30 | IMPLEMENTED_NEW |
| FO48 | Bank reconciliation | finance-treasury-operations | reconciliation APIs | finance_bank_reconciliations, matches | recovery-api / UAT-30 | IMPLEMENTED_NEW |
| FO49 | Unmatched items | finance-treasury-operations | reconciliation unmatched API | derived remaining amounts | recovery-api / UAT-30 | IMPLEMENTED_NEW |
| FO50 | Treasury to GL | finance-reports | GL reconciliation report | Treasury/GL projections | wave-e / UAT-32 | INTEGRATION_BACKED |
| FO51 | AR close | finance-business-close | AR close/reopen | finance_business_close_state, closures | wave-a / UAT-31 | IMPLEMENTED_NEW |
| FO52 | AP close | finance-business-close | AP close/reopen | finance_business_close_state, closures | wave-a / UAT-31 | IMPLEMENTED_NEW |
| FO53 | Treasury close | finance-business-close | Treasury close/reopen | finance_business_close_state, closures | wave-a / UAT-31 | IMPLEMENTED_NEW |
| FO54 | AR reports | finance-reports | `/api/finance/reports/ar/*` | canonical AR projections | wave-e / UAT-32 | IMPLEMENTED_NEW |
| FO55 | AP reports | finance-reports | `/api/finance/reports/ap/*` | canonical AP projections | wave-e / UAT-32 | IMPLEMENTED_NEW |
| FO56 | Treasury reports | finance-reports | `/api/finance/reports/treasury/*` | canonical movement projections | wave-e / UAT-32 | IMPLEMENTED_NEW |
| FO57 | Source adapter | finance-recognition | delivery/receipt/invoice/bill adapters | canonical source links | recognition-production / UAT-04..09 | INTEGRATION_BACKED |
| FO58 | Accounting adapter | financial-inventory | canonical voucher adapter | accounting_vouchers, entries | commercial UAT / UAT-24..25,32 | INTEGRATION_BACKED |
