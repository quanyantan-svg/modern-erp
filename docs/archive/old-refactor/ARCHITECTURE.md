# 融维新ERP - 架构蓝图

## 基于方天B9V27的1:1复刻

### 数据库总览 (437张表)
| 模块分类 | 表数 | 涵盖 |
|---------|------|------|
| 客户关系(OA_CRM) | 45 | CRM客户管理、销售活动 |
| 系统框架(SKY) | 85 | 用户/权限/注册/配置/日志/菜单 |
| 业务单据(SYS_*) | 121 | 货品/客户/供应商/单据等核心业务 |
| BOM/产品结构 | 51 | BOM/工艺路线/设备 |
| 工作流(WF) | 46 | 审批流程引擎 |
| OA办公 | 8 | 公告/文档/会议室 |
| PLM | 17 | 产品生命周期/图文档 |
| 人事(HR) | 10 | 员工档案 |
| 通讯(CHAT) | 5 | 即时通讯 |
| CNC/MES | 8 | 数控/报工 |
| 销售(SDS) | 4 | 销售订单 |
| 采购(POS) | 2 | 采购订单 |
| 其他 | 45 | 财务/库存/质检等 |

### 关键数据库表
| 表名 | 作用 | 关键字段 |
|------|------|---------|
| SKY_Register | 许可证 | UserNum(用户数), EndDate |
| SKY_Users | 系统用户 | UserID, UserName, Password |
| SKY_UsersRoles | 用户角色 | UserID, RoleID |
| SKY_Roles | 角色定义 | RoleID, RoleName |
| SKY_Functions | 功能菜单 | FunctionID, ParentID, Url |
| SKY_Orangise | 组织架构 | OrgID, OrgName, ParentID |
| SKY_ModuleSessions | 在线会话 | SessionID, UserID |

### API设计（按模块拆分）
1. /api/auth - 认证与授权
2. /api/basic - 系统基础（货品/客户/供应商）
3. /api/scm - 供应链（采购/销售/库存）
4. /api/manufacturing - 制造（BOM/工单/MRP）
5. /api/finance - 财务（应收/应付/总账）
6. /api/oa - 办公（审批/公告/CRM）
7. /api/workflow - 工作流引擎
8. /api/report - 报表与分析

### 技术栈
- 后端: ASP.NET Core 8 Web API + EF Core
- 前端: React 18 + Ant Design Pro + TypeScript
- 数据库: SQL Server / PostgreSQL (兼容)
- 认证: JWT + Refresh Token
- 缓存: Redis
- 搜索: Elasticsearch (可选)
- 部署: Docker + K8s
