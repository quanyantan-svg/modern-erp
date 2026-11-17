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

仓库的 `pnpm-workspace.yaml` 明确支持 Windows x64 开发机和 Linux x64 生产机；锁文件必须保留对应的 Rollup 可选原生包。Linux 主机必须使用受版本控制的配置和 `--frozen-lockfile`，不得在部署目录临时改写架构列表或降级为非冻结安装。

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
    ERP_ATTACHMENT_DIR=/var/lib/modern-erp/attachments
    HTTP_ATTACHMENT_LIMIT_BYTES=10485760

`ERP_ATTACHMENT_DIR` 在 MySQL 部署中**必须**显式设置：附件是持久化数据，未设置时会回落到
release 目录内的 `data/attachments`，既违反本文第 9 节的目录约定，也通常不可写。
`HTTP_ATTACHMENT_LIMIT_BYTES`（默认 10 MiB，上限 50 MiB）必须不大于 Nginx 的
`client_max_body_size`，否则大附件会在到达应用之前被代理拒绝。

### 4.1 MySQL 8 生产路径

    ERP_DB_BACKEND=mysql
    ERP_DB_HOST=127.0.0.1
    ERP_DB_PORT=3306
    ERP_DB_NAME=modern_erp
    ERP_DB_USER=modern_erp
    ERP_DB_PASSWORD=<provided-through-secure-secret-management>
    ERP_DB_SSL=false
    ERP_DB_SSL_REJECT_UNAUTHORIZED=true

MySQL 参数不完整时应用会 fail closed。**首次启动时目标库必须是空库**：schema bootstrap 会拒绝
在已初始化的库上重建，并需要 `CREATE` / `ALTER` 权限；后续升级只执行受支持的幂等步骤。
数据库账号应使用最小权限并限制网络来源。当前仓库提供 MySQL schema bootstrap、兼容 gate 和并发 gate，但没有可直接宣称为生产方案的 MySQL 备份/恢复自动化；该缺口已登记在
[`docs/status/PROJECT_STATUS.md`](../../docs/status/PROJECT_STATUS.md) §62（含 RPO / RTO / 异机保存 / 演练频率的业务裁定），
上线前必须由运维独立定义、演练并记录备份、恢复、升级和回滚方案。

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

仅在使用 SQLite 且备份路径已验证时安装 backup service/timer。MySQL 环境不得把该 timer 当成 MySQL 备份方案；
备份单元带 `ExecCondition`，在 `ERP_DB_BACKEND=mysql` 时直接跳过而不是每晚失败一次。
主服务与备份单元均已启用 `network-online.target` 与基础 systemd 硬化（`NoNewPrivileges`、
`PrivateTmp`、`ProtectSystem=full` 等）；数据目录必须对 `modern-erp` 用户可写。

## 6. Nginx

仓库配置 `deploy/nginx/modern-erp.conf` 将所有请求代理到 `http://127.0.0.1:3001`。启用前运行：

    sudo nginx -t
    sudo systemctl reload nginx

配置要点：

- `client_max_body_size 12m` 必须不小于应用的 `HTTP_ATTACHMENT_LIMIT_BYTES`（默认 10 MiB）；
- `gzip on` 覆盖 JSON 与静态资源；Node 侧本身不压缩；
- `X-Forwarded-For` 透传 `$remote_addr`（不使用 `$proxy_add_x_forwarded_for`）：客户端可以自带
  该头，其首段是伪造的；应用侧优先取 `X-Real-IP`，其次取 `X-Forwarded-For` 末段。

应用使用 hash 路由，因此 Nginx **不需要** SPA fallback 规则；Node 服务自身在缺少路径时回落到
`index.html`，`/assets/` 下的缺失文件返回 404（不回落，避免浏览器把 HTML 当脚本执行）。

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

- SQLite 备份：确认 `ERP_DB_PATH` 与 `ERP_BACKUP_DIR` 指向持久化目录后运行 `pnpm backup-db`。脚本使用 `VACUUM INTO` 创建一致快照、执行 `integrity_check`，并按 `ERP_BACKUP_RETENTION` 清理旧备份。
- SQLite 恢复：这是破坏性生产数据操作，须先取得批准并进入维护窗口。停止 `modern-erp.service`，再次核对目标 `ERP_DB_PATH`，再运行 `NODE_ENV=production pnpm restore-db -- <backup-file> --confirm-restore`；脚本会先校验来源、创建 safety backup、替换数据库并再次执行完整性检查。成功后重启服务并检查 live/ready。不要在服务仍写入数据库时恢复。
- MySQL：使用组织批准的 MySQL 工具和 runbook；当前 SQLite 脚本不适用。
- Schema 初始化与兼容迁移由 `server/index.js` 创建数据库连接时自动执行：SQLite 运行基础 schema 与幂等迁移链；MySQL 运行 schema bootstrap，并对已初始化数据库执行当前受支持的幂等升级步骤。发布前必须先备份；迁移失败应阻止启动，不应通过手工改表或 reset-data 绕过。
- 持久化数据不得放在 release 目录中：SQLite 使用 `/var/lib/modern-erp/erp.db`，备份使用 `/var/backups/modern-erp`；前端构建产物是 `/opt/modern-erp/dist`，由 Node 服务提供并经 Nginx 反向代理。
- 发布前：确认目标 commit/tag、环境变量权限、数据库备份、迁移策略、回滚方案、`pnpm test`、`pnpm build`、systemd 和 Nginx 配置。
- 发布后：检查 live/ready、登录、关键只读查询、结构化日志和反向代理。

部署、生产数据操作、恢复、push、tag 和 Git 历史重写均需要明确授权。
## 10. 腾讯云轻量应用服务器部署执行清单（MySQL 8）

本节把 §1–§9 落到**腾讯云轻量应用服务器（Lighthouse）**这一具体目标环境上。
它是**执行清单**，不是新合同：所有前置条件、禁止事项与授权要求仍以 §4.1、§7、§9
与 `AGENTS.md` §13 为准。仓库只提供模板；**模板存在不等于目标环境就绪**。

> 本节尚未在任何真实腾讯云主机上执行过。按 `PL-RI-05`（Requirement §36.16.6），
> 目标环境的 preflight 证据必须现场采集，见 §10.10。

### 10.1 目标形态

| 项 | 值 |
|---|---|
| 实例 | 腾讯云轻量应用服务器（Lighthouse），Ubuntu 22.04 LTS 镜像 |
| 规格 | 建议 2 vCPU / 4 GiB / 60 GiB SSD；纯测试用途可下调，但 `pnpm build` 需要 ≥ 2 GiB 可用内存 |
| 系统盘 | 60 GiB SSD；应用 `/opt/modern-erp`、数据 `/var/lib/modern-erp`、备份 `/var/backups/modern-erp` 分区或目录隔离 |
| 运行时 | Node.js 22.23.2、pnpm（`corepack enable`）、Nginx、MySQL 8 |
| 数据库 | MySQL 8，**仅监听 127.0.0.1**；应用与 MySQL 同机，通过本地 socket/回环连接 |
| 对象存储 | 腾讯云 COS（S3 兼容），作为 MySQL 逻辑备份的异机副本（`PL-RI-01`） |

### 10.2 安全组（腾讯云控制台）—— 第一道门

安全组是**云侧**防火墙，与主机内 `ufw` 是两层，**两层都要配**。

| 端口 | 来源 | 用途 |
|---|---|---|
| 22 | **只允许你的固定办公出口 IP**（不要填 `0.0.0.0/0`） | SSH 运维 |
| 80 | `0.0.0.0/0` | HTTP → HTTPS 跳转（TLS 生效后仍保留，仅作跳转） |
| 443 | `0.0.0.0/0` | HTTPS 业务访问 |
| 3306 | **不开放** | MySQL 只连回环 |

- **绝不开 3001**：应用端口只由 Nginx 在本机反代。
- **绝不开 22 给 `0.0.0.0/0`**：轻量服务器默认安全组常常如此，必须收窄。
- 主机内另配 `ufw`（`ufw default deny incoming`、`ufw allow 22/tcp`、`80/tcp`、`443/tcp`），
  `ufw` 放行后再 `ufw enable`；SSH 规则加好并确认可回连后再启用，避免把自己锁在门外。

### 10.3 主机初始化

```bash
# 1) 系统与依赖
sudo apt update && sudo apt -y upgrade
sudo apt -y install nginx mysql-server git curl

# 2) Node.js 22.23.2（使用受版本控制的安装方式，不要用系统自带版本）
corepack enable
corepack prepare pnpm@<受支持的 pnpm 版本> --activate

# 3) 服务用户与目录
sudo useradd --system --home /opt/modern-erp --shell /usr/sbin/nologin modern-erp
sudo useradd --system --home /var/backups/modern-erp --shell /usr/sbin/nologin modern-erp-backup
sudo mkdir -p /opt/modern-erp /var/lib/modern-erp/attachments /var/backups/modern-erp/mysql/manifests /etc/modern-erp
sudo chown -R modern-erp:modern-erp /opt/modern-erp /var/lib/modern-erp
sudo chown -R modern-erp-backup:modern-erp-backup /var/backups/modern-erp
sudo chmod 0640 /etc/modern-erp/env   # 归属 root:modern-erp
```

`modern-erp` 与 `modern-erp-backup` **必须是两个账号**：备份单元只读数据库 + 对象存储最小 prefix 权限，
不具备恢复权限，也不复用应用服务身份（见 `deploy/systemd/modern-erp-mysql-backup.service`）。

### 10.4 MySQL 8 初始化

```bash
# 1) 绑定回环，禁止 TCP 公网监听
sudo sed -i 's/^bind-address.*/bind-address = 127.0.0.1/' /etc/mysql/mysql.conf.d/mysqld.cnf
sudo systemctl restart mysql

# 2) 建库与最小权限账号（密码由你提供，不要写进仓库或命令历史）
sudo mysql -e "CREATE DATABASE modern_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'modern_erp'@'127.0.0.1' IDENTIFIED BY '<provided-securely>';"
sudo mysql -e "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, TRIGGER ON modern_erp.* TO 'modern_erp'@'127.0.0.1';"
sudo mysql -e "FLUSH PRIVILEGES;"
```

**必须满足的硬约束**：

1. **目标库必须是空库**。schema bootstrap 会拒绝在已初始化的库上重建；带数据的库会导致首启失败。
2. **账号需要 `CREATE` / `ALTER` 权限**：首装由应用自建 schema。
3. MySQL 8 的 `caching_sha2_password` 与 Node 驱动兼容性：若连接报认证错误，
   把账号改为 `mysql_native_password`（`ALTER USER 'modern_erp'@'127.0.0.1' IDENTIFIED WITH mysql_native_password BY '...'`）。
4. **`log_bin_trust_function_creators=1`**：`server/database/mysql-schema.js` 会创建触发器，
   MySQL 8 默认禁止创建触发器时使用非 SUPER 账号。持久化到 `/etc/mysql/mysql.conf.d/mysqld.cnf`：

   ```ini
   [mysqld]
   log_bin_trust_function_creators = 1
   ```

   该参数是**运行时**项，重启 MySQL 后会失效 —— 改完必须 `sudo systemctl restart mysql`。
5. 备份单元还需要一个**只读**账号（用于 `mysqldump`），与上面的应用账号分开。

### 10.5 环境变量文件

写入 `/etc/modern-erp/env`（`root:modern-erp`、`0640`）：

```bash
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
ERP_SEED_DEMO=false

ERP_DB_BACKEND=mysql
ERP_DB_HOST=127.0.0.1
ERP_DB_PORT=3306
ERP_DB_NAME=modern_erp
ERP_DB_USER=modern_erp
ERP_DB_PASSWORD=<provided-securely>
ERP_DB_SSL=false

ERP_ATTACHMENT_DIR=/var/lib/modern-erp/attachments
HTTP_ATTACHMENT_LIMIT_BYTES=10485760

SESSION_HOURS=12
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
TOKEN_LENGTH=32

# MySQL 逻辑备份 + COS 异机副本（PL-RI-01，Requirement §36.16.2）
ERP_DR_S3_ENDPOINT=https://cos.<region>.myqcloud.com
ERP_DR_S3_BUCKET=<bucket>
ERP_DR_S3_REGION=<region>
ERP_DR_S3_ACCESS_KEY_ID=<provided-securely>
ERP_DR_S3_SECRET_ACCESS_KEY=<provided-securely>
ERP_DR_S3_PREFIX=modern-erp/dr/
```

- 应用**不读** dotenv；变量只由 systemd `EnvironmentFile` 注入。
- **不要**把密码、密钥、COS 凭据写进仓库、部署脚本、命令行历史或工单。
- `ERP_DR_S3_ENDPOINT` 必须是 **HTTPS**（`scripts/admin/lib/mysql-dr.mjs` 的 `validateBackupConfig` 会 fail closed）。
- `ERP_ATTACHMENT_DIR` **必须**显式设置：缺省会回落到 release 目录内的 `data/attachments`，通常不可写。
- `HTTP_ATTACHMENT_LIMIT_BYTES`（10 MiB）**不得大于** Nginx 的 `client_max_body_size`（模板为 `12m`）。

### 10.6 发布应用

```bash
sudo -u modern-erp git clone <repo-url> /opt/modern-erp   # 或以 tar 包交付
cd /opt/modern-erp
sudo -u modern-erp git checkout <approved-commit-or-tag>
sudo -u modern-erp corepack enable
sudo -u modern-erp pnpm install --frozen-lockfile
sudo -u modern-erp pnpm test
sudo -u modern-erp pnpm build
```

- 使用**受批准的 commit 或 release tag**；既有 release tag 不得移动、删除或重建。
- 锁文件必须保留 Linux x64 的 Rollup 可选原生包，**不得**在部署目录临时改写架构列表或降级为非冻结安装。
- `dist/` 由 Node 服务提供（见 §6），Nginx 只做反向代理。

### 10.7 首个管理员

```bash
cd /opt/modern-erp
sudo -u modern-erp pnpm setup-admin -- --username <operator-name> --password '<provided-securely>'
```

- 必须**先**让服务完成一次 schema 初始化（§10.8 启动后）再执行本命令。
- 生产必须保持 `ERP_SEED_DEMO=false`；不要用演示账号做正式管理员。
- 不要把真实密码写进可分享的命令、工单或日志。

### 10.8 systemd 与 Nginx

```bash
sudo cp deploy/systemd/modern-erp.service /etc/systemd/system/
sudo cp deploy/systemd/modern-erp-mysql-backup.service /etc/systemd/system/
sudo cp deploy/systemd/modern-erp-mysql-backup.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/modern-erp.service
sudo systemctl daemon-reload
sudo systemctl enable --now modern-erp.service

sudo cp deploy/nginx/modern-erp.conf /etc/nginx/conf.d/modern-erp.conf
sudo nginx -t && sudo systemctl reload nginx
```

- **只**安装 MySQL 备份单元（`modern-erp-mysql-backup.*`）；SQLite 备份单元
  （`modern-erp-backup.*`）带 `ExecCondition`，在 `ERP_DB_BACKEND=mysql` 时会直接跳过，
  不要把它当成 MySQL 备份方案。
- TLS：用 `deploy/nginx/modern-erp-tls.conf.example` 作为模板，配置证书链、域名匹配与续期；
  HTTP 只做跳转，**不得**在公网裸跑明文业务流量。
- Nginx 模板已把 `X-Forwarded-For` 固定为 `$remote_addr`，**不要**改回 `$proxy_add_x_forwarded_for`
  —— 客户端可自带该头，其首段是伪造的，会污染登录锁定计数与审计记录的来源 IP。

### 10.9 MySQL 备份与异机副本

```bash
sudo systemctl enable --now modern-erp-mysql-backup.timer
systemctl list-timers modern-erp-mysql-backup.timer
sudo systemctl start modern-erp-mysql-backup.service     # 手工触发一次并看结果
journalctl -u modern-erp-mysql-backup.service -n 100 --no-pager
```

- RPO = 24 小时（每日一次逻辑备份，timer 为每日 03:15 + 最多 10 分钟随机延迟）；
  RTO = 4 小时；异机副本为 S3 兼容对象存储（腾讯云 COS）。
- 备份状态机固定为 `CONFIG_VALIDATED → SNAPSHOT_RUNNING → LOCAL_VERIFIED → UPLOADED
  → REMOTE_VERIFIED → RETENTION_APPLIED → COMPLETE`；**未到 `REMOTE_VERIFIED` 不得报告可恢复**。
- **上线前必须**额外跑一次演练型备份并做一次**恢复演练**（`--kind drill`）：
  在一个**隔离的 disposable 库**上恢复，核对表、行数、关键约束、视图、触发器与
  `live` / `ready`，证据存入 `docs/acceptance/`（不含密码、连接串或对象存储密钥）。
- 每季度一次恢复演练；证据与既有验收记录同生命周期。

### 10.10 上线验收清单（必须逐项留证）

仓库侧提供两个只读采集器，分别在**目标机**与**客户端**执行：

```bash
# 目标机：采集不可伪造的环境事实（只输出变量名，绝不输出值）
cd /opt/modern-erp && sudo -u modern-erp node scripts/admin/release-preflight.mjs --out /tmp/preflight.json --strict

# 客户端：验证 TLS、跳转、健康检查、鉴权边界、上传上限、真实客户端 IP
node scripts/admin/verify-release-target.mjs --host erp.example.com --upload-limit-bytes 12582912
```

手工复核项：

| # | 检查 | 通过标准 |
|---|---|---|
| 1 | `curl --fail http://127.0.0.1:3001/api/health/live` | 2xx |
| 2 | `curl --fail http://127.0.0.1:3001/api/health/ready` | 2xx（数据库就绪） |
| 3 | 经 Nginx 域名重复 1、2 | 2xx |
| 4 | 未认证访问 `/api/users` | **401**，不得 500 |
| 5 | 管理员登录 + 「系统设置 → 用户与权限 → 用户管理 → 新增用户」 | 能新增一个测试用户 |
| 6 | 附件上传 | 超过 `HTTP_ATTACHMENT_LIMIT_BYTES` 时 413，且不超过上限时成功 |
| 7 | 真实客户端 IP | 登录锁定与审计记录里的来源 IP 是你的真实出口 IP，不是被伪造的 `X-Forwarded-For` 首段 |
| 8 | `systemctl status modern-erp.service` | `active (running)`，无重启循环 |
| 9 | MySQL 备份 timer | `systemctl list-timers` 显示下次触发时间；手工触发一次成功 |
| 10 | 恢复演练 | 隔离库恢复成功且 `live` / `ready` 通过（证据入 `docs/acceptance/`） |
| 11 | 回滚演练 | 回到上一 release artifact + 发布前数据库快照，服务恢复（`PL-RI-05` 要求） |
| 12 | 安全组与 ufw 复核 | 3306 与 3001 **不可从公网访问**；22 仅允许固定出口 IP |

任一项缺证据时，只能标记 `PARTIAL`，**不得**宣称 production deploy ready
（Requirement §36.16.6）。

### 10.11 回滚

- 应用回滚：切回上一 commit / release tag → `pnpm install --frozen-lockfile` → `pnpm build`
  → `systemctl restart modern-erp` → 重跑 §10.10 的 1–3、5。
- 数据库回滚：**不做反向 DDL**。MySQL 侧迁移链只有 `CREATE TABLE` / `ALTER TABLE ADD COLUMN`
  / `ADD CONSTRAINT` / `CREATE TRIGGER`，没有 `DROP TABLE` / `DROP COLUMN` / `RENAME` / `TRUNCATE`
  （Requirement §36.16.2）。回滚路径 = **恢复发布前备份**：
  停止服务 → 恢复到隔离验证过的库 → 校验 → 切流量 → 重启 → 复跑 §10.10。
- 既有 release tag 不得移动、删除或重建。

### 10.12 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 首启即退出，日志报 schema 相关错误 | 目标库非空 | 必须是空库；换空库重试，**不要**手工改表或 reset-data 绕过 |
| 连接报认证失败 | MySQL 8 `caching_sha2_password` | 账号改 `mysql_native_password` |
| 创建触发器失败 | `log_bin_trust_function_creators` 未开 | 写入 mysqld.cnf 后 `restart mysql` |
| 大附件 413 | Nginx `client_max_body_size` 小于应用上限 | 模板为 `12m`，与应用 `10485760` 匹配；不要调小 |
| 附件写入失败 | 未设 `ERP_ATTACHMENT_DIR` | 显式设为 `/var/lib/modern-erp/attachments` 并 `chown modern-erp` |
| 备份任务每晚失败 | SQLite 备份 timer 被误当成 MySQL 方案 | 只安装 `modern-erp-mysql-backup.*` |
| 审计里的来源 IP 可被伪造 | Nginx 用了 `$proxy_add_x_forwarded_for` | 改回 `$remote_addr` |
| 本机连不上服务器 | 安全组把 3306 / 3001 放开了 | 关闭；应用与 MySQL 同机走回环 |
