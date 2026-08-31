# 数据库Schema总览

## 数据库信息
- 名称: ft_sys
- 服务器: (local) / WIN-PNF3V7UT0SD
- 类型: SQL Server + Oracle兼容
- ORM: Dapper (非Entity Framework)

## 表统计
- 总表数: 437
- 总字段: 5,893

## 核心表分组

### 系统框架 (SKY_*) - 约85表
- SKY_Users / SKY_Roles / SKY_Functions / SKY_Register / SKY_Orangise

### 业务单据 (SYS_*) - 约121表
- SYS_GoodInA (货品,108字段)
- SYS_CusA (客户,113字段)
- SYS_WhouseA/B/C (仓库)

### BOM/产品结构 - 约51表
- BOM_BOMA/BOMB/EBOMA/EBOMB
- BOM_WStation / BOM_MkCMachine / BOM_MkCent

### 财务 - 约30+表
- GLS_VocA (凭证) / GLA_BankInitA (银行)
- APS_AccountA / ARS_AccountA (应收应付)
- FAS_Pa_init (固定资产)

### 采购 - 约20+表
- POS_PoA/PoB (采购订单)
- POS_RecA/RecB (验收)

### 销售 - 约20+表
- SDS_SoA/SoB (销售订单)
- SDS_OutA/OutB (出货)

### 库存 - 约15+表
- WHS_MoveA/B (调拨) / WHS_AdjA/B (调整)
- WHS_CouA/B (盘点) / WHS_InitA/B (初始)

### 制造 - 约30+表
- MOS_PlanA/B (制令) / MOS_RecA/B (入库)
- MMS_CraftsA/B (工艺) / MMS_PartB (零件)

### OA/CRM - 约50+表
- OA_CRM_CusA~I (客户)
- OA_ITEM_ProjA (项目) / OA_ITEM_Speed (进度)

### 工作流 - 约46表
- WF_WorkFlowModel / WF_WorkFlowRun / WF_WorkFlowSetp

### 品质 - 约15表
- QC_ChkA/B (检验) / QC_AbnorReportA (异常)
