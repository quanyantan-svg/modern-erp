# AGENTS.md 建议更新内容

## 建议将 §1.1 替换为

## 1.1 当前产品开发主线与双轴模型

- 最终产品架构为 **8 Business Domains + Platform**：
  `Master & Engineering / Sales & Customer / Planning / Procurement & Outsourcing / Manufacturing & Quality / Inventory & Warehouse / Finance Operations / Accounting & Analytics + Platform`。
- 《金蝶云星空标准版操作手册》B3101–B3122 共 22 份手册是**Requirements / Coverage / Acceptance 来源**，不是最终产品一级菜单或领域边界。
- 每项 Capability 必须建立 `Manual → Capability → Target Domain → Current Implementation → Coverage → Gap → Requirement → Design → Acceptance` 追溯。
- 默认按 `B3101 → ... → B3122` 进行手册能力审计；只有用户明确调整时改变。
- 用户批准的全局架构基线/范围收口任务可以先于 B3101 实施，但必须已有 `document.md` / `solution.md` 的明确 Requirement/Design，不得形成独立的“为了重构而重构”路线。
- 当前首先进行 Core Scope Cleanup：移除 Project Management / CRM 扩展；随后进行 Domain Alignment；之后进入逐手册 Capability Closure。
- 历史 Wave 仅作为工程历史与可复用模式，不再是 roadmap。
- 详细产品要求见 `document.md §20–§21`，设计见 `solution.md §19–§20`。

## 建议将 §2.1 修改为更严格的用户规范

### 2.1 每个开发任务修改前的完整文档基线

在任何应用代码、测试、schema、migration、配置或产品行为修改前，必须从头到尾完整阅读：

- `README.md`
- `document.md`
- `solution.md`
- `AGENTS.md`
- 当前 AI 工具入口规则（Claude Code 读取 `CLAUDE.md`）
- `log/` 中按日期倒序最近 3 个实际存在开发日志日期；同日拆分文件全部读取

同一个已经开始、文档未变化的单一 implementation task 内，不要求每改一个文件重新读一遍；但开始下一个功能/阶段时必须重新建立上述基线。

修改代码前还必须完整阅读：

- 本次受影响 Domain 的相关源码；
- 目标函数完整文件；
- 调用它的上游；
- 它调用的下游；
- 相关 schema/migration；
- 相关测试；
- 涉及跨域/架构/库存/财务/数据库时扩大到对应完整领域。

禁止根据旧聊天记忆代替仓库基线。

## 建议在 §3 前增加范围收口说明

当前首次架构基线任务为：

`DOCUMENTATION BASELINE → USER APPROVAL → CORE SCOPE CLEANUP AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE`

Core Scope Cleanup 的目标仅是安全移除已经明确 OUT_OF_SCOPE 的 Project/CRM 扩展，不允许顺手修改其它 ERP 业务。

完成 Scope Cleanup 和 Domain Alignment 后，继续按：

`MANUAL EXTRACTION → MODULE AUDIT/COVERAGE → GAP → REQUIREMENT → DESIGN → IMPLEMENTATION → ACCEPTANCE/FREEZE`

推进 B3101–B3122。

## Git 规则补充

- “把文档写入远端 GitHub”本质上也是 commit/push；未经用户明确授权，不得绕过本地 Git 流程直接调用远端文件写接口。
- 文档-only 任务同样要使用中文 commit，并在提交后报告分支、短 hash 与 package/release 版本是否变化。
