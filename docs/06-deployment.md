# 部署指南

## 目标环境
| 项目 | 配置 |
|------|------|
| 云服务器 | 腾讯云轻量应用服务器 Lighthouse |
| 操作系统 | Ubuntu 22.04 LTS |
| 数据库 | SQLite 3（应用内置，无需独立服务） |
| 后端 | Node.js 22 LTS |
| 前端托管 | Nginx |
| 部署方式 | Git代码拉取 |
| 进程管理 | systemd |

---

## 1. 服务器准备

### 1.1 系统更新
```bash
sudo apt update && sudo apt upgrade -y
```

### 1.2 安装基础软件
```bash
sudo apt install -y curl git vim
```

### 1.3 安装Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

### 1.4 安装pnpm
```bash
sudo npm install -g pnpm
pnpm --version
```

---

## 2. SQLite 数据库路径

本项目使用 SQLite 作为生产数据库，**无需独立数据库服务**。

### 2.1 生产数据库路径约定

生产环境数据库必须与应用源代码分离：

```bash
sudo mkdir -p /var/lib/modern-erp
sudo useradd -r -d /opt/modern-erp -s /bin/false modern-erp || true
sudo chown modern-erp:modern-erp /var/lib/modern-erp
sudo chmod 750 /var/lib/modern-erp
```

数据库路径由 `ERP_DB_PATH` 环境变量指定（推荐绝对路径）：

```bash
# /etc/modern-erp/env
ERP_DB_PATH=/var/lib/modern-erp/erp.db
```

### 2.2 不要将数据库放在项目源代码目录

`./data/erp.db`（开发默认）不应作为生产路径，否则：
- Git 拉取可能覆盖或暴露数据
- 应用升级时容易误删
- 备份策略复杂

---

## 3. 应用部署

### 3.1 创建应用目录与专用用户
```bash
sudo mkdir -p /opt/modern-erp
sudo useradd -r -d /opt/modern-erp -s /bin/false modern-erp || true
sudo chown -R modern-erp:modern-erp /opt/modern-erp
sudo chmod 755 /opt/modern-erp
```

### 3.2 创建备份目录
```bash
sudo mkdir -p /var/backups/modern-erp
sudo chown modern-erp:modern-erp /var/backups/modern-erp
sudo chmod 750 /var/backups/modern-erp
```

### 3.3 创建环境配置目录
```bash
sudo mkdir -p /etc/modern-erp
sudo install -m 640 -o root -g modern-erp /dev/null /etc/modern-erp/env
```

最小权限原则：

| 路径 | 权限原则 |
|------|----------|
| `/opt/modern-erp` | 应用源码目录，`modern-erp` 运行用户至少可读并可进入目录 |
| `/var/lib/modern-erp` | 数据库目录，`modern-erp` 可读写 |
| `/var/backups/modern-erp` | 备份目录，`modern-erp` 可读写 |
| `/etc/modern-erp/env` | 环境变量文件，建议 `root:modern-erp` + `640`，只允许 root 和服务所需组读取 |

不要使用 `chown -R www-data:www-data`；本项目的服务用户固定为 `modern-erp`。

### 3.4 从Git拉取代码
```bash
sudo -u modern-erp git clone <your-repo-url> /opt/modern-erp
sudo -u modern-erp git -C /opt/modern-erp checkout <your-deploy-branch>
cd /opt/modern-erp
```

### 3.5 配置环境变量

环境变量由 systemd `EnvironmentFile` 提供（`/etc/modern-erp/env`），不在项目目录中创建 `.env`。

```bash
sudo nano /etc/modern-erp/env
```

最小生产配置示例：

```bash
NODE_ENV=production
PORT=3001
ERP_DB_PATH=/var/lib/modern-erp/erp.db
ERP_BACKUP_DIR=/var/backups/modern-erp
SESSION_HOURS=12
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
TOKEN_LENGTH=32
ERP_SEED_DEMO=false
```

**重要**：
- `NODE_ENV=production` 配合 `ERP_SEED_DEMO=false` 禁止自动创建弱密码演示账号
- 首个管理员账号需通过 `scripts/setup-admin.mjs` 显式创建（见 §7）
- 应用不引入 dotenv；环境变量由 systemd `EnvironmentFile` 注入
- `/etc/modern-erp/env` 至少包含当前实际使用的 session/login 配置：`SESSION_HOURS`、`LOGIN_MAX_ATTEMPTS`、`LOGIN_LOCK_MINUTES`、`TOKEN_LENGTH`

### 3.6 安装依赖和构建
```bash
sudo -u modern-erp pnpm install --prod
sudo -u modern-erp pnpm build
```

---

## 4. systemd 服务与备份调度

本阶段提供以下 systemd 文件：

| 文件 | 作用 |
|------|------|
| `deploy/systemd/modern-erp.service` | 主应用服务 |
| `deploy/systemd/modern-erp-backup.service` | 一次性数据库备份服务 |
| `deploy/systemd/modern-erp-backup.timer` | 每日备份 timer |

### 4.1 主应用服务

`modern-erp.service` 使用专用用户运行：

- `User=modern-erp`
- `Group=modern-erp`
- `WorkingDirectory=/opt/modern-erp`
- `EnvironmentFile=/etc/modern-erp/env`
- `ExecStart=/usr/bin/node server/index.js`
- `Restart=on-failure`
- `KillSignal=SIGTERM`

Node 服务继续监听 `127.0.0.1:3001`，不对公网地址直接监听。systemd 默认停止流程发送 SIGTERM，与 `server/index.js` 中的 graceful shutdown 兼容。

### 4.2 备份服务

`modern-erp-backup.service` 是 `Type=oneshot`，以 `modern-erp` 用户执行：

```bash
/usr/bin/node scripts/backup-db.mjs
```

该服务只调用已验证的 `backup-db.mjs`，不调用 restore，不停止 ERP 主服务。

### 4.3 每日备份 timer

`modern-erp-backup.timer` 使用 systemd timer 每天凌晨 02:30 执行一次备份：

```ini
OnCalendar=*-*-* 02:30:00
Persistent=true
Unit=modern-erp-backup.service
```

`Persistent=true` 用于服务器重启后补跑错过的备份任务。本阶段不增加复杂 retention policy；备份保留策略后续单独处理。

### 4.4 安装 systemd 文件

以下命令需在 Ubuntu 服务器上执行；不要在 Windows 开发环境运行 `systemctl`：

```bash
sudo cp deploy/systemd/modern-erp.service /etc/systemd/system/
sudo cp deploy/systemd/modern-erp-backup.service /etc/systemd/system/
sudo cp deploy/systemd/modern-erp-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now modern-erp.service
sudo systemctl enable --now modern-erp-backup.timer
```

如果服务器安装了 `systemd-analyze`，上线前应执行：

```bash
systemd-analyze verify /etc/systemd/system/modern-erp.service
systemd-analyze verify /etc/systemd/system/modern-erp-backup.service
systemd-analyze verify /etc/systemd/system/modern-erp-backup.timer
```

当前仓库只做静态验证；Ubuntu 运行时验证仍需在目标服务器完成。

---

## 5. Demo 数据与重置

### 5.1 演示账号默认禁用

启动空数据库时，**生产环境不会**自动创建以下账号（`admin/admin123`、`sales/sales123` 等）。

仅当 `ERP_SEED_DEMO=true` 显式启用时，才会创建演示账号与演示业务数据。

### 5.2 pnpm reset-data 保护

`pnpm reset-data` 在 `NODE_ENV=production` 下立即退出并返回错误，不会删除任何文件。

```bash
$ NODE_ENV=production pnpm reset-data
错误：生产环境禁止执行 reset-data。
```

开发 / 测试环境正常使用此命令清理本地演示数据。

---

## 6. 数据库备份与恢复

### 6.1 备份工具

跨平台 Node 脚本：

```bash
pnpm backup-db
# 或显式指定：
ERP_DB_PATH=/var/lib/modern-erp/erp.db \
ERP_BACKUP_DIR=/var/backups/modern-erp \
node scripts/backup-db.mjs
```

行为：
- 读取 `ERP_DB_PATH`（默认 `<repo>/data/erp.db`）
- 读取 `ERP_BACKUP_DIR`（默认 `<repo>/backups`，生产推荐 `/var/backups/modern-erp`）
- 文件名格式：`erp-YYYYMMDD-HHmmss.db`
- 不覆盖已存在的备份文件
- 使用 SQLite `VACUUM INTO` 生成一致快照（WAL 自动合入）
- 备份完成后执行 `PRAGMA integrity_check`，必须返回 `ok`
- 文件大小必须 > 0
- 默认保留最近 30 个备份（`ERP_BACKUP_RETENTION` 可调）
- 失败返回 non-zero exit code

### 6.2 恢复工具

```bash
pnpm restore-db -- <backup-file>
# 或：
node scripts/restore-db.mjs /var/backups/modern-erp/erp-20260831-130000.db
```

行为：
- 验证备份文件存在且大小 > 0
- 打开备份执行 `PRAGMA integrity_check`，必须返回 `ok`
- 拒绝目标数据库与备份相同（防止覆盖运行中 DB）
- 创建 safety 备份至 `ERP_BACKUP_DIR/safety-YYYYMMDD-HHmmss.db`
- 清理目标 DB 的旧 `-wal` / `-shm`
- 用 `VACUUM INTO` 重建目标 DB
- 恢复后再次 `PRAGMA integrity_check`
- **生产环境必须显式传入 `--confirm-restore`**，否则拒绝执行（避免自动化场景误操作）

### 6.3 生产恢复流程

完整生产恢复应在维护窗口执行：

```bash
# 1. 停止服务
sudo systemctl stop modern-erp

# 2. 创建 safety 备份（脚本自动完成）
# 3. 执行恢复（生产环境必须显式确认）
sudo -u modern-erp NODE_ENV=production \
  node scripts/restore-db.mjs /var/backups/modern-erp/erp-20260831-130000.db \
  --confirm-restore

# 4. 启动服务
sudo systemctl start modern-erp

# 5. 健康检查
curl http://127.0.0.1:3001/api/health
```

---

## 7. 首次管理员初始化

Phase 2A 起,生产环境空 DB 不再自动创建演示账号。生产部署完成并首次启动服务创建 schema 后,运维需显式运行 `setup-admin` 创建首个管理员。

```bash
# 完整生产初始化流程（首次部署或新建数据库后）
cd /opt/modern-erp
sudo -u modern-erp \
  ERP_DB_PATH=/var/lib/modern-erp/erp.db \
  node scripts/setup-admin.mjs \
  --username admin \
  --password 'Strong-Production-Pwd-2026!'
```

**安全规则**：
- `username` 与 `password` 均为必填
- 密码至少 12 个字符
- 拒绝已知弱密码（`admin123` / `sales123` / `warehouse123` / `accounting123` / `review123` / `admin` / `password` / `123456` / `12345678` / `qwerty` 等）
- 用户已存在时拒绝覆盖
- admin role(ADMIN)不存在时明确失败
- 不向 stdout / stderr 输出明文密码
- 不写入日志或文件
- 失败返回 non-zero exit code

**允许在 `NODE_ENV=production` 下运行** —— 这是生产初始化工具。但**必须显式调用**,应用正常启动(`pnpm start`)绝不能自动执行。

CLI 用法：

```bash
node scripts/setup-admin.mjs --username <name> --password '<secret>'
# 或
pnpm setup-admin -- --username <name> --password '<secret>'
```

完整生产初始化序列：

```bash
# 1. 部署应用
cd /opt/modern-erp
sudo -u modern-erp git pull
sudo -u modern-erp pnpm install --prod
sudo -u modern-erp pnpm build

# 2. 首次启动（创建空 DB + schema）
sudo systemctl start modern-erp.service

# 3. 创建首个管理员
sudo -u modern-erp node scripts/setup-admin.mjs \
  --username admin \
  --password 'Strong-Production-Pwd-2026!'

# 4. 健康检查
curl http://127.0.0.1:3001/api/health

# 5. 登录并验证
# 通过 Web UI 或 curl /api/auth/login 登录 admin
```

---

## 8. 待补章节（后续任务）

以下章节尚未在本 Phase 范围实现，将在后续 Phase 补齐：

- Nginx 反向代理配置
- HTTPS / certbot 配置
- 监控与日志
- 防火墙 / 安全组规则
