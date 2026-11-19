# 客户测试环境 MySQL 异机备份（COS）落地与恢复演练证据

> 状态：`ACTIVE`（实施与验证证据记录）
> Owner：Platform
> 权威来源：**无** —— 本文件是 `PL-RI-01` 灾备链路在客户测试环境上的**实施与验证证据**，
> 不是 Acceptance / Freeze 证据，也不是当前需求、架构或项目状态的权威来源。
> 当前 Requirement：[`docs/requirements/platform.md`](../requirements/platform.md)；
> 当前 Design：[`docs/design/platform.md`](../design/platform.md)；
> 当前项目状态：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)

## 1. 范围与授权

| 项 | 值 |
|---|---|
| 授权 | 业务所有者 2026-11-19 指令「配置COS 异机备份」；并同意由代理代为建桶、建子账号与安装 |
| 合同 | Requirement §36.16.2（`PL-RI-01`）与 Design §32.16.3；`deployment.md` §4.1 / §9 / §10.3–§10.11 |
| 目标环境 | `129.204.51.149`（腾讯云轻量应用服务器，Ubuntu 22.04 LTS），MySQL 8.0.46，应用目录 `/opt/modern-erp` |
| 对象存储 | 腾讯云 COS，桶 `modern-erp-dr-1477910165`，地域 `ap-guangzhou`，prefix `modern-erp/dr/` |
| 部署 commit | `c43435c`（灾备链路实现）；应用检出与本地 `master` 一致 |
| **不签发** | 本文件**不签发**任何 Acceptance / Freeze / Release Readiness；业务所有者的最终验收仍待进行 |

## 2. 实施内容

| 项 | 内容 |
|---|---|
| 只读备份账号 | `modern_erp_backup`@`127.0.0.1`：`GRANT USAGE ON *.*` + `SELECT, EXECUTE, SHOW VIEW, EVENT, TRIGGER ON modern_erp.*`；**无任何写权限，无全局库外权限** |
| 独立凭据文件 | `/etc/modern-erp/backup-env`（`root:modern-erp-backup`，`0640`）；备份单元经 drop-in **只读这一个文件**，不读应用服务的 `/etc/modern-erp/env` |
| COS 最小权限 | CAM 策略 `modern-erp-dr-backup`（PolicyId 294611927）绑定到子账号 `modern-erp-dr-backup`（uin 100055346626）：仅该桶的 9 个对象级操作 + 桶列举；**无删除桶、无跨桶、无管理权限** |
| 备份单元 | `modern-erp-mysql-backup.service`（仓库模板）+ `.timer`（每日 `03:15` + ≤10 分钟随机延迟）；`User=modern-erp-backup`、`UMask=0077`、systemd hardening 保持模板原样 |
| 退役 | 本地分支 `modern-erp-backup.timer`（2026-11-18 因对象存储凭据未到位而落地的 root 身份本地脚本）已 `disable --now`；历史本地 dump 保留为历史证据 |

## 3. 实施中发现并修复的实现缺陷（均为 canonical 灾备链路此前从未跑通所致）

| # | 缺陷 | 现象 | 修复 commit |
|---|---|---|---|
| D1 | 对象存储寻址写死 `forcePathStyle: true` | 腾讯云 COS 拒绝 path-style：`PathStyleDomainForbidden`（"must be addressed using COS virtual-styled domain"）。canonical 备份/恢复在真实 COS 上**完全不可用** | `8c59608` |
| D2 | `runMysqlDump` 只盯输出流 `'close'` 就读 `child.exitCode` | stdout 的 end 可能早于子进程退出事件被处理，`exitCode` 仍为 `null` → **一次成功的备份被误报为「退出码 null」**。实测间歇性失败：systemd-run 连续 6 次「成功 2 / 失败 4」，直接执行「成功 4 / 失败 2」 | `c88fc08` |
| D3 | 恢复入口把 `target.identity` 直接展开给 `runMysqlImport` | 目标身份字段名是 `database`、`runMysqlImport` 读 `database.name` → 库名被传成 `undefined`，导入落到名为 undefined 的库并报 `ERROR 1044 Access denied ... to database 'undefined'` | `bc12aee` |
| D4 | 导入未处理 dump 里的 `DEFINER=` 子句 | MySQL 8 要求 `SET_USER_ID`（全局动态权限）才能把对象归属设成源主机账号 → `ERROR 1227 Access denied; you need (at least one of) the SUPER or SET_USER_ID privilege(s)`。即使授予，该账号在目标库上无权限，触发器以它的权限执行，在隔离演练库上直接失效 | `c43435c` |

### 已登记的实现偏差

1. **恢复后对象归恢复账号所有**：D4 的修复在**导入流**上剥除版本注释里的 `DEFINER=<user>@<host>`
   （规则锚定 mysqldump 的 `/*!50017 ` / `/*!50013 ` 形态，正文里的字符串字面量不受影响）。
   存储的备份对象**保持原样**（上传内容与哈希逐字节一致），变换只发生在导入流。
   后果：恢复出的触发器/视图的 definer 是恢复账号，而不是源库账号。
   依据：Design §32.16.3 要求「恢复到隔离的 disposable 库」并校验 trigger 与健康检查，
   `deployment.md` §10.9 同样要求隔离库恢复演练；设计未规定恢复后对象归属。
   这是**可移植恢复的前提**，但确实与源库不同，特此登记。
2. **寻址方式由 endpoint 决定**：远端一律 virtual-hosted style，只有本地 sentinel
   （`127.0.0.1` / `localhost` / `::1`）保留 path-style。设计未规定寻址方式。

## 4. 备份侧真实证据（真实 MySQL 8.0.46 + 真实 COS）

| 项 | 值 |
|---|---|
| 单元 | `modern-erp-mysql-backup.service`，`User=modern-erp-backup` |
| runId | `c3fbb11f-3e3f-4b65-8ac8-9653951219a2` |
| objectKey | `modern-erp/dr/daily/2026-11-19T05-02-52-446Z-unknown-c3fbb11f-3e3f-4b65-8ac8-9653951219a2.sql` |
| sha256 | `115cfa16e3fe2602674a07bc4a35e9f0b45f41f582deb0e5d557caf111adda62` |
| bytes | `858761` |
| startedAt / finishedAt | `2026-11-19T05:02:52.441Z` / `2026-11-19T05:02:56.485Z`（耗时 4.04 s） |
| manifest status | `REMOTE_VERIFIED`（上传后 `GetObject` 回读并重算 SHA-256 与字节数一致） |
| 单元连续运行 | 修复 D2 后**连续 6 次全部 `COMPLETE`**（修复前 2/6） |
| COS 桶现状 | 18 个对象、合计 15,457,698 字节；18 份 manifest 全部 `REMOTE_VERIFIED` |
| 定时器 | `modern-erp-mysql-backup.timer` 已启用，下次触发 2026-11-20 03:22:49 CST |

## 5. 恢复侧真实证据（从 COS 异机副本恢复到隔离 disposable 库）

| 项 | 值 |
|---|---|
| 恢复目标 | `modern_erp_restore_drill`（一次性隔离库，`--target-class DISPOSABLE`）；恢复账号仅在该库上有权限 |
| 恢复状态机 | `SOURCE_VERIFIED → TARGET_AUTHORIZED → EMPTY_TARGET_VERIFIED → RESTORE_RUNNING → DATA_VERIFIED → APP_VERIFIED → COMPLETE`，终态 **`COMPLETE`** |
| 恢复对象数 | tables 428、views 1、triggers 5、foreignKeys 835 |
| 恢复耗时 | `05:07:39.966Z → 05:08:25.190Z` = **45.2 s** |
| 应用可用性（APP_VERIFIED 外部复核） | 恢复后另起一个临时应用实例指向演练库（`127.0.0.1:3002`）：`/api/health/live` 200、`/api/health/ready` 200，启动日志 `server_started backend=mysql`；**生产实例全程 live=200 / ready=200** |
| 逐表行数比对 | 427 张表全部比对，**仅 1 张不一致**：`finance_recognition_policy` live=28 / drill=24 —— 该差异是**备份之后**新增的策略行（应用启动时登记），与此前本地恢复演练的同一现象一致（live=24 / drill=20） |
| RPO | 演练声明恢复时距源备份完成 **4.72 min**（限值 24 h）→ 达标 |
| RTO | 从声明恢复到应用 ready **60.4 s**（限值 4 h）→ 达标 |
| 清理 | 演练库已 DROP、演练账号已删除、临时实例已按 PID 终止（`127.0.0.1:3002` 已无监听）；复核：演练库数 0、演练账号数 0、生产 `modern-erp.service` active |

## 6. 共享主机零干扰

| 项 | 结果 |
|---|---|
| MySQL | **全程未重启**（`ActiveEnterTimestamp` 仍为 2026-10-02） |
| nginx | 未重启、未改既有站点块 |
| 同机 `calculator` | `calculator_db` 仍 1 张表 |
| 同机 `pairbook-web` | `active` |
| 应用服务 | 只重启过 `modern-erp.service`（部署当轮）；灾备演练全程未重启 |

## 7. 离线门禁

| 门禁 | 结果 |
|---|---|
| `node --test scripts/admin/mysql-dr.test.js` | **16 / 16 PASS**（T13 寻址、T14 dump 结果判定顺序无关、T15 恢复库名映射、T16 DEFINER 剥离） |
| `pnpm test:fast` | **775 / 775 PASS**（86 suites，0 fail / 0 skipped） |
| `git diff --check` | PASS |

## 8. 未闭合项

1. **安全组与主机 `ufw` 未复核**：3306 / 3001 是否确实不可从公网访问、22 是否已收窄到固定出口 IP，
   本轮未验证（`PL-RI-05` 要求，属独立运维动作）。
2. **COS 保留策略按设计口径执行**（30 个 daily + 季度演练源）；本轮仅产生 daily 对象，
   尚未产生 `kind=drill` 对象，季度演练源保留路径**未被真实数据验证**。
3. **恢复演练用的是 disposable 目标**；`APPROVED_PRODUCTION` 路径（窗口标识 + 审批标识 + 精确目标身份）
   未在真实环境执行，按设计只需在批准窗口内由操作员准备空目标后执行。
4. **主账号临时 API 密钥**在引导过程中由业务所有者在控制台创建；引导脚本用毕即销毁本机文件，
   但**控制台侧的临时密钥需业务所有者自行删除**。
5. 灾备链路的 `commit` 字段在服务器检出为 detached HEAD 时记为 `unknown`（`git rev-parse HEAD`
   在备份账号权限下不可用），不影响对象唯一性（`runId` 承担区分），但 manifest 中的 commit 不可追溯。

## 9. 机器可读状态

```text
COS_OFFSITE_BACKUP=IMPLEMENTED_AND_VERIFIED(129.204.51.149; bucket modern-erp-dr-1477910165; ap-guangzhou)
COS_BUCKET=CREATED(private; CAM sub-user modern-erp-dr-backup; single-bucket 9 object actions + bucket list)
COS_BACKUP_UNIT=modern-erp-mysql-backup.service/timer ENABLED(daily 03:15 + <=10min)
COS_BACKUP_RUN=COMPLETE x6/6 after D2 fix(before fix: 2/6)
COS_MANIFESTS=18 x REMOTE_VERIFIED
COS_OBJECTS=18 (15,457,698 bytes)
COS_RESTORE_DRILL=COMPLETE(from COS to isolated disposable DB; tables 428/views 1/triggers 5/fk 835)
COS_RESTORE_APP_VERIFIED=live 200 + ready 200 against restored DB; production live/ready 200 throughout
COS_ROW_DIFF=1/427 tables (finance_recognition_policy; post-backup policy rows)
RPO=4.72 min (limit 24 h) PASS
RTO=60.4 s (limit 4 h) PASS
DR_DEFECTS_FIXED=4 (addressing / dump-settle race / restore db-name / DEFINER)
DR_TESTS=16/16 PASS
LOCAL_FAST=775/775 PASS
SHARED_HOST=UNAFFECTED(MySQL never restarted; nginx untouched; calculator_db 1 table; pairbook-web active)
IMPLEMENTATION_DEVIATIONS=2 registered(definer ownership after restore; endpoint-driven addressing)
SECURITY_GROUP/UFW_REVIEW=NOT_VERIFIED
QUARTERLY_DRILL_OBJECT=NOT_PRODUCED_YET
ACCEPTANCE/FREEZE=NOT_ISSUED
```
