# 反编译源码分析报告

## 源码统计
| 层级 | 文件数 | 大小 |
|------|--------|------|
| BLL业务逻辑层 | 2549个.cs | 18MB |
| Core框架层 | 1767个.cs | 12MB |
| **合计** | **4316个.cs** | **30MB** |

## 架构分析

### REST API Controllers
1. AccountController - 账户/认证
2. ApiControllerBase - API基类
3. ChatController - 聊天通讯
4. ForewarningController - 预警
5. OAuthController - OAuth认证
6. OragQueryController - 组织查询
7. ParamsController - 参数配置
8. SeekController - 搜索

### API Bills (业务单据接口)
APS/CMN/CNC/FAS/GLS/MOS/PLM/POS/QC/Remind/SDS/SYS/WHS
→ 每个模块一个独立的API控制器

### 业务模块BLL
AMA / APS / ARS / BIL / BOM / BUD / CNC / common / EPS / FAS
Freeforms / FX / GLA / GLS / GRC / HR / KB / MMS / MOS / MOT
OA / OA_ANN / OA_CRM / OA_ITEM / OA_JOINT / OA.Third
PLM / POS / POS.QS / QC / Report / SDS / SYS / WF / WFS / WHS
→ 35个子模块，完整业务逻辑

## 复刻路线
✅ 第1步: 反编译源码 → 完成 (30MB C#代码)
🔄 第2步: 分析核心逻辑模式
⬜ 第3步: 设计新系统架构
⬜ 第4步: 搭建.NET Core + React框架
⬜ 第5步: 按模块迭代开发
