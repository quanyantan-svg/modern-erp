# M1-Core G05 正式 Owner Acceptance（2026-11-05）

> 用途：登记业务所有者对 `M1C-G05` 的正式 Acceptance 决定，签发 `M1C-G05 PASS`。
> Owner：Procurement & Outsourcing Domain Owner（正式验收决定）；Platform / QA（技术证据维护）。
> 状态：`APPROVED` —— 业务所有者已在本轮明确批准，`M1C-G05 PASS` 已签发。
> 权威来源：Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5、Active Design
> `docs/design/procurement-outsourcing-m1-core.md` §12 / §13.1、独立技术审查
> [`m1-core-g05-independent-review-20261103.md`](./m1-core-g05-independent-review-20261103.md)、
> 原始执行记录 [`m1-core-wp7a-gate-acceptance-20261103.md`](./m1-core-wp7a-gate-acceptance-20261103.md) 与
> 修复提交 `8559c03f78898b0b059330f096a4e1bde694f277`。本文是验收证据，不替代 Requirement、Design 或
> `docs/status/PROJECT_STATUS.md`。

## 1. 验收决定

业务所有者于 **2026-11-05** 在本轮对话中明确批准 G05 Owner Acceptance 并授权正式签发：

```text
M1C-G05 PASS
```

| 项 | 值 |
|---|---|
| 验收对象 | `M1C-G05`（移动工作面有限修复：两工作面可打开、委外动作门禁正确、服务端来源级 RBAC、四宽度与真实浏览器可操作） |
| Acceptance 标识 | `M1C-G05 PASS` |
| 决定性质 | **业务所有者 Owner Acceptance**（基于实际项目对话授权，不伪造手写签名、外部审批编号或电子签章） |
| 修复提交 | `8559c03f78898b0b059330f096a4e1bde694f277` |
| 独立技术审查 | `M1C_G05_INDEPENDENT_REVIEW_PASS`（[`m1-core-g05-independent-review-20261103.md`](./m1-core-g05-independent-review-20261103.md)） |
| 修复后 Browser 证据 | `PASS=24 / FAIL=0 / TOTAL=24` |
| 四宽度 | 320 / 390 / 430 / 680 CSS px |
| 工作面 | 委外加工（`outsourcing`）与寻源与定价（`sourcing-pricing`）两个工作面 |
| 主体 | admin / 委外业务员 / 销售专员（3 主体） |

## 2. 明确边界与不因本 PASS 而改变的事实

- **原始 `16/24` 失败历史完整保留**：WP7-A 原始 G05 结果 `PASS=16 / FAIL=8 / TOTAL=24` 仍原样保留于
  `docs/acceptance/m1-core-wp7a-gate-acceptance-20261103.md` 与 `PROJECT_STATUS.md` §37.27，本轮未删除、
  覆盖或改写。
- **本次登记不等于重新执行 Browser**：24/24 是提交 `8559c03` 已登记执行记录的审查确认，本轮未独立重跑
  浏览器，不伪装成新执行结果。
- **G05 不依赖 G07 MySQL 并发**：G05 是前端工作面、RBAC 可见性与浏览器可操作性 Gate；G07 的真实 MySQL
  并发结果与 G05 无依赖关系，G07 的结果不改变本 PASS。
- **仅批准 G05**：本决定只签发 `M1C-G05 PASS`，不涉及 G01～G04、G06、G07、WP7-A、M1-Core 包级
  Acceptance、Domain Closure、Freeze 或 Release Readiness。
- 服务端来源级 RBAC 证据保持不变：admin 200/200，委外业务员 200/403，销售专员 403/403；无权主体走页面级
  处理，不崩溃、无 TypeError、无横向溢出；前端门禁未替代后端 RBAC。

## 3. 状态迁移

```text
Before : M1C_G05_INDEPENDENT_REVIEW_PASS + Owner Acceptance PENDING_APPROVAL
         （独立技术审查已通过，业务所有者尚未签发正式 Gate Acceptance，见
         docs/acceptance/m1-core-g05-independent-review-20261103.md §4）
After  : M1C-G05 PASS
         （业务所有者 2026-11-05 的显式 Owner Acceptance 决定）
```

迁移采用**日期化 supersession**：独立技术审查文档的 `PENDING_APPROVAL` 状态是对其撰写时点的真实记录，
保留不删；其「当前状态」含义被本节取代。`M1C_G05_INDEPENDENT_REVIEW_PASS` 仍为有效历史事实。
