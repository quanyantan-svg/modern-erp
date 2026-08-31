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
| 进程管理 | systemd（Phase 2C 引入，当前文档不涉及） |

---

## 1. 服务器准备

### 1.1 系统更新
```bash
sudo apt update && sudo apt upgrade -y
```

### 1.2 安装基础软件
```bash
sudo apt install -y curl git vim nginx certbot python3-certbot-nginx
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
sudo chown erp:erp /var/lib/modern-erp
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
sudo useradd -r -d /opt/modern-erp -s /bin/bash erp
sudo chown -R erp:erp /opt/modern-erp
```

### 3.2 从Git拉取代码
```bash
sudo -u erp git clone <your-repo-url> /opt/modern-erp
sudo -u erp git checkout <your-deploy-branch>
cd /opt/modern-erp
```

### 3.3 配置环境变量

环境变量由 systemd EnvironmentFile 提供（`/etc/modern-erp/env`），不在项目目录中创建 `.env`。

```bash
sudo mkdir -p /etc/modern-erp
sudo nano /etc/modern-erp/env
```

最小生产配置示例：

```bash
NODE_ENV=production
PORT=3001
ERP_DB_PATH=/var/lib/modern-erp/erp.db
SESSION_HOURS=12
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
TOKEN_LENGTH=32
ERP_SEED_DEMO=false
```

**重要**：
- `NODE_ENV=production` 配合 `ERP_SEED_DEMO=false` 禁止自动创建弱密码演示账号
- 首个管理员账号需通过外部初始化流程创建（Phase 2C 处理）
- 应用不引入 dotenv；环境变量由 systemd EnvironmentFile / 启动脚本注入

### 3.4 安装依赖和构建
```bash
sudo -u erp pnpm install --prod
sudo -u erp pnpm build
```

---

## 4. Demo 数据与重置

### 4.1 演示账号默认禁用

启动空数据库时，**生产环境不会**自动创建以下账号（`admin/admin123`、`sales/sales123` 等）。

仅当 `ERP_SEED_DEMO=true` 显式启用时，才会创建演示账号与演示业务数据。

### 4.2 pnpm reset-data 保护

`pnpm reset-data` 在 `NODE_ENV=production` 下立即退出并返回错误，不会删除任何文件。

```bash
$ NODE_ENV=production pnpm reset-data
错误：生产环境禁止执行 reset-data。
```

开发 / 测试环境正常使用此命令清理本地演示数据。

---

## 5. 数据库备份与恢复

### 5.1 备份工具

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

### 5.2 恢复工具

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

### 5.3 生产恢复流程

完整生产恢复应在维护窗口执行：

```bash
# 1. 停止服务（Phase 2C 由 systemd 接管）
sudo systemctl stop modern-erp

# 2. 创建 safety 备份（脚本自动完成）
# 3. 执行恢复（生产环境必须显式确认）
sudo -u erp NODE_ENV=production \
  node scripts/restore-db.mjs /var/backups/modern-erp/erp-20260831-130000.db \
  --confirm-restore

# 4. 启动服务
sudo systemctl start modern-erp

# 5. 健康检查
curl http://127.0.0.1:3001/api/health
```

---

## 6. 待补章节（Phase 2C / 后续任务）

以下章节尚未在本 Phase 范围实现，将在后续 Phase 补齐：

- 进程管理（systemd unit 模板）
- Nginx 反向代理配置
- 备份调度（systemd timer / cron）
- HTTPS / certbot 配置
- 首次管理员初始化流程（Phase 2C）
- 监控与日志
- 防火墙 / 安全组规则