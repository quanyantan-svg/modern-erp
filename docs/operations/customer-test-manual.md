# Modern ERP 用户测试手册

- 用途：为腾讯云客户测试环境提供登录、导航、核心业务测试、问题反馈与安全使用说明。
- Owner：Platform / 项目交付负责人。
- 状态：`DRAFT`（待客户测试反馈后修订）。
- 权威来源：本文件及同目录 `.docx` / `.pdf` 是 `document.md` §36.22 `PL-UX-09/10` 的交付物；业务规则仍以 `document.md`、各 Domain Requirement 与 Design 为准，本手册不构成新的业务合同，也不替代 `docs/status/PROJECT_STATUS.md`。
- 适用构建：`v1.7.0-rc.5`（Git tag `v1.7.0-rc.5` / commit `b7d8408`；客户测试环境为 MySQL 8）。版本号在生成时从 `package.json` 读取，不另抄一份。
- 生成方式：

  ```bash
  "/d/Program Files/Anaconda3/python.exe" scripts/docs/build-customer-test-manual.py
  "/c/Program Files/LibreOffice/program/soffice.exe" --headless --convert-to pdf \
    --outdir docs/operations "docs/operations/Modern-ERP-用户测试手册-DRAFT-v1.7.0-rc.5.docx"
  ```

  PDF 由**同一份 DOCX** 经 LibreOffice 26.8.0.3 导出；逐页复核用 PyMuPDF 渲染 PNG，产物落在 `tmp/`（不入库）。

交付文件：

- `Modern-ERP-用户测试手册-DRAFT-v1.7.0-rc.5.docx`
- `Modern-ERP-用户测试手册-DRAFT-v1.7.0-rc.5.pdf`

## 逐页复核记录（2026-11-18）

| 项 | 结果 |
|---|---|
| 页数 | 9 页（612 × 792 pt，与 rc.4 同版式） |
| 生成器 | LibreOffice 26.8.0.3（writer_pdf_Export），与 rc.4 同一渲染链路 |
| 封面 | 适用版本 `v1.7.0-rc.5`、文档状态 `DRAFT`、Owner、发布日期、账号由管理员另行提供 |
| 目录与章节 | 1–8 章齐全；第 4 章含 O2C / P2P / Plan-to-Produce / Plan-to-Outsource / R2R 与库存追溯 |
| 排版复核 | 逐页渲染 PNG 目视：标题、步骤、表格、页码、页脚无截断、重叠或溢出 |
| 敏感信息 | 不含密码、Token、连接串或客户敏感数据 |

## 与上一版（rc.4）的差异

| 差异 | 说明 |
|---|---|
| 适用版本 | `v1.7.0-rc.4` → `v1.7.0-rc.5` |
| 快速上手 | 「五分钟快速上手」改为「十分钟快速上手」，与 `PL-UX-09` 的措辞一致 |
| 新增章节 | 4.5 委外加工（Plan to Outsource）、4.6 记录到报告（Record to Report）；原 4.5 库存与追溯顺延为 4.7 |
| 测试清单 | 增加「按岗位完成委外加工验证」 |

rc.5 相对 rc.4 的服务端变更（VMI 结算机制与 `COGS_TO_GL` 期望侧扩展）没有新增操作员工作面，因此本手册的用户可见内容不变；变化只体现在版本身份与上表所列的测试路径补齐。

注意：手册不包含真实密码、Token、数据库连接串或客户敏感数据。测试网址与初始账号由项目管理员通过安全渠道另行提供。
