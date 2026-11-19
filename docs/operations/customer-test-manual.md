# Modern ERP 用户测试手册

- 用途：为腾讯云客户测试环境提供登录、导航、岗位任务、核心流程、移动端测试、故障排查与反馈说明。
- Owner：Platform / 项目交付负责人。
- 状态：`DRAFT`（待客户测试反馈后修订）。
- 权威来源：本文件及同目录 DOCX / PDF 是 `document.md` §36.22 `PL-UX-09/10` 的交付物；业务规则仍以 `document.md`、各 Domain Requirement 与 Design 为准，不替代 `docs/status/PROJECT_STATUS.md`。
- 适用构建：`v1.7.0-rc.5` / 交付提交 `84d654f`（含页面实现 `a428501` 与高级页面业务参照收口 `1aff926`）。
- 交付身份（2026-11-19 由项目管理员核验）：客户测试环境已部署至运行时代码 `51931b6`、
  仓库检出 `84d654f`；`live`/`ready` 经应用端口与 Nginx 均 200，权威结账 24 项 BLOCKING 检查
  0 失败，93 个路由 × 5 角色共 202 个组合的全路由巡检 0 问题。
  **访问地址与账号口令仍由管理员另行安全发送**，本文件不写入公网地址。

## 交付文件

- `Modern-ERP-用户测试手册-DRAFT-v1.7.0-rc.5.docx`
- `Modern-ERP-用户测试手册-DRAFT-v1.7.0-rc.5.pdf`

## 内容范围

- 测试环境、安全与账号要求；
- 十分钟登录、导航、刷新与退出；
- 销售、计划、采购、仓库、生产/质量、财务/会计、管理员的岗位起点与结束标志；
- O2C、P2P、Plan-to-Produce、Plan-to-Outsource、R2R、库存与追溯核心流程；
- 信用档案、信用检查/特批、信用评估；
- 320 / 390 / 430 / 680 CSS px 窄屏测试；
- 问题反馈模板、严重级别、常见问题排查；
- 九大业务域导航速查与当前测试边界。

## 生成与视觉复核

```powershell
& 'D:\Program Files\Anaconda3\python.exe' scripts/docs/build-customer-test-manual.py
```

PDF 由同一份 DOCX 通过 LibreOffice 导出；2026-11-19 复核结果为 13 页。所有页面已渲染为 PNG 目视检查，未发现文字裁切、对象重叠、表格越界或页脚丢失。手册不含密码、Token、数据库连接串或客户敏感数据。
