# Modern ERP 部署指南

本文是当前专用运维指南。项目入口见 [README](../../README.md)，技术边界见 [solution.md](../../solution.md)。部署前必须根据目标环境完成备份、恢复和回滚演练；本文不构成未验证环境的容量承诺。

## 1. 目标架构

| 项目 | 当前约定 |
|---|---|
| 操作系统 | Ubuntu 22.04 LTS |
| Node.js | 22.23.2 |
| HTTP 服务 | Node.js 原生 HTTP，监听 `127.0.0.1:3001` |
| 反向代理 | Nginx |
| 服务管理 | systemd |
| 数据库 | MySQL 8 为目标生产路径；SQLite 保留本地、测试与兼容运行路径 |
| 包管理 | pnpm |

项目不使用 Express、Koa、PM2 或 `ecosystem.config.js`。生产 Node 进程同时提供 API、`dist/` 静态资源和 SPA fallback；Nginx 使用单一反向代理入口。

## 2. 主机与目录

安装 Node.js 22.23.2、pnpm、Git 和 Nginx，并创建专用服务用户。推荐路径：

    /opt/modern-erp             应用代码
    /etc/modern-erp/env         systemd EnvironmentFile
    /var/lib/modern-erp         SQLite 兼容运行数据（仅选择 SQLite 时）
    /var/backups/modern-erp     SQLite 备份（仅选择 SQLite 时）

应用以 `modern-erp` 用户运行。环境文件应由 `root:modern-erp` 持有并设置为 `0640`；真实密码、令牌和连接串不得写入仓库、部署脚本或命令历史。

## 3. 安装与构建

在 `/opt/modern-erp` 检出经过批准的 commit 或 release tag 后执行：

    corepack enable
    pnpm install --frozen-lockfile
    pnpm test
    pnpm build

生产启动命令为：

    node server/index.js

实际服务应由仓库中的 `deploy/systemd/modern-erp.service` 启动，不应在交互式 shell 中长期运行。

## 4. 环境配置

应用直接读取 `process.env`，不加载 dotenv。生产变量由 `/etc/modern-erp/env` 注入。

通用配置：

    NODE_ENV=production
    PORT=3001
    ERP_SEED_DEMO=false
    SESSION_HOURS=12
    LOGIN_MAX_ATTEMPTS=5
    LOGIN_LOCK_MINUTES=15
    TOKEN_LENGTH=32

### 4.1 MySQL 8 生产路径

    ERP_DB_BACKEND=mysql
    ERP_DB_HOST=127.0.0.1
    ERP_DB_PORT=3306
    ERP_DB_NAME=modern_erp
    ERP_DB_USER=modern_erp
    ERP_DB_PASSWORD=<provided-through-secure-secret-management>
    ERP_DB_SSL=false
    ERP_DB_SSL_REJECT_UNAUTHORIZED=true

MySQL 参数不完整时应用会 fail closed。数据库账号应使用最小权限并限制网络来源。当前仓库提供 MySQL schema bootstrap、兼容 gate 和并发 gate，但没有可直接宣称为生产方案的 MySQL 备份/恢复自动化；上线前必须由运维独立定义、演练并记录备份、恢复、升级和回滚方案。

### 4.2 SQLite 兼容路径

    ERP_DB_BACKEND=sqlite
    ERP_DB_PATH=/var/lib/modern-erp/erp.db
    ERP_BACKUP_DIR=/var/backups/modern-erp

SQLite 可用于本地、测试或经明确评估的兼容部署。数据库不得放入应用源码目录。`scripts/admin/backup-db.mjs` 和 `scripts/admin/restore-db.mjs` 仅适用于 SQLite，不得用于 MySQL。

## 5. systemd

仓库提供：

- `deploy/systemd/modern-erp.service`：主服务；
- `deploy/systemd/modern-erp-backup.service`：SQLite 一次性备份；
- `deploy/systemd/modern-erp-backup.timer`：SQLite 定时备份。

安装主服务：

    sudo cp deploy/systemd/modern-erp.service /etc/systemd/system/
    sudo systemd-analyze verify /etc/systemd/system/modern-erp.service
    sudo systemctl daemon-reload
    sudo systemctl enable --now modern-erp.service

仅在使用 SQLite 且备份路径已验证时安装 backup service/timer。MySQL 环境不得把该 timer 当成 MySQL 备份方案。

## 6. Nginx

仓库配置 `deploy/nginx/modern-erp.conf` 将所有请求代理到 `http://127.0.0.1:3001`。启用前运行：

    sudo nginx -t
    sudo systemctl reload nginx

公网只开放批准的 HTTP/HTTPS 端口；不要直接暴露 3001。TLS、证书续期、防火墙和云安全组必须按目标环境单独验收。

## 7. 健康检查

进程存活检查：

    curl --fail http://127.0.0.1:3001/api/health/live

数据库就绪检查：

    curl --fail http://127.0.0.1:3001/api/health/ready

再通过 Nginx 地址重复检查。健康接口不得返回数据库名、连接串、环境变量或秘密。

## 8. 首个管理员与演示数据

生产必须保持 `ERP_SEED_DEMO=false`。应用首次启动完成 schema 初始化后，使用显式管理命令创建首个管理员：

    pnpm setup-admin -- --username <operator-name> --password '<provided-securely>'

该稳定命令调用 `scripts/admin/setup-admin.mjs`；不要绕过命令中的密码强度、既有用户和 ADMIN 角色检查。

不要把真实密码直接写入可共享的命令、工单或日志。普通演示账号的安全说明见 [demo-accounts.md](./demo-accounts.md)。

## 9. 备份、恢复与发布检查

- SQLite：使用 `scripts/admin/backup-db.mjs` / `scripts/admin/restore-db.mjs`（或稳定的 `pnpm backup-db` / `pnpm restore-db` 命令），并在维护窗口验证完整性与 safety backup。
- MySQL：使用组织批准的 MySQL 工具和 runbook；当前 SQLite 脚本不适用。
- 发布前：确认目标 commit/tag、环境变量权限、数据库备份、迁移策略、回滚方案、`pnpm test`、`pnpm build`、systemd 和 Nginx 配置。
- 发布后：检查 live/ready、登录、关键只读查询、结构化日志和反向代理。

部署、生产数据操作、恢复、push、tag 和 Git 历史重写均需要明确授权。
