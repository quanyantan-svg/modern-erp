# Wave 8 Stage B — User Decision Approval Record

> 状态：`HISTORICAL_EVIDENCE`（验收 / 冻结 / 实施证据；**不是**当前需求、架构或项目状态的权威来源）
> Owner：Sales & Customer
> 权威来源：无 —— 证据只引用，不作为合同
> 来源：`document.md` / `solution.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## Wave 8 Stage B — User Decision Approval Record

Authorization source: the user's `Sales & Customer Wave 8 — User Decision Approval & Stage C Final Design Reconciliation` instruction dated 2026-10-19. This record approves the business decisions below and authorizes one bounded `solution.md §35` Design reconciliation only. It does not authorize Stage D Implementation, tests, builds, formatting, migration execution, database access, Git operations, or Wave 9–13.

| Decision | User-approved option and condition |
|---|---|
| A1 | `A1-DIRECT`: explicit `DIRECT_BUSINESS_OPEN_ITEM` for non-zero `SERVICE_FULFILLMENT`; immutable fulfillment source; no fallback and no duplicate Sales ledger. |
| A2 | `A2-ZERO-FACT`: zero-value Service Fulfillment may CONFIRM as authoritative operational evidence without calling Finance recognition or creating a zero AR. |
| A3 | `A3-CUMULATIVE`: partial/multiple invoice links are allowed through existing `finance_invoice_source_links`, subject to a locked cumulative source-capacity extension and no fifth table. |
| A4 | `A4-PENDING-ONLY`: only `PENDING → CANCELLED`; CONFIRMED has no Wave 8 cancel/reversal API. |
| A5 | `A5-CONFIRM-GATE`: every Service CONFIRM is a new DELIVERY-stage Gate entry, rechecking current authority without consuming prepayment; later Delivery rechecks independently. Subject to C1. |
| B1 | `B1-HISTORICAL-CONTINUITY`: inactive locations block new instruction/handoff; historical unsettled stock may settle/return from verified V21 movement evidence; mapping is immutable while outstanding. |
| B2 | `B2-REPRESENTABLE-NET-UNIT`: immutable tax-exclusive post-discount integer-cent `unit_price_cents`; BigInt cumulative allocation; non-representable source economics fail closed. |
| B3 | `B3-V21-ID`: `lot_code_key` carries canonical V21 `lot_id`; `lot_code` is display evidence only; no Sales-owned lot normalization. |
| B4 | `B4-WHOLE-DRAFT-CANCEL`: only a not-handed-off DRAFT instruction may be cancelled in full; no partial cancel/split. |
| B5 | `B5-EXPLICIT-DESTINATION`: unsettled return names a legal enterprise warehouse/bin and uses strict V21 MOVE; no AR/refund; settled sales return uses the existing controlled reverse chain. |
| C1 | Approved bounded Design scope for PREPAYMENT-parent-first Gate/Finance lock composition, authoritative re-read, stale-plan rollback/retry and real independent-session MySQL proof. Frozen Wave 7/Finance business semantics remain unchanged. |
| C2 | Approved bounded Design scope for V21 sources `CONSIGNMENT_HANDOFF`, `CONSIGNMENT_SETTLEMENT`, `CONSIGNMENT_RETURN`, strict value conservation/COGS, canonical tracking, caller-owned atomic transaction and no V21 schema extension. |
| C3 | Existing Platform audit contract accepted: committed transitions are audited in-transaction; failed transaction effects and uncommitted audit roll back together; no durable failed-attempt subsystem is required. |

All 12 requested decisions (A1–A5, B1–B5, C1–C2) are approved with the stated conditions; C3 is accepted. The four-table limit, zero existing-table column extension, existing trace identifiers/counts, Wave 6/7 freeze and Stage D hard stop remain binding. Any carrier conflict found during Design must be reported explicitly and may not be solved by silent policy or schema expansion.

**Requirement decision status: `WAVE8_STAGE_B_USER_DECISIONS_APPROVED — STAGE_C_FINAL_RECONCILIATION_AUTHORIZED`.**

---
