# Accounting & Analytics 域级浏览器验收证据

> 用途：Accounting & Analytics 域（AA-W1..AA-W7）新增 / 改造工作面的真实浏览器验收证据。
> Owner：Accounting & Analytics Domain Owner（证据维护）；Platform / QA（采集与复跑）。
> 状态：`ACTIVE`（证据目录）。
> 权威来源：**无** —— 本目录只保存验收证据，**不是**需求、架构或项目状态的权威来源。
> 当前项目状态：[`docs/status/PROJECT_STATUS.md`](../../status/PROJECT_STATUS.md) §52；
> 验收候签材料：[`docs/acceptance/accounting-analytics-domain-acceptance-candidate-20261111.md`](../../acceptance/accounting-analytics-domain-acceptance-candidate-20261111.md)。

## 文件

| 文件 | 内容 |
|---|---|
| `responsive-uat.json` | 六个工作面（固定资产 / 会计事件台账 / 业务财务对账 / 报表平台 / 存货核算 / 经营会计）在 320 / 390 / 430 / 680 CSS px 下的断言结果、浏览器控制台错误数与采集时间 |

## 采集方式

```bash
pnpm build
pnpm test:accounting:responsive
```

脚本：`scripts/acceptance/accounting-analytics-responsive-uat.mjs`。它用一次性 SQLite 测试库启动本地
API 服务，用本机 Edge（Chromium 内核）以真实浏览器打开每个 route，断言：

1. 目标工作面**确实渲染**（页面标识文本出现在文档正文中）；
2. 320 / 390 / 430 / 680 四档下**无整页横向滚动**；
3. 页面未出现致命错误文本（`TypeError` / `Cannot read propert…` / `服务器内部错误`）。

任一断言不成立即判 `FAIL` 并以非零退出码结束；证据同时写入本目录的 `responsive-uat.json`。

## 本轮结果

2026-11-11：**6 / 6 PASS**，浏览器错误 **0**。

| ID | 工作面 | 结果 |
|---|---|---|
| `AA-UAT-fixed-assets` | 固定资产 | PASS |
| `AA-UAT-accounting-events` | 会计事件台账 | PASS |
| `AA-UAT-accounting-reconciliation` | 业务财务对账 | PASS |
| `AA-UAT-accounting-reports` | 报表平台 | PASS |
| `AA-UAT-accounting-costing` | 存货核算 | PASS |
| `AA-UAT-management-accounting` | 经营会计 | PASS |

## 边界

本证据只证明**界面可达性**与**四档宽度无整页横向滚动**，**不**证明业务语义正确、业务数据正确或
会计期间状态正确。业务语义的证明在 `server/accounting-analytics-w*.test.js` 与
`server/accounting-analytics-mysql-schema-parity.test.js` 两个套件中。
