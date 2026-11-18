# 客户测试环境运维手册：TLS 与 MySQL 自动备份

> 适用范围：腾讯云客户测试环境 `129.204.51.149`（轻量应用服务器）。
> 权威状态：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §82.11。
> 本手册只记录**已实测**的配置与操作；未落地的部分明确标注。

## 1. 主机与共存约束

该机器是**共用**主机：除本系统外还运行 `calculator`（nginx → 8082）与
`pairbook-web`（systemd → 18088）。**任何动作只允许触及 `modern-erp` 单元与本系统自己的库。**

| 项 | 值 |
|---|---|
| 应用目录 | `/opt/modern-erp`（属主 `modern-erp`） |
| 应用单元 | `modern-erp.service`（`WorkingDirectory=/opt/modern-erp`，`EnvironmentFile=/etc/modern-erp/env`） |
| 应用监听 | `127.0.0.1:3001`（**仅回环**，不对公网暴露） |
| 对外入口 | nginx `:80` / `:443`（`/etc/nginx/conf.d/modern-erp.conf`） |
| 数据库 | MySQL 8.0.46，库 `modern_erp`（424 表 + 1 视图 + 5 触发器），`bind-address=127.0.0.1` |
| 数据库账号 | `modern_erp`@`127.0.0.1`（权限**仅限本库**，全局仅 `USAGE`）；`root` 走 `auth_socket` |
| 备份目录 | `/var/backups/modern-erp/mysql`（dump + `.manifest.json`） |

**MySQL 从不重启**：触发器需要的 `log_bin_trust_function_creators=1` 已用 `SET GLOBAL`
即时生效并写入 `/etc/mysql/mysql.conf.d/modern-erp.cnf`。重启 MySQL 前先确认该文件仍在。

## 2. TLS（HTTPS）

### 2.1 现状（2026-11-18 实测）

| 项 | 状态 |
|---|---|
| nginx `:443` 已配置并监听 | ✅（TLS 终止，`ssl_protocols TLSv1.2 TLSv1.3`） |
| 证书 | `/etc/nginx/tls/modern-erp.crt` / `.key` —— 当前为**自签**证书（SAN 含 `IP:129.204.51.149`），浏览器会提示"不受信任" |
| `:80` → `:443` 跳转 | **默认关闭**（`map $modern_erp_force_https` 的 `default 0`）——原因见 2.3 |
| ACME 质询路径 | `:80` 与 `:443` 均已直通 `/.well-known/acme-challenge/` → `/var/www/acme-challenge` |
| acme.sh | 已装在 `/opt/modern-erp/.acme.sh`（经 jsDelivr 镜像取得；GitHub raw 在本机不可达） |

### 2.2 切换到受信任证书（**需要先在腾讯云控制台放行 443**）

`:443` 目前被**腾讯云安全组**挡住（宿主防火墙 ufw inactive，iptables 仅拦 22 的爆破源，
不拦 443）。放行 443 后：

```bash
# 1) 签发（Let's Encrypt 的 IP 证书必须用 shortlived profile；default/tlsserver 不允许 IP）
sudo -u modern-erp bash -lc 'cd /opt/modern-erp && ~/.acme.sh/acme.sh --issue \
  --webroot /var/www/acme-challenge -d 129.204.51.149 \
  --server letsencrypt --keylength ec-256 --cert-profile shortlived'

# 2) 装入 nginx（acme.sh 的 --install-cert 可直接写到这里）
sudo -u modern-erp bash -lc 'cd /opt/modern-erp && ~/.acme.sh/acme.sh --install-cert \
  -d 129.204.51.149 --ecc --key-file /etc/nginx/tls/modern-erp.key \
  --fullchain-file /etc/nginx/tls/modern-erp.crt --reloadcmd "systemctl reload nginx"'

# 3) 打开跳转：把 /etc/nginx/conf.d/modern-erp.conf 里 map 的 default 改成 1，然后 reload
sudo -n nginx -t && sudo -n systemctl reload nginx
```

**自动续期**：shortlived 证书有效期仅 6 天，**必须**保留 acme.sh 的 cron。
本环境安装时用了 `--nocron`，恢复方式：

```bash
sudo -u modern-erp bash -lc 'cd /opt/modern-erp && ~/.acme.sh/acme.sh --install \
  --home /opt/modern-erp/.acme.sh --cron --force'
# 并把续期周期调到每 12 小时一次（6 天有效期下每天一次不够保险）：
sudo -u modern-erp bash -lc '~/.acme.sh/acme.sh --set-default-ca --server letsencrypt'
```

### 2.3 为什么跳转默认关闭

跳转开着时，`:80` 的访客会被 301 到 `:443`；而 `:443` 未放行时这个跳转会让**所有公网访客
直接打不开**。因此开关默认关闭，等 443 放行且证书受信任后再打开。

### 2.4 SSH 端口转发（浏览器直连公网 IP 被本机代理拦时的备用通道）

```bash
ssh -L 18080:127.0.0.1:80 ubuntu@129.204.51.149 -N
# 浏览器打开 http://127.0.0.1:18080
```

转发带 `Host: 127.0.0.1`，命中 `map` 的 `127.0.0.1 → 0`，因此**不**跳转 ✓。

## 3. MySQL 自动备份

### 3.1 组件

| 件 | 位置 | 作用 |
|---|---|---|
| 备份脚本 | `/usr/local/bin/mysql-backup-local.mjs` | 本地分支备份（见 3.3） |
| service | `/etc/systemd/system/modern-erp-backup.service` | `Type=oneshot`，`User=root`，`EnvironmentFile=/etc/modern-erp/env` |
| timer | `/etc/systemd/system/modern-erp-backup.timer` | 每天 02:17（`RandomizedDelaySec=30m`）、`Persistent=true` |

```bash
systemctl list-timers modern-erp-backup.timer
sudo systemctl start modern-erp-backup.service      # 手动跑一次
journalctl -u modern-erp-backup.service -n 20
```

### 3.2 导出身份：为什么用 root + unix socket

视图 `finance_open_item_effects` 的 `SHOWVIEW` 权限**无法授予他人**（MySQL 3619
"Illegal privilege level"），只有视图创建者能导出它。因此备份以 `root` + unix socket
运行（`Environment=ERP_BACKUP_DB_USER=root / ERP_BACKUP_DB_HOST=localhost`）；
应用自身的 `modern_erp` 账号**仍然只有本库权限** ✓（未给它任何额外权限）。

### 3.3 纪律

- 状态机 `SNAPSHOT_RUNNING → LOCAL_VERIFIED → ROTATION_APPLIED → COMPLETE`；
  任一步失败即非零退出。
- **新备份未通过哈希回读验证，绝不清理旧备份**；清理时逐个复核 manifest 的
  `status='LOCAL_VERIFIED'` 且文件哈希相符才删除。
- 失败时删除半成品 dump，避免下一次轮转把它当成有效备份。
- 保留策略：最近 **14** 份（`--keep 14`）。

### 3.4 恢复演练（**已实测通过**，2026-11-18）

```bash
LATEST=$(sudo ls -t /var/backups/modern-erp/mysql/modern-erp-*.sql | head -1)
sudo mysql -e "DROP DATABASE IF EXISTS modern_erp_restore_drill; \
                CREATE DATABASE modern_erp_restore_drill CHARACTER SET utf8mb4;"
sudo sh -c "mysql modern_erp_restore_drill < $LATEST"
sudo mysql -N -B modern_erp_restore_drill -e "
  SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='modern_erp_restore_drill' AND table_type='BASE TABLE';"
sudo mysql -e "DROP DATABASE modern_erp_restore_drill;"
```

实测结果：424 表 + 1 视图 + 5 触发器，`users` / `products` / `accounting_vouchers` /
`inventory_valuation_movements` / `inventory` 的行数与线上库**逐项一致** ✓。
（演练库在验证后即删除，不留残留。）

### 3.5 仍然开放

**异机副本未落地**：仓库的 canonical 备份 CLI（`scripts/admin/mysql-backup.mjs`）要求对象存储
（S3 / COS）到达 `REMOTE_VERIFIED` 才允许保留清理（`PL-RI-01`：RPO 24h / RTO 4h /
季度演练）。本环境尚无对象存储凭据，因此当前只有**本机副本** —— 磁盘故障会同时带走
数据与备份。凭据到位后应改用仓库 CLI 并配置：

```text
ERP_DR_S3_ENDPOINT / ERP_DR_S3_BUCKET / ERP_DR_S3_REGION
ERP_DR_S3_ACCESS_KEY_ID / ERP_DR_S3_SECRET_ACCESS_KEY
```

## 4. 交付前的已知边界

- `:443` 未在安全组放行前，HTTPS 只能从本机 / 隧道访问；
- 自签证书在浏览器会提示不受信任（受信任证书的切换步骤见 2.2）；
- 无自动异机备份（见 3.5）；
- `admin` 与 6 个角色演示账号的口令由业务侧掌握，运维脚本不保存它们。
