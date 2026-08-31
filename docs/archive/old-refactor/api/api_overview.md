# API总览

## 概述
原系统内置Swagger/Swashbuckle REST API

## 认证
- OAuthController.Token() - 获取access_token
- AccountController.Login() - 用户登录

## 控制器清单 (30+)

### 通用
- BillViewController: GetBillList, QueryBillList, GetBillDetail
- BillOperationController: Approve, UnApprove, Settle
- BillCheckController: 签核流程审核
- ParamsController: 系统参数查询
- SeekController: 通用数据查询

### MES制造
- MMS_CJMESController: 12个方法
- MMS_MESController: 6个方法
- TOneMESController: 8个方法
- CNCCollectController: CNC采集

### 业务
- SDS_OutController: 出库单
- SDS_SoController: 销售订单
- POS_RecController: 验收
- OA_CRM_CusController: CRM客户
- OA_ITEM_TaskController: 项目任务
- WHS_CouController: 盘点
- QC_AbnormalController: 品质异常

### 工具
- ChatController: 聊天
- FreeFormController: 动态表单
- FileUploadController: 文件上传
