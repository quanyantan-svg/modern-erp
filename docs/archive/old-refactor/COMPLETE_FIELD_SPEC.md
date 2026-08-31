# 融维科技ERP — 全量字段规格说明书（完整版）

生成时间: 2026-06-26T17:37:02.660Z
BLL源文件总数: 约606个
涵盖模块: 51个

---

## SKY.NetFrameWork.BLL

- BLL文件数: 45
- 业务方法数: 273
- 引用的表数: 55
- 字段总数: 352

涉及表:
```
$HR_Emp
$SKY_DBTables
$SKY_FieldExtenProperties
$SKY_FunReportModulC
$SKY_FunctionPermission
$SKY_FunctionSQLs
$SKY_Functions
$SKY_FunctionsParameter
$SKY_FunctionsPermissionFields
$SKY_Orangise
$SKY_Orangise_Cus
$SKY_Orangise_Users
$SKY_Orangise_cusB
$SKY_Permission
$SKY_Roles
$SKY_UserContacts
$SKY_Users
$SKY_UsersRoles
$SKY_Users_SessionID
$SKY_WebStation
$SKY_users
$SYS_CManagC
$SYS_Curya
$SYS_Curyb
$SYS_CusA
$SYS_CusCode
$SYS_CusRate
$SYS_CusRateC
$SYS_Feature
$SYS_GoodInA
$SYS_InvCatl
$SYS_Option
$SYS_ParCatB
$SYS_ParCatC
$SYS_Sales
$SYS_SpTypeA
$SYS_SpTypeB
$SYS_UpLoadDat
$SYS_WhouseA
$SYS_WhouseB
$SYS_WhouseC
$VG_Sheet
$VG_Unit
$VG_VG
$V_function_Fields
$WF_FlowRose
$WF_FlowSetpForm
$WF_FormInfo
$WF_WorkFlowLogs
$WF_WorkFlowModel
$WF_WorkFlowRun
$WF_WorkFlowSetp
$sky_co_reg
$sky_co_reg_org
$sp_genDBDict
```

业务方法:
```
ADMIN_ID
ADMIN_NAME
AbandonSessionById
Add
AddReport
AddUserFuncs
BExists
Branch
CUS_
ChangePassword
ChangeReportName
CheckBillBeforeDel
CheckExists
CheckMatInit
CheckPasswordComplexity
CheckPasswordLength
CheckUserCodeAndLoginName
Checkorg_name
Code
CodeDuplicateCheck
CreateDepartment
CreateWebStationDB
Credit
CusNum
Cus_No
DelOrModCondition
Delete
DeleteByID
DeleteByOrgID
DeleteReport
Dispose
DoQuery
Exists
ExistsCode
ExistsLoginName
ExistsMgrUser
ExistsNo
ExistsUserPerm
FT_USER_ID
Franchise
FullName
GetAll
GetAllDepartComboxList
GetAllDepartDeptList
GetAllDepartOragList
GetAllList
GetAllOragByWebStation
GetAllOrgs
GetAppOnlineUserCount
GetAuthCodeByCurrentSession
GetBalance_itemByOrag
GetBalance_rptByOrag
GetBlanceSheetByOrag
GetCashSheetByOrag
GetCashSheetDataByOrag
GetChatUserInfo
GetCoFullName
GetCoName
GetCodeByID
GetConnectionStrByAccountBook
GetConnectionStrByServerAndDBName
GetCountOfDeployedOrg
GetDataByID
GetDefId
GetDefaultReportIDForBarcode
GetDepartComboxList
GetDeployDepartList
GetDeptByOrg
GetDeptIdOfUser
GetDeptMgrUser
GetDeptsByOrg
GetDeptsByOrgs
GetExistCount
GetFunBillState
GetFunctionComboxList
GetInternetPass
GetInvBigCatl
GetLinktoFunc
GetListData
GetLoginUserInfo
GetMaxLevel
GetMultiVerByOrag
GetOnlineCoUserCount
GetOnlineUserCount
GetOption
GetOptionID
GetOptionValue
GetOragIDByDeptID
GetOrgComboxByID
GetOrgComboxList
GetOrgIDByCode
GetOrgList
GetOrgListByAccountBook
GetOwnerEquityByOrag
GetRegDataByKey
GetRegOrgData
GetReportCate
GetReportCustomer
GetReportIdByOpType
GetReportNameById
GetReportWst
GetRoleCrUser
GetRootOrgID
GetRootOrgName
GetSessionIDByWXOpenID
GetSpTypeBByKey
GetSqlWithName
GetSubOrgWithUrl
GetTop
GetTopNOrgAndDept
GetTotalDBName
GetTotalDataDBName
GetUserFuncsList
GetUserList
GetUserListByDept
GetUserListByOrag
GetUserListByRole
GetUserListForChat
GetUserListForMsgs
GetUserReEmp
GetUserReportsTableBydFuncId
GetVerfcodeValue
GetWebStationList
GetWebStationNameByDBName
HasAdminRole
IMAGE_PATH_WITH_IDTAG
IMAGE_PATH_WITH_NAME
Im_code
InitUserFieldPerm
InitUserPerm
InsertWebStation
IsClientEvent
IsMenuCodeExist
IsModuleUseable
IsOrgDeployed
IsShowPropertyBar
IsShowToolBar
LoadAliveSession
LoadAttach
Logout
ModifyUserRole
MoreCount
MultiDiscountUpdate
NameIsExists
ORG_ROOT_ID
OrgDeploy
ProductName
RefreshAliveModules
RemoveSessionfromUserRestrict
RemoveUserFuncs
ResetOrgMaxUser
SaveReg
SaveSetp
Scope
SelectDeployState
SelectWebstation
SetAppTicketMktime
SetDefaultReport
SetDefaultSp
SetIsOaSpeedTreeShow
SetLoginLog
SetOptionValue
SetRegDataByKey
SetSessionIDByWXOpenID
SetShareReport
SetUserDefaultReport
SetUserTheme
SetWXOpenID
ShortName
SysAllInit
SysInit
TableName
TestConn
TimeOutMinutes
UpdataInfo
UpdataInfoTab
Update
UpdateCoInfo
UpdateCoRegInfo
UpdateDeployState
UpdateDisplayOrder
UpdateExistsLoginName
UpdateExistscode
UpdateLock
UpdateLoginUserInfo
UpdateOption
UpdateReport
UpdateSkycoreg
Updateauthcode
UserOfAll
UserOfApp
UserOfOut
VGRunModel
VGScriptCls
VGScriptUrl
ValidateReg
ValidateSessionRestriction
Validation
VerifyUser
VeryfyUserSession
VgDataXmlUrl
VgID
VgLibName
WorkFlowModelID
WriteToFile
addFunForm
addOrUpdateData
addPermSet
addRoleSet
addUserSet
businessFunAdd
bussParamAdd
bussUpdate
configFunPrem
contactsGetByID
delPerm
delRoes
delUserImg
delUserRole
delUsers
deleteContacts
deleteFunByID
deleteFunForm
execSQL
getAlPerm
getAllFieldPerm
getAllFlowRole
getAllFunPerm
getAllOrg
getAllRole
getAllTableName
getCusRate
getDefaultReportID
getDetail
getEditFunForm
getEditPerm
getEditRole
getFPermInfo
getFieldPermInfo
getFlowModel
getFormInfo
getFunPerm
getFunctionFormByFunID
getIsCreate
getMultiDiscount
getNowParam
getPermInfo
getPermInfos
getPermInfosByParentFun
getRoleList
getSigleRecord
getStepInfo
getUserContacts
getWhouCharges
getsysWHAttr
isLogined
isRoleUsing
key
saveSys_CusByCus_id
stop_date
stop_user_id
stop_user_name
upDataPerm
upDataRole
upDateUser
updataStep
updateFunForm
updateUserContacts
valEndStep
valStartStep
valiCode
value
vcode
```

字段清单:
```
"", "ds", "user, "‘", "数据库部署，测试连接：", "请通过服务器端执行此操作", *\r\n, -1, -1\r\ndelete, 0L, 0], 1008, 120, 13645, 18687, 19278, 1\r\nelse, 1], 2\r\nelse\r\n, 2];, 3600, 36000, BackupPath, Bill_Rate, CMGrp, CName, CName\r\n, CSql, CaType, Checked, ClientIP, Cname, Code, Code";, CompanyTel, CrDate, CrPers, Credit, Cury_Name, Cury_No, CusNum, Cus_Rate, DBName, DBPassword, DBPort, DBType, DBUser, DataPath, DateTime, DeptCD, DeptID, Description, Direction, DsDate, EDraNo, EMail, EName, Extension, FName, FieldExtenPropertiesID, FlowRoseName, FlowRunState, FormID, FormName, FormState, FormURL, FormsCookiePath, Franchise, FsDate, FsMkNo, FtCode, FunID, FunctionID, FunctionsID, HashTableEx, ID, IFName, Id, InCode, InName, IsBond, IsDelete, IsDisplay, IsNode, ItCode, Item, Item2, JName, KeyWord, LastDateTime, LastIP, Length, LnTele, Lock, LockEndTime, LockStartTime, LogPath, LoginFrom, LoginName, MenuCode, MenuOrder, MenuOrder\r\n--, MenuOrder\r\n\r\n--建立聚集索引，以确保数据按顺序输出\r\nCREATE, MenuOrder\r\n\r\nselect, Message, MobileTel, MobileTel1, ModelName, NameType, NickName, Now, OragID, OragID", OrangiseID, OrangiseID", Output, PCode, PMWeig, PaCaID, PaCode, PaItID, ParamName, ParamValue, Parameters, PassWord, PermissionID, PermsBit, PerssionID, Remark, Remark", ResCode, RolesID, SELECT, SFName, SMater, SModel, SStand, Scope, ServerName, SessionID, SetpID, SetpType, Sex, ShowOrder, Size, SortNo, SortNumber, SpName, SpTAID, SpTails, SqlDbType, SqlValue, Status, Stop_user_ID, Stop_user_No, String, TableName, TsMater, TypType, Type, URL, UpID, Url, UseIPWhitelist, User_ID, Value, WHAttr, WHCode, WHName, WIPWho, WhAddr, WhKp_Names, [CName], [Description], [EName], [FName], [ID], [IsDisplay], [JName], [MenuOrder], [Module_ID], [ResCode], [Sheet_ID], [Sheet_IsPrint], [Sheet_Mode], [Sheet_Name], [Sheet_Visible], [Unit_Name], [Unit_Text], [VGType_ID], [VG_BackColor], [VG_BackPic], [VG_CenterX], [VG_CenterY], [VG_ID], [VG_LastModDate], [VG_Name], [VG_Range], [VG_Version], [key], [value], \r\n, \r\nMOVE, \r\n\t\t, access_code, admin_name, backupPath, backup_from, belongOragId, bool, byte, byte?, cName, canLoginFromPCWithWAN, case, clientDevice, clientIp, cname, code, commandType, conn, cruser, cus_id, cus_name, cus_no, dataPath, data_masking", data_masking\r\n, db, dbdp, dbdp2, dbname, defaultValue:, deploy_host, deptid, direction, distinct, email, f;, fid, fid\r\n, fieldname, fieldvalue, findid, func_id, func_id\r\nupdate, funcid, gl_day, grantperm, hashTableEx, id, ignoreCase:, incode, int, internetPass, isLimit, isOT\r\n, isParent, isPersistent:, isSupplier, keepSessionAlive, keys, linkfrom\r\n, loginName, loginname, long, menuorder, menuorder";, modeType, module_no, name, needEncrypt:, new, new, newDBName, newOrgCode, newOrgId, null, online, op_name, op_type, oragid, orgId, orgModules, org_id, originDB, originOrg, out, outParams, pId, pageType, param, parameters, parentId, password, passwordEncrypted, pcode, perms, plugin_path, prity, pwd, remark, reportId, role_names, roleid, rolesID, sales_name, saveType, sessionId, sex, size, splitYear, sql, st_hours\r\n, stepId, stop_date, stop_user_id, strID, strRestoreSoure, strRestoreTraget, string, string>, string[], strval, tabName, tableName, tablename, tabname, tel, theme, top, type, upid, upid\r\n, userID, userId, userid, username, value, vcode, wh_id, whereSql, whs_month, wsDBName, wst_ID, {0}, {0}name, {1}, {1}Name, {2}, {3}Name, 新增不存在的权限）\r\nbegin
```

---

## SKY.NetFrameWork.BLL.Auth

- BLL文件数: 1
- 业务方法数: 11
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
AuthorizedCode
IsSessionAlive
Msg
OrgID
OrgName
Product
State
UserID
UserName
expiryMsg
leftday
```

---

## SKY.NetFrameWork.BLL.Code

- BLL文件数: 2
- 业务方法数: 3
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
EmpId
EmpName
McmId
```

---

## SKY.NetFrameWork.BLL.Enume

- BLL文件数: 2
- 业务方法数: 1
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
Message
```

---

## SKY.NetFrameWork.BLL.Perm

- BLL文件数: 2
- 业务方法数: 9
- 引用的表数: 8
- 字段总数: 47

涉及表:
```
$SKY_FieldExtenProperties
$SKY_FunctionPermission
$SKY_FunctionsPermissionFields
$SKY_Permission
$SKY_Roles
$SKY_UsersRoles
$SYS_InvNoA
$SYS_InvNoB
```

业务方法:
```
ApplyRolePermsToUser
CopyUsersPermsToUser
GetRightsByHolderAndFuns
GetUserDataScapeByFunId
GetUserDataScapeByFunId_Old
Global
IsOperationAuthorized
SaveHolderRights
getPerm
```

字段清单:
```
--, --from, --to, 1:保留原有权限并追加\r\n, ID, Item_Field, List<HashTableEx>, OrangiseID, PCode, UpID, UpID\r\n, \r\n, btnOpCode, changedFuncs, cname, copyType, distinct, fieldName, fixedCode\r\n, func_id, funid, funids, holderID, holderType, ignoreCase:, int, menuorder, menuorder\r\n, null, orgID, org_id, orgid, params, perms, perms\r\n, perms_new\r\n, roleId, string, targetUserId, upid, userIds, user_id, userid, xor, {1}, {2}, {3}
```

---

## SKY.NetFrameWork.BLL.Report

- BLL文件数: 1
- 业务方法数: 2
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
GetCustomizedFields
GetUserCustomizedSql
```

---

## SKY.NetFrameWork.BLL.Web.AMA

- BLL文件数: 1
- 业务方法数: 14
- 引用的表数: 22
- 字段总数: 40

涉及表:
```
$AMA_MouldTargetAllocation
$AMA_MouldTargetAllocation_amt
$BOM_WStation
$MMS_CraftsA
$MMS_CraftsB
$MMS_CraftsB_Back
$MMS_EvaluateE
$MMS_PartA
$MMS_PartB
$MMS_PartB_allo
$MMS_PartB_allo_temp
$MMS_Pricea
$MMS_QuotD
$MMS_Style
$OA_WordB
$SDS_QuotB
$SDS_SpedC
$SDS_soA
$SKY_Users
$SYS_BillCategory
$SYS_GoodInA
$SYS_ParCatC
```

业务方法:
```
CheckUsed
ChkExists
ClearTempData
CreateTempData
DeleteByID
GetDataByID
GetGirdFields
GetGridDatas
GetListData
GetQuotData
GetTempTot
RefreshData
SavePageingData
SaveTempToData
```

字段清单:
```
"", "isOnHour", $"MMS_PartB_allo, $"MMS_PartB_allo_temp, 0m, 10, GStand, GdName, Gd_No, ID, Mat_No, Wst_ID, \r\n, allo_ID, allo_amt, bom_ver, case, craftsa_ID, fact_amt, fact_amt\r\n, fact_hour, hours, null, p_quan, partb_ID, piece_name, price, quotb_id, string, top, user_no, val, wordb_name, wst_ID, wst_name\r\n, {0}, {1}, {2}, {7}, {8}\r\nelse\r\n
```

---

## SKY.NetFrameWork.BLL.Web.APS

- BLL文件数: 23
- 业务方法数: 67
- 引用的表数: 57
- 字段总数: 419

涉及表:
```
$APS_AccountA
$APS_AccountARpt_temp
$APS_AccountB
$APS_AccountNotPayRpt_temp
$APS_AccountReceivableRpt_temp
$APS_AgingAnalysis_temp
$APS_BatchPro_temp
$APS_CusGetdate
$APS_EstimateA
$APS_EstimateB
$APS_InitA
$APS_InitB
$APS_ReceiptA
$APS_ReceiptAPaid_temp
$APS_ReceiptA_back
$APS_ReceiptB
$APS_StatementsA
$APS_StatementsB
$APS_StatementsC
$APS_WriteOff_AccountB_Temp
$APS_WriteOff_PoB
$APS_WriteOff_PoB_Temp
$BOM_WStation
$HR_Emp
$MMS_GdProgressEKB_temp
$MMS_PartA
$MMS_PartB
$POS_PoA
$POS_PoA_Payments
$POS_PoA_Payments_back
$POS_PoB
$POS_RecA
$POS_RecB
$POS_RecB_back
$SDS_soA
$SDS_soB
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_Ann
$SYS_Bank
$SYS_BillCategory
$SYS_CManagA
$SYS_Curya
$SYS_CusA
$SYS_CusCode
$SYS_Cusa
$SYS_Feature
$SYS_GoodInA
$SYS_InvCatl
$SYS_Item
$SYS_Option
$SYS_ParCatC
$SYS_SMater
$SYS_Sales
$SYS_Settle
$v_SYS_GoodInA_all
```

业务方法:
```
AdjustNeedProduceVoc
Auto_ApsWriteOff
CanDelete
CashReview
ChangeMonth
ChangeOp_date
CheckAPS_ReceiptA
CheckChangeMonth
CheckChangeOp_date
CheckOver
ChkWriteOff
ClearChildData
ClearTempData
CreateDiffAccount
CreateRedBill
DelOrModAllCondition
DeleteByID
DeleteTempTable
DoSearch
ExecInsAPS_acountB
ExecRate_AdjustMain
Exec_GetCuryRate
Exists
ExistsChildData
ExistsVoc
Existx
GetAPS_AccountA
GetAPS_AccountA_InvoByID
GetAccountDataByID
GetBillCategory
GetBillNewData
GetCashAcct
GetChildAmt
GetCusByID
GetDataByID
GetDept_NoData
GetExistsMon
GetIdByVocId
GetLastMon
GetListData
GetMinOp_Date
GetNowMon
GetPageDataByID
GetSubPagedData
GetSumTotByA_id
GetTable
GetTable_rate
GetWHSMonthOp_Date
GetWhsDate
GetWriteOffData
InAccountAamt
IsCanDelBill
PriceAdjusForm
RefLineNo
RefTotal
RunScheduleProc
SearchDataProc
SelectAll
SelectDate
StopReceipt
UnWriteOff
UpAccPay_Date
UpAccountAamt
UpdateAPS_AccountA
UpdateLine_no
WriteOff
saveGridData
```

字段清单:
```
"", "0", "1", "2", "4", ";, "EnablePrepaidNotOffset", "c", "fc_amt", "null", #templine, -1, 0m, 10, 1000, 112, 120, 1\r\n, 20, 21, 23, A_ID, Acct_DC, Acct_Name, Acct_No, Ann_No, Bank_Name, Bill_no, CMCode, CMName, CName, C_Price, Ca_date, Category, Cury_Case, Cury_ID, Cury_Name, Cury_No, Cus_Name, Cus_No, Cus_name, DC_ID, DeptCD, Dept_No, Direction, EnName, EndDate, Fas_IF, FieldQuerySql, FtCode, GAbbre, GD_No, GStand, GdInA_No, GdName, ID, InName, Length, Op_date, P_C_fee, PaCode, PagingParams, Parameter, Parameters, Params, SMater, SMater_name, S_price, Sales_ID, Sales_Name, Sales_No, Sales_no, Settle_Caption, Settle_Caption\r\n, Settle_No, Settle_Type, Settle_ids, Size, SqlDbType, SqlValue, TaxType_ID, Value, VarChar, Where, \r\n, \r\n\t, \r\n\t\t, \r\n\t\t\t, \r\n\t\t\t\t\t, \r\n\t\t\t\t\tA_ID, \r\n\t\t\t\t\t\t\t\t, \r\ncase, \r\nl.{0}, \r\nq.item_name, aID, a_ID, a_ID\r\n, acca_ID, acct_name, acct_no, afrom_id, aid, assist_CD, billID, bill_no, billa_ID, billb_ID2, bool, cName, ca_user_id, ca_user_ids, ca_user_no, case, cash_date, checkID, childJson, chk_date, chk_type, chk_type_ID, cr_date, cury_Name, cury_Name\r\n, cury_No, cury_ids, cury_name, cus_ID, cus_Name, cus_bank, cus_bank_account, cus_id, cus_ids, cus_name, cus_no, cus_ord, decimal, deptCD, dept_ids, dept_no, emp_nam, emp_no, fc_amt_1, fc_amt_10, fc_amt_11, fc_amt_12, fc_amt_13, fc_amt_14, fc_amt_15, fc_amt_16, fc_amt_17, fc_amt_18, fc_amt_19, fc_amt_2, fc_amt_20, fc_amt_21, fc_amt_22, fc_amt_23, fc_amt_24, fc_amt_3, fc_amt_4, fc_amt_5, fc_amt_6, fc_amt_7, fc_amt_8, fc_amt_9, fc_amt_sum, fc_cash_tot, fc_diff_tot, fc_end_amt, fc_not_amt_1, fc_not_amt_10, fc_not_amt_11, fc_not_amt_12, fc_not_amt_13, fc_not_amt_14, fc_not_amt_15, fc_not_amt_16, fc_not_amt_17, fc_not_amt_18, fc_not_amt_19, fc_not_amt_2, fc_not_amt_20, fc_not_amt_21, fc_not_amt_22, fc_not_amt_23, fc_not_amt_24, fc_not_amt_3, fc_not_amt_4, fc_not_amt_5, fc_not_amt_6, fc_not_amt_7, fc_not_amt_8, fc_not_amt_9, fc_not_tot, fc_pay_tot, fc_pay_tot_1, fc_pay_tot_10, fc_pay_tot_11, fc_pay_tot_12, fc_pay_tot_13, fc_pay_tot_14, fc_pay_tot_15, fc_pay_tot_16, fc_pay_tot_17, fc_pay_tot_18, fc_pay_tot_19, fc_pay_tot_2, fc_pay_tot_20, fc_pay_tot_21, fc_pay_tot_22, fc_pay_tot_23, fc_pay_tot_24, fc_pay_tot_3, fc_pay_tot_4, fc_pay_tot_5, fc_pay_tot_6, fc_pay_tot_7, fc_pay_tot_8, fc_pay_tot_9, fc_rate, fc_tot, fc_vat, flow_type, from_a_id, from_b_ID, from_date, from_id, from_id2, from_no, from_tag, from_type, from_type_ID, gd_Name, gd_No, gd_no, htx, htx2["_chk_more_bids"], id, ids, invo_date, invo_fc_tot, invo_fc_vat, invo_lc_tot, invo_lc_vat, invo_ma, invo_no, invo_tot, invo_type, invo_type_ID, invo_user_ID, invo_user_No, item_id, item_name, item_name\r\n, item_no, lc_amt, lc_amt_10, lc_amt_11, lc_amt_12, lc_amt_14, lc_amt_15, lc_amt_16, lc_amt_18, lc_amt_19, lc_amt_2, lc_amt_20, lc_amt_22, lc_amt_23, lc_amt_24, lc_amt_3, lc_amt_4, lc_amt_6, lc_amt_7, lc_amt_8, lc_end_amt, lc_not_amt_1, lc_not_amt_10, lc_not_amt_11, lc_not_amt_12, lc_not_amt_13, lc_not_amt_14, lc_not_amt_15, lc_not_amt_16, lc_not_amt_17, lc_not_amt_18, lc_not_amt_19, lc_not_amt_2, lc_not_amt_20, lc_not_amt_21, lc_not_amt_22, lc_not_amt_23, lc_not_amt_24, lc_not_amt_3, lc_not_amt_4, lc_not_amt_5, lc_not_amt_6, lc_not_amt_7, lc_not_amt_8, lc_not_amt_9, lc_not_tot, lc_pay_tot, lc_pay_tot_1, lc_pay_tot_10, lc_pay_tot_11, lc_pay_tot_12, lc_pay_tot_13, lc_pay_tot_14, lc_pay_tot_15, lc_pay_tot_16, lc_pay_tot_17, lc_pay_tot_18, lc_pay_tot_19, lc_pay_tot_2, lc_pay_tot_20, lc_pay_tot_21, lc_pay_tot_22, lc_pay_tot_23, lc_pay_tot_24, lc_pay_tot_3, lc_pay_tot_4, lc_pay_tot_5, lc_pay_tot_6, lc_pay_tot_7, lc_pay_tot_8, lc_pay_tot_9, lc_tot, lc_tot_1, lc_tot_10, lc_tot_11, lc_tot_12, lc_tot_13, lc_tot_14, lc_tot_15, lc_tot_16, lc_tot_17, lc_tot_18, lc_tot_19, lc_tot_2, lc_tot_20, lc_tot_21, lc_tot_22, lc_tot_23, lc_tot_24, lc_tot_3, lc_tot_4, lc_tot_5, lc_tot_6, lc_tot_7, lc_tot_8, lc_tot_9, lc_vat, line_no, mat_id, mat_no, message, month, msgStr, multi_dept, multi_proj, multi_staff, new, note, op_date, ord_column, ord_column1, ord_column1\r\n, outParams, out_type, p_price, p_quan, p_unit, page_no, pay_date, per_rate, piece_name, piece_no, po_b_ID, po_b_id, po_no, po_user_id, po_user_no, pob_id, precision, proMode, r_date, rec_date, rec_rate, s_quan, settle_ID, ship_no, ship_no\r\n, single_CD, smater, smater_name, so_no, state, stop_if, str, str2, strSql, strSqlA, string, string>, style_no, tax_no, tax_type, tax_type_ID, top, type, unit_ID, unit_rate, use_if, user_ids, voc_id, voc_no, where, yypoa_ID, {0}, {1}, {2}
```

---

## SKY.NetFrameWork.BLL.Web.ARS

- BLL文件数: 25
- 业务方法数: 98
- 引用的表数: 59
- 字段总数: 437

涉及表:
```
$APS_AccountA
$APS_AccountB
$ARS_AccountA
$ARS_AccountARpt_temp
$ARS_AccountA_Invo
$ARS_AccountB
$ARS_AccountB_Back
$ARS_AccountNotReceiptRpt_temp
$ARS_AccountReceivableNotRpt_temp
$ARS_AgingAnalysis_temp
$ARS_BatchPro_temp
$ARS_CusGetdate
$ARS_InitA
$ARS_InitB
$ARS_ReceiptA
$ARS_ReceiptA_InvoNo
$ARS_ReceiptA_back
$ARS_ReceiptB
$ARS_ReceiptReceived_temp
$ARS_StatementsA
$ARS_StatementsA_back
$ARS_StatementsB
$ARS_StatementsC
$ARS_WriteOff_AccountB_Temp
$ARS_WriteOff_SoB_Temp
$ARS_WriteOff_SoB_adv
$GLS_VocA
$HR_Emp
$SDS_OutA
$SDS_OutA_back
$SDS_OutB
$SDS_OutB_back
$SDS_soA
$SDS_soA_Rate
$SDS_soB
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_Ann
$SYS_Bank
$SYS_BillCategory
$SYS_CManagA
$SYS_Channel
$SYS_Curya
$SYS_CusA
$SYS_Cusa
$SYS_GoodInA
$SYS_InvCatl
$SYS_Item
$SYS_Option
$SYS_ParCatB
$SYS_ParCatC
$SYS_SMater
$SYS_Sales
$SYS_Settle
$SYS_WhouseA
$SYS_WhouseB
$pos_poa
$pos_pob
```

业务方法:
```
AddData
Auto_ArsWriteOff
BeforeAddCheck
CPDM
CPDW
CPMC
CPXH
CalcSumEndCount
CanDelete
CancelVoc
CashReview
ChangeMonth
ChangeOp_date
CheckArsReciptA
CheckBeforeDel
CheckChangeMonth
CheckChangeOp_date
CheckCusYFDD
CheckOutA
CheckOver
CheckStatementsBOut
CheckStatementsCOut
ChkWriteOff
ConvertArsToAps
CreateDiffAccount
CreateRedBill
DDH
DealVocProc
DelDataA
DelOrModAllCondition
Delete
DeleteByID
DeleteTempData
DeleteTempTable
ExecInsARS_acountB
ExecRate_AdjustMain
Exec_GetCuryRate
Exists
Existx
FPBH
GetAccountDataByID
GetAcctBalance
GetAll
GetCashAcct
GetChildAmt
GetCuryfc_rate
GetCusByID
GetDataB
GetDataByID
GetDataC
GetDept_NoData
GetExistsMon
GetIdByVocId
GetItem_NoData
GetLastMon
GetListData
GetMTableNewData
GetMTableNewState
GetNowMon
GetOrangiseUser
GetSubPagedData
GetSumTotByA_id
GetTable
GetTable_rate
GetWriteOffData
IsCanDelBill
JZRQ
KHDDH
KHDM
KHDZ
KHKHYHZH
KHMC
KHSH
RunScheduleProc
SearchDataProc
SelectAll
SelectDate
UnWriteOff
UpAccGet_Date
UpdateData
UpdateExists
UpdateInvoice
UpdateLine_no
UpdateSARS_StatementsC
XTLSH
beforeSaveCheckData
getARSState
getAllReceiptbList
getCacAmt
getCalBAmt
getCalCAmt
getChkdate
getInsARS_vocB
getOfftake
getOfftakeItem
getSigleRecord
updateReMonthB
updateReMonthC
```

字段清单:
```
"", "0", "1", "2", "4", "fc_amt", -1, 0m, 10, 1000, 112, 120, 121, 1\r\n, 23, AID, A_ID, Acct_Name, Ann_ID, Ann_Name, Ann_No, BID, Bank_Name, Bill_no, CMName, CMngA_ID, CMngA_No, CName, Ca_User_No, Ca_date, Category, Channel_Name, CuCode, Cury_Case, Cury_ID, Cury_Name, Cury_No, Cus_Name, Cus_No, Cus_Short\r\n, Cus_Times, Cus_name, DC_ID, DeptCD, Direction, EDraNo, EnName, EndDate, Ft_ID, Ft_No, GAbbre, GD_No, GStand, GdCode, GdInB_ID, GdName, Get_date, Htreat, ID, InName, List<Hashtable>, Mer_User_ID, Op_date, OragCD, OragID, OragId, Out_Date, Out_ID, Out_User_No, PagingParams, Parameter, Parameters, SELECT, SMater, SMater_name, S_price, Sales_ID, Sales_Name, Sales_Name\r\n, Sales_No, Settle_Caption, Settle_Fixed, Settle_No, Settle_Type, Settle_ids, Size, SpName, SqlDbType, State, TaxType_ID, Tax_Type, Users_no, Value, VarChar, Voc_no, WHName, [acct_id], [acct_no], [bill_ID], [cury_id], [cury_no], [fc_Has_amt], [fc_amt], [fc_be_amt], [fc_cash_amt], [fc_diff_amt], [fc_end_amt], [fc_not_amt], [fc_save_amt], [fc_tot_amt], [from_date], [from_id], [from_no], [lc_amt], [lc_be_amt], [lc_end_amt], [lc_not_amt], [line_no], [note], [timestamp], \r\n, \r\n\r\n, \r\n\t, \r\n\t\t\t, a_ID, acca_ID, acct_name, acct_no, assist_CD, assist_ID, beg_date, billID, bill_id, bill_no, billb_ID2, bool, cName, ca_user_ids, case, cash_date, chk_date, chk_mon, chk_type, chk_type_ID, chkcus_ctrl, cr_date, cury_Name, cury_No, cury_id, cury_ids, cury_name, cury_name\r\n, cury_no, cus_ID, cus_Name, cus_date\r\n, cus_fax, cus_id, cus_ids, cus_name, cus_no, cus_short, dept_ids, dept_no, emp_nam, emp_no, end_date, fc_Pay_tot, fc_amt_1, fc_amt_10, fc_amt_11, fc_amt_12, fc_amt_13, fc_amt_14, fc_amt_15, fc_amt_16, fc_amt_17, fc_amt_18, fc_amt_19, fc_amt_2, fc_amt_20, fc_amt_21, fc_amt_22, fc_amt_23, fc_amt_24, fc_amt_3, fc_amt_4, fc_amt_5, fc_amt_6, fc_amt_7, fc_amt_8, fc_amt_9, fc_amt_sum, fc_diff_amt, fc_diff_tot, fc_diff_vat, fc_end_amt, fc_gat_tot, fc_gat_tot_1, fc_gat_tot_10, fc_gat_tot_11, fc_gat_tot_12, fc_gat_tot_13, fc_gat_tot_14, fc_gat_tot_15, fc_gat_tot_16, fc_gat_tot_17, fc_gat_tot_18, fc_gat_tot_19, fc_gat_tot_2, fc_gat_tot_20, fc_gat_tot_21, fc_gat_tot_22, fc_gat_tot_23, fc_gat_tot_24, fc_gat_tot_3, fc_gat_tot_4, fc_gat_tot_5, fc_gat_tot_6, fc_gat_tot_7, fc_gat_tot_8, fc_gat_tot_9, fc_not_amt_1, fc_not_amt_10, fc_not_amt_11, fc_not_amt_12, fc_not_amt_13, fc_not_amt_14, fc_not_amt_15, fc_not_amt_16, fc_not_amt_17, fc_not_amt_18, fc_not_amt_19, fc_not_amt_2, fc_not_amt_20, fc_not_amt_21, fc_not_amt_22, fc_not_amt_23, fc_not_amt_24, fc_not_amt_3, fc_not_amt_4, fc_not_amt_5, fc_not_amt_6, fc_not_amt_7, fc_not_amt_8, fc_not_amt_9, fc_not_tot, fc_pay_tot, fc_rate, fc_tot, fc_vat, from_a_id, from_b_ID, from_date, from_id, from_no, from_type, from_type_ID, get_date, get_date2, htx, invo_date, invo_fc_amt, invo_fc_tot, invo_fc_vat, invo_lc_tot, invo_lc_vat, invo_ma, invo_no, invo_tot, invo_type, invo_type_ID, invo_user_ID, invo_user_No, invo_vat, invoiced_if, item_id, item_name, item_name\r\n, item_no, lc_amt, lc_amt_10, lc_amt_11, lc_amt_12, lc_amt_14, lc_amt_15, lc_amt_16, lc_amt_18, lc_amt_19, lc_amt_2, lc_amt_20, lc_amt_22, lc_amt_23, lc_amt_24, lc_amt_3, lc_amt_4, lc_amt_6, lc_amt_7, lc_amt_8, lc_diff_amt, lc_diff_vat, lc_end_amt, lc_gat_tot, lc_gat_tot_1, lc_gat_tot_10, lc_gat_tot_11, lc_gat_tot_12, lc_gat_tot_13, lc_gat_tot_14, lc_gat_tot_15, lc_gat_tot_16, lc_gat_tot_17, lc_gat_tot_18, lc_gat_tot_19, lc_gat_tot_2, lc_gat_tot_20, lc_gat_tot_21, lc_gat_tot_22, lc_gat_tot_23, lc_gat_tot_24, lc_gat_tot_3, lc_gat_tot_4, lc_gat_tot_5, lc_gat_tot_6, lc_gat_tot_7, lc_gat_tot_8, lc_gat_tot_9, lc_not_amt_1, lc_not_amt_10, lc_not_amt_11, lc_not_amt_12, lc_not_amt_13, lc_not_amt_14, lc_not_amt_15, lc_not_amt_16, lc_not_amt_17, lc_not_amt_18, lc_not_amt_19, lc_not_amt_2, lc_not_amt_20, lc_not_amt_21, lc_not_amt_22, lc_not_amt_23, lc_not_amt_24, lc_not_amt_3, lc_not_amt_4, lc_not_amt_5, lc_not_amt_6, lc_not_amt_7, lc_not_amt_8, lc_not_amt_9, lc_not_tot, lc_tot, lc_tot_1, lc_tot_10, lc_tot_11, lc_tot_12, lc_tot_13, lc_tot_14, lc_tot_15, lc_tot_16, lc_tot_17, lc_tot_18, lc_tot_19, lc_tot_2, lc_tot_20, lc_tot_21, lc_tot_22, lc_tot_23, lc_tot_24, lc_tot_3, lc_tot_4, lc_tot_5, lc_tot_6, lc_tot_7, lc_tot_8, lc_tot_9, lc_vat, line_no, master, month, msgStr, multi_dept, multi_proj, multi_staff, new, note, op_date, op_type_id, ord_column, ord_column1\r\n, out, outParams, out_no, outa_id, p_price, p_quan, p_unit, per_rate, proMode, rec_rate, ref, s_quan, scape, single_CD, single_ID, so_b_ID, so_b_id, so_date, sob_id, sqlInvo, st_Sp_ID, st_Sp_No, st_WH_no, state, state_ID, state_id, strSql, strSqlA, string, string>, tax_no, tax_rate, tax_type, tax_type_ID, top, type, unit_ID, unit_rate, user_id, user_ids, user_no, voc_no, voc_no", {0}, {1}, {2}
```

---

## SKY.NetFrameWork.BLL.Web.BIL

- BLL文件数: 6
- 业务方法数: 6
- 引用的表数: 16
- 字段总数: 27

涉及表:
```
$BIL_BillPaymentA
$BIL_BillReceivableA
$BIL_BillReceivableA_Schedule_Rpt_temp
$BIL_IncomeChequeA
$BIL_IncomeChequeA_Schedule_Rpt_temp
$GLS_VocA
$GLS_VocB
$OA_WordB
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_Bank
$SYS_Curya
$SYS_CusA
$SYS_ParCatC
$SYS_Sales
```

业务方法:
```
CheckBill
CheckBillBeforevoc
DeleteByID
GetDataByID
GetListData
checkVocDate
```

字段清单:
```
Cus_Name, \r\n, acct_name, acct_no, bank_name, bank_no, bill_no, cury_name, cury_no, dept_no, dis_rate, expire_amt\r\n, fc_rate, lc_amt, mat_date, memo, out_cus_no, out_date, out_man, pact_number, payee_bank_no, payer_bank_no, project, sales_name, sales_no, wordb_name, {1}
```

---

## SKY.NetFrameWork.BLL.Web.BOM

- BLL文件数: 22
- 业务方法数: 71
- 引用的表数: 77
- 字段总数: 221

涉及表:
```
$BOM_BOMA
$BOM_BOMA_Log
$BOM_BOMB
$BOM_BOMB_Cus
$BOM_BOMB_Loss
$BOM_BOMB_Project
$BOM_EBOMA
$BOM_EBOMB
$BOM_MKAbility
$BOM_MkCMachine
$BOM_MkCent
$BOM_MkCentB
$BOM_MkCentC
$BOM_TempletA
$BOM_TempletB
$BOM_WStation
$BOM_WStationB
$BOM_WStationB_level
$BOM_WStationB_proper
$BOM_WStationD_proper
$BOM_WStationE
$BOM_WStationF
$BOM_WStationG
$BOM_WStationH
$BOM_WStationI
$BOM_WorkA
$BOM_WorkA_Gd
$BOM_WorkB
$BOM_WorkB_UpLoadDat
$BOM_WorkC
$BOM_WorkTimeCalcA
$BOM_WorkTimeCalcB
$BOM_WorkTimeCalcC
$BOM_WorkTimeCalcFactor
$BOM_Work_Ver
$BOM_WstationC
$BOM_WstationD
$BOM_WstationI
$BOM_WstationK
$BOM_WstationL
$Bom_RestSet
$HR_Emp
$MMS_MHCal_Hole_KnifeParameter
$MMS_MHCal_Item_T
$MMS_MHCal_LaLing_DingE
$MMS_MHCal_Machining_Ration
$MMS_MHCal_Mill_KnifeParameter
$MMS_MHCal_SideLock_Ration
$MMS_MHCal_Special_Parameter
$MMS_QuotPriceC
$MOS_PlanA
$MOT_CatSet
$OA_ITEM_Classb
$OA_ITEM_Speeda
$OA_ITEM_Speedb
$OA_ITEM_itema
$OA_Project_Collect
$OA_Project_Collect_union_Seek_temp
$POS_Pricing
$QC_Item
$SKY_Orangise
$SKY_Users
$SYS_BillCategory
$SYS_CManagA
$SYS_CusA
$SYS_CusCode
$SYS_Feature
$SYS_GoodInA
$SYS_GoodInC
$SYS_InvCatl
$SYS_ParCatC
$SYS_SMater
$SYS_SpTypeA
$SYS_UpLoadDat
$SYS_WhouseA
$bom_ebomb_chk_temp
$v_SYS_GoodInA_all
```

业务方法:
```
AddUpdateLog
AutoCode
CalcCost
CalcWorkTime
CheckAttachIf
CheckBOMCycle
CheckBeforeDelete
CheckBillBeforeDel
CheckDayData
CheckExists
CheckExistsA
CheckExistsD
CheckExistsE
CheckExistsF
CheckExistsH
ChkCopy
ChkData
ChkEBOMCycle
ChkUsedE
ChkUsedF
ChkUsedG
ChkUsedH
DelOrModAllCondition
DeleteByID
DeleteSubSteps
DeleteTempData
ExecAlterChange
Exists
GeRestSetDetail
GeRestSetName
GetBomByBomId
GetChildData
GetDataA
GetDataB
GetDataByID
GetDataBywst_no
GetDataC
GetFullViewBom
GetGdInfoByCode
GetInformation
GetLastMkByCus
GetListData
GetMkAbilityDetail
GetPageData
GetSPParameters
GetSpName
GetSpNameByBID
GetUpdateLog
Getmkcentb
IntoMk
IntoOA_ITEM_ProjA
IsEmpUseBySchedule
IsMcmUseBySchedule
IsRestingNow
OffProjectMESunionData
PreWst_Proc
SelectSingleData
SetDNCSetting
SetFtp
SubItemOrderBy
UnstopOPer
UpdateGdLvCode
UpdateParentNos
UpdatePreWstNumber
UpdateWorkC
deletedateByID
getBOM_MKAbilityexec
getBOM_MkCMachine
getBOM_WStation
stopOPer
verIsExists
```

字段清单:
```
"", "select, *\r\n, 10, 100, 13784, 14002, 14817, 14828, 1\r\n, ABCPro, ABCPro_ID, BsUnit, CMName, CManagA_ID, CManagA_No, CName, Cat_Name, Classb_ID, Classb_No, CnRate, Com_IF, CuCode, Cus_Name, Cus_No, DateName, Direction, EDraNo, Emp_No, EnName, GAbbre, GColor, GStand, GdCode, GdInB_ID, GdName, Gd_ID, Gd_No, ID, IFName, ImgDes, InCod1, InCod2, InCode1, InCode2, InName, InName1, InName2, Inv_Name, Item, Item_no, Mcm_Name, Mk_Name, NoRest2_if, NoRest3_if, NoRest4_if, NoRest5_if, NoRest6_if, OIName, RelaFd, RelaID, Remark, SFName, SMater, SMater_Name, SMater_name, Scale, Size, So_No, SpName, SqlDbType, SqlValue, Type_Name, Wordb_ID, Wordb_No, Wst_ID, Wst_Name, Wst_No, \r\n, \t\r\n\t, a_ID, a_id, b_id, base, beer_quan, beer_weight, billa_id, billb_id, bom_ver, boma_id, bomb_id, cName, calc_expr, capability, cname, code, comment, cr_date, cus_list, cus_name, cus_no, cutmate_if, d_id, dept_no, distinct, emIf_ID, em_if, emp_id, emp_nam, emp_no, empid, end_date, end_date1, end_date2, end_date3, end_date4, end_date5, end_date6, fieldname, fix_name, from_name, ft_id, ft_no, gd_ID, gd_id, gd_no, id, into_if, item, item_name, item_no, item_parm, line_no, line_no\r\n, loss_rat, loss_rat\r\n, master, mat_id, mat_no, mat_no\r\n, mat_ver, mat_ver\r\n, mcm_id, mcm_name, mcm_no, mcmid, mk_id, mk_name, mk_no, mold_id, mold_no, mold_quan, new, new, note, note\r\n, op_date, op_date";, opt_ID, opt_if, opt_if_id, opt_mark, org_id, org_no, p_cost, p_m_quan, p_quan, p_quan\r\n, p_unit, p_weight, p_wm_quan, parameters, pitem, plugin, pro_id, pro_name, pro_no, r_date, rec_quan_ctrl, repl_list, runner_rate, runner_weight, s_cost, s_m_quan, s_quan, s_weight, s_wm_quan, session_id, shift_no\r\n";, so_no, sp_no, spa_ID, spb_ID, sta_date, start_date1, start_date2, start_date3, start_date4, start_date5, start_date6, strSql, string, string>, string>>, top, unit_rate, user_id, user_no, virt_if, wstID, wst_alia, wst_ename, wst_id, wst_jname, wst_jname\r\n, wst_name, wst_name\r\n, wst_no, wste_id, {0}, {1}
```

---

## SKY.NetFrameWork.BLL.Web.BUD

- BLL文件数: 10
- 业务方法数: 20
- 引用的表数: 17
- 字段总数: 35

涉及表:
```
$BUD_Acct
$BUD_FlowItem
$BUD_MakingA
$BUD_MakingB
$BUD_MakingBRpt_temp
$BUD_MakingRpt_temp
$BUD_NumSet
$BUD_Plan
$HR_Emp
$OA_WordB
$SKY_Orangise
$SKY_Users
$SYS_Cash_Set
$SYS_Curya
$SYS_CusA
$SYS_Item
$SYS_ParCatC
```

业务方法:
```
BeforeEditCheck
BeforeSaveCheck
BillSignState
CheckRepeatForCode
DataFormation
DeleteByID
GetAllChildNode
GetCashFlowData
GetCury
GetDataByID
GetListData
GetPageDataByID
GetPlaningData
GetSingleDataForTree
InsertAcct
IsCanEditByCode
StopFormation
UpdBudMaking_Flowitem
exists
getLatestData
```

字段清单:
```
17671, 17672, Acct_Name, Acct_No, CName, Cury_Name, Cus_Name, ID, Parent_No, Pro_name, Single_CD, \r\n, \r\n\t\tb.multi_staff, acct_ID, acct_Name, acct_No, acct_id, acct_no, cashPro_IF, cury_ID, cus_ID, dept_ID, emp_ID, emp_nam, item_ID, multi_clit, multi_dept, multi_firm, multi_proj, new, plan_ID, string, string>, strsqlA, {0}
```

---

## SKY.NetFrameWork.BLL.Web.CNC

- BLL文件数: 2
- 业务方法数: 1
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
CaptureMcmOperating
```

---

## SKY.NetFrameWork.BLL.Web.common

- BLL文件数: 50
- 业务方法数: 211
- 引用的表数: 41
- 字段总数: 263

涉及表:
```
$OA_WordA
$OA_WordB
$SKY_CustomReportColor
$SKY_Custom_Bill_Fields
$SKY_Custom_Bill_Rel_Table
$SKY_ExcelFieldMapping
$SKY_FieldExtenProperties
$SKY_FunReportModul
$SKY_FunctionSQLs
$SKY_Functions
$SKY_FunctionsParameter
$SKY_OperationLog
$SKY_Orangise
$SKY_ReportFieldSql
$SKY_UserFieldRelation
$SKY_Users
$SYS_BillChangeLogSet
$SYS_CManagA
$SYS_CusCode
$SYS_GoodInA
$SYS_GoodInC
$SYS_GridPanel
$SYS_GridPanelColOrder
$SYS_InvCatl
$SYS_Option
$SYS_PackInf
$SYS_ParCatB
$SYS_ParCatC
$SYS_SeekColsSetting
$SYS_SpTypeA
$SYS_Trans_End
$SYS_Trans_End_Day
$SYS_WhouseA
$SYS_WhouseB
$UserDefine
$sky_FunReportModulB
$v_SKY_FunctionProperties
$v_SYS_Trans_End_GD
$v_SYS_Trans_End_nosp
$v_SYS_Trans_End_nowh
$whs_monthA
```

业务方法:
```
APIGet
APIPost
AddCustomReport
AddTableField
AllowClose
ApplyColumnSettings
BackParamId
BatchDeleteByRelaFd
BeforeData
BeforeInsertLog
BillNo
BillStateCheck
BillsStateCheck
CName
CalculateAmount
CalculateAmountByFcTot
CateID
Category
CategoryID
Clear
ColName
ColumnOrders
CrUser
CrUserID
DefaultValue
DelBeforeCheck
DelExecutorCheck
Delete
DeleteByID
Dispose
EName
ExecCustomOperationAfterStateChanged
ExecCustomOperationBeforeStateChange
ExecUpdateCheck
ExistTimeStamp
Exists
ExistsbillNo
ExtendId
FKIDField
FName
FieldLangJson
FldState
FldStateID
GenerateSql
GenerateSysReportModul
Get
GetAIDByBID
GetAppColumnsSettings
GetBillLinkInfo
GetColorData
GetCusColumnOrder
GetCusColumnOrderAndPageSize
GetCusColumnOrderMaster
GetCustomFunctionSetting
GetCustomizedFields
GetCustomizedFieldsData
GetCustomizedFieldsWithRels
GetCustomizedFullFields
GetCustomizedRelDataTable
GetCustomizedRelUpdateSQLs
GetDataByID
GetDataVisibleFilter
GetDecimalFieldCat
GetDecimalFieldsByFuncId
GetFieldSql
GetFields
GetFieldsByTableNameForLinkFrom
GetFieldsByTableNameForLinkTo
GetFieldsByTableNameForQuery
GetFieldsForSignQuery
GetFieldsI
GetFunIdByKbNo
GetFuncBillApproved
GetFuncLinkFrom
GetFuncTablesById
GetFuncTreeData
GetGifData
GetGridColumnOrder
GetGridCustomSetting
GetGridData
GetInt
GetListData
GetLogByFilter
GetMappedFields
GetMasterColumnOrder
GetMenuTable
GetMenucode
GetPagingData
GetPropertieByCode
GetPropertiesByFunc
GetQuerySQL
GetReportByNo
GetSeekCustomizedFieldsWithRels
GetStoreByFtID
GetString
GetTableCName
GetTableNamesByFuncId
GetTablename
GetTablesAndFieldsByTables
GetTablesByTableNames
GetTimeStampByID
GetToLinkParams
GridColumnOrder
GridPanelID
HasAdjFunction
HttpGet
HttpPost
IFName
ImgDes
Import
InsertLog
IsAdjFunction
IsEmpty
IsNull
IsSubmit
IsZero
JName
LastWhereStr
LastWhereStrDescription
LineNo
Note
Optype
OptypeID
Orderby
OrgID
OrgNo
PageSize
PostBeforeWhouseCheck
PrepareQuerySql
PrintLog
PrintLog_OA
QueryPaging
RelaFd
RelaID
ResetCusColumnOrder
ResetGridSetting
ResetMasterSetting
ResetSeekSetting
ReturnGdStockEnd
ReturnStockEnd
SFName
SaveAsHomeCard
SaveFieldSql
SeekGridColumnOrder
SendFile
Set
SetAppColumnsSettings
SetAuthor
SetCusColumnOrder
SetCustomFunctionSetting
SetCustomGridOpts
SetDecimalFieldCat
SetDocFromDraftToNormal
SetGridOption
SetIfNull
SetPropertieByCode
SetSeekSQLWithCustomField
SignSubmitCommon
State
StateID
Status
SubmitCustomizedFields
TableName
TaxType
ToDatatable
TypeName
UpdateCustomReport
UpdateSubTableLineno
UploadBytes
UserID
WFCheckedStateNo
WFStateCode
WFUnCheckedStateNo
code
container
containerId
crUserId
display_name
dropTrailingFractionalZeros
expr
fieldName
fieldname
fields
fieldtype
filename
funId
fun_id
getConfigFieldText
getFieldExten
getLanguageValue
getLevelMsg_IF
getMonthOpDate
getMonthandOpDate
getSYSGoodInA
getSYSGoodInANo
getSYSGoodInC
getSYSGoodInCNo
getSYS_PackInf
handleString
initFieldExten
initLanguage
initMultiLanguage
inittFieldLang
name
pagetype
saveDat
saveData
sysoption
tablename
updateFieldExten
vExpr
```

字段清单:
```
"", "$SKY_FunctionSQLs", ".", "0", "1", "2", ";, "__userid", "c", #ID, *\r\n, *\r\n\t, 10, 1000+line_no, 121, BillApprovedDef, BillNoField, Bill_Rate\r\n, BsUnit, CName, CateID, CateID", Category, Cname, Code, ColumnOrders, ColumnOrders{0}, ColumnOrders{4}, ConBat, Cury_Name, Cury_No, DataTable>, Dictionary<string, Direction, EDraNo, EName, EnName, FName, FT_ID, FieldType, FromField, FromTable, FunctionsID, FunctionsID\r\n, GAbbre, GD_ID, GStand, GdCode, GdName, GooNum, GridPanelID, Height, Htreat, ID, ID\r\n, InCode, InName, JArray>, JName, Keys, Lenght, Length, MasterCheck, Master_WH_ID, Name, OIName, OInvNo, OragId, OrdinalIgnoreCase, PICode, PIName, PStand, PaCode, PageSize, PagingParams, Rows[i, SP_ID, SeekPath, Size, SpName, SpacNo, SqlDbType, SqlValue, TableName, UserID, Volume, WHCode, WHName, WH_ID, Weight, Wideth, \n, \r\n, admin, alias, billId, billNo, bill_id, bill_no, bool, case, cat_precision, cateID, cateId, cateids, chkModel, cname, col, col_type\r\n, concatFields, cury_id, dataType, datatype, datatype\r\n, date, dateFormat, defaultValue:, detail_id, display_name, distinct, dt, fc_rate, field, fieldIndex\r\n, fieldName, fieldName";, field_date_format\r\n, field_id\r\n, field_name, field_no, field_no\r\n, field_type, fieldname, fieldvalue, fieldwh_id, fieldwh_no, fkIdField, fldBillId, fldCAUserId, fldCRUserId, fldCaUserID, fldCrUserID, fldDeptID, forgignLang:, from, ft_user, funID, funId, fun_id, funcID, funcId, func_id, funcid, functionid, funid, grid, gridId, gridPaging, id, idforno, ignoreCase:, incode, int>, int>>, isDesc, is_newkb, is_srm, item, item["FT_ID"], item["GD_ID"], item[0], item[1], jArray, json, line_no, line_no", linkfrom, loginUserId, markID, master, masterId, modelid, name, new, new, newAlias, new_val, newcolumns, null, object>, object>>, old_val, op_dat, op_date, op_month, optValue, oragid, orderby", orgId, orgNo, panel_id, paramValue, parameter, parameters, paramvalue, pms, precision, relItemsSub[2], relItemsSub[3], relItems[1], relItems[2], relItems[3], relItems[6], rel_field, rel_table, rel_table_pfx, rel_table_pk, row["field_no"], row["val_field"], rptSqlList, seek, self, sqltxt, strEnd, strID, strStart, string, string>, string>>, strval, subFKfield_id, tableName, table_field, table_name, table_name\r\n, table_name_as, tablename, timestamp, title, top, uncheckStateCode, uncheckStateId, userId, user_ID, user_id, user_no, userid, val_field, val_table, view?.FieldLangJson, view?.Orderby, view?.PageSize, whs_barcodeb, wordb_name, wordb_no, {0}, {0}Name, {0}{3}, {1}name, {2}, {4}", {alias}.", };
```

---

## SKY.NetFrameWork.BLL.Web.EPS

- BLL文件数: 14
- 业务方法数: 45
- 引用的表数: 32
- 字段总数: 203

涉及表:
```
$BOM_MkCent
$MRP_Analy_Info
$MRP_Analy_Lack
$MRP_Analy_Mos
$MRP_Analy_Mos_back
$MRP_Analy_Pos
$MRP_Analy_Pos_back
$MRP_BillSele_All_temp
$MRP_Cmd_Mos
$MRP_Cmd_Pos
$MRP_avail_billlook
$OA_WordB
$OA_Wordb
$SDS_Sob
$SDS_soB
$SKY_Orangise
$SKY_users
$SYS_BillCategory
$SYS_CManagA
$SYS_Curya
$SYS_CusA
$SYS_Feature
$SYS_GoodInA
$SYS_GoodInB
$SYS_GoodInC
$SYS_Item
$SYS_ParCatC
$SYS_SMater
$SYS_Sales
$SYS_WhouseA
$sky_functionproperties
$sky_users
```

业务方法:
```
AddSchedule
BatchCommand
BatchDealDelete
BatchDealUpdate
BatchRecomfirm
CanDelete
CheckBillSave
Cmd_Exists
DealSearchData
DealSplitProc
DeleteByID
DeleteTempTable
Dispose
Exists
GetAllBill_nos
GetAllDataByID
GetAllFunType
GetAll_InsBillSele
GetAll_InsPartSele
GetDataByID
GetDateA
GetEPSStates
GetFunType
GetGridBillDate
GetGridPartDate
GetGridStDate
GetListData
GetListDataRelation
GetOperateDate
GetPageDataList
LockEPS
ReManufactureAnaly
RunScheduleProc
ScheduleBatchConfirm
UnlockEPS
getDate
getMRP_Analy_Orag
getMRP_Analy_Whouse
insAnaly_Feature
insAnaly_Orag
insAnaly_Whouse
updateAnalyState
updateBytype
updateEmp_type
updateMRP_Analy
```

字段清单:
```
"", "450b71a1-fea6-4c0a-8709-1d14f396f9e3", "eps_type", 120, 36000, Bom_ID, Bom_No, CMCode, CMName, CName, Code, CreateTime, CreateUserID\r\n, Cus_Name, Diameter, Direction, ExecEnd, ExecStart, ExecuteTime, FtCode, GAbbre, GColor, GStand, GWidth, GdBase, GdName, Gd_ID, Gd_No, Height, ID, ID\r\n, InDiameter, Length, OIName, Parameters, SMater_ID, SMater_name, SP_Rate, Sales_Name, Size, SqlDbType, Status, Value, WHCode, WHName, Where, \r\n, \r\n\t, ac_quan, ac_quan\r\n, anal_date, anal_id, anal_no, anal_type, anal_user_id, anal_user_no, asig_quan, beg_date, beg_zone, bill_item_no, bill_no, bill_nos, bill_nos\r\n, bill_type, billa_IDs, billb_ID, billb_line_no, billb_line_no\r\n, bom_base, bom_id, bom_if, bom_m_quan, bom_no, bom_note, bom_p_quan, bool, borr_quan, case, cate_no, cmd_date, cmd_user_id, cmd_user_no, cname, code, conf_date, conf_user_id, conf_user_no, cr_bill, cr_bill_id, cr_type, cury_id, cury_name, cury_no, cus_date, cus_id, cus_ids, cus_name, cus_no, dept_id, dept_no, dull_quan, end_date, end_zone, end_zone\r\n, err_msg, from_id, ft_id, ft_no, func_id, gd_id, gd_ids, gd_no, gros_quan, is_open, item_name, item_no, item_no";, item_order, item_order";, lack_gros_quan, lack_snet_quan, loan_quan, lock_if, lock_user_id, lock_user_no, loss_rat, mk_name, mk_name\r\n, new, note, opbeg_date, opend_date, opt_id, opt_if, opt_mark, org_id, org_names, org_no, p_bom_id, p_bom_no, p_item_no, p_item_no";, p_price, p_quan, p_unit, parameters, parent_ID, parent_id, part_no, part_nos, parta_id, partb_id, plan_if, plan_no, plana_id, pms, po_date, pob_id, pos_day, pos_quan, pplan_ids, pre_s_dat, r_date, remk_quan, repl_level, repo_quan, repu_quan, requ_date, rout_quan, s_quan, safe_quan, sale_quan, shapeif_id, snet_quan, so_ids, so_no, sob_ID, sob_id, st_nos, state, state_id, stor_quan, strSql, strSqlAA, strSql_B, strSql_D, string, string>, strwhe, temp_quan, top, type, unit_id, unit_no, user_id, usermark, val, val_date, wh_no, wordb_name, {0}, {2}, {4}
```

---

## SKY.NetFrameWork.BLL.Web.FAS

- BLL文件数: 21
- 业务方法数: 50
- 引用的表数: 36
- 字段总数: 129

涉及表:
```
$BOM_MkCMachine
$FAS_FixAdjA
$FAS_Pa_Acct_temp
$FAS_Pa_ChangeA
$FAS_Pa_ChangeB
$FAS_Pa_ChangeRpt_temp
$FAS_Pa_Change_dept
$FAS_Pa_Change_temp
$FAS_Pa_Depre
$FAS_Pa_Depre_temp
$FAS_Pa_Init
$FAS_Pa_Type
$FAS_Pa_init
$FAS_Pa_initA_temp
$FAS_Pa_init_Set
$FAS_Pa_init_dept
$GLS_VocA
$HR_Emp
$MMS_FixtureA
$MMS_FixtureB
$OA_WordB
$SKY_FunctionProperties
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_BillCategory
$SYS_CManagA
$SYS_Curya
$SYS_CusA
$SYS_GoodInA
$SYS_GoodInG
$SYS_InvCatl
$SYS_ParCatC
$SYS_SMater
$SYS_UpLoadDat
$v_SYS_GoodInA
```

业务方法:
```
AccepTance
AliUser_EarlyWarning
ChangeEndDate
ChangeRecord
CheckFc_Tot
CheckRepeatForCode
ChkIfSettleMonth
ChkNullDept
ChkPropertyGls
ChkSerial
ChkSerialNum
DelOrModAllCondition
DeleteAllType
DeleteByID
DeleteTempData
DeleteTempTable
ExecChangeBill
Exec_SpMain
GetAllData
GetBegDate
GetChange_dept
GetDataByBID
GetDataByFixID
GetDataByID
GetDataIDByVocaID
GetFixAdjbPic
GetGridData
GetListData
GetMaxIDByUser
GetOffData
GetPagingData
GetRptData
GetSerialCodeInputWay
GetSerial_Num
GetSingleDataForTree
IsCanDelBill
IsCanDelete
IsCanEditByCode
IsUsedType_ID
OperState
RunScheduleProc
SaveDataToTempTable
SaveOldDataFromInit
SetSubChange
ToFAS_Proc
UpdActTimes
UpdPaInitDepts
UpdateDeptNos
UpdateGoodinG
isnullVoc_No
```

字段清单:
```
"", "0", "1", "7", "state", *\r\n, 0\r\n, 112, 21, Acct_Name, Admin_User, CName, Category_no, Cury_ID, Cury_Name, Cury_No, Dept_ID, Dept_No, EnName, GAbbre, GStand, GdName, ID, IFName, InName, Mcm_ID, Mcm_Name, Mcm_No, Org_ID, Org_No, OutAcc_if, Pa_ID, Pa_No, Pa_name, Pa_no, Rec_Emp_No, Rec_Record, Rec_date, Repair_date, SFName, Set_Name, Spec, Unit_ID, \r\n, \r\n\t, \r\n\t\t, \r\n\t\t\tbi.{0}, \r\n\t\t\tcase, \r\n\t\t\tde.{0}, _RowType, acct_name, adj_memo, admin_user, ali_user_ID, ali_user_No, bill_id, bill_no, bool, c_amt, ca_date, ca_user_id, ca_user_no, cname, cr_date, d_amt, dep_acct_id, dep_acct_id\r\n, dep_acct_no, dep_date, dep_fc_tot, dep_mon, dept_Name, emp_nam, fc_amt, fc_rate, fc_tot, fee_acct_id, fee_acct_no, fir_fc_tot, fir_nt_tot, fix_acct_id, fix_acct_no, fixa_ID, from_type, lef_fc_tot, line_no, mark, note, note\r\n, nt_tot, op_date, org_no, orgid, p_unit, pa_date, pa_name, pa_no, page, parent_id, per, retu_Emp_No, retu_Reason, retu_date, s_quan, spec, state, strSqlA, strSqlB, strSqlC, strSqlD, strTempSql, string, string>, subtotal, type_id, type_name, type_no, unit_id, user_mark, user_no, val, voc_ID, voc_date, voc_no, voc_no\r\n, wordb_name, yu_fc_tot, {0}, {1}
```

---

## SKY.NetFrameWork.BLL.Web.Freeforms

- BLL文件数: 3
- 业务方法数: 6
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
Billisenable
DeleteByID
GetDataByID
GetFormCategory
GetListData
GetUpModel
```

---

## SKY.NetFrameWork.BLL.Web.FX

- BLL文件数: 4
- 业务方法数: 14
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
AddSoa
addOrUpdateSoaData
getCustomer
getPayTem
getSaleMan
getShipment
getSigleRecord
getSoQuota
getSoQuotb
getSoQuotbByKey
getSoaAll
getSobByKey
getSobByQNo
getSobUnit
```

---

## SKY.NetFrameWork.BLL.Web.GLA

- BLL文件数: 11
- 业务方法数: 23
- 引用的表数: 19
- 字段总数: 17

涉及表:
```
$GLA_BankInitA
$GLA_CashBook
$GLA_CashBookRpt_temp
$GLA_DepoBook
$GLA_DepoBookRpt_temp
$GLA_MoneyDailyRpt_temp
$GLA_MoneyMonthlyRpt_temp
$GLS_VocA
$HR_Emp
$OA_WordB
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_BillCategory
$SYS_Curya
$SYS_CusA
$SYS_Item
$SYS_ParCatC
$Sys_Curya
```

业务方法:
```
BeforeInit
BeforeUnInit
CheckBalaBeforeAdd
ChkDayLineNo
ClearTempData
CreateVoc
DeleteByID
DoSearch
ExistsAcct
ExistsLine_No
GetBankBalaAmt
GetDataByAcct
GetDataByID
GetDayLineNo
GetDepoBookAmt
GetGLA_CashInitState
GetLcAmt
GetListData
Get_BankInitState
Getline_noByAcct
Init
IsNotInit
UnInit
```

字段清单:
```
*\r\n, 1\r\n, \r\n, cr_date, cr_user_no, emp_nam, emp_no, from_tag, settle_date, settle_type_no, single_cd, sub_no, top, voc_serial, voc_type, wordb_name, {1}
```

---

## SKY.NetFrameWork.BLL.Web.GLS

- BLL文件数: 38
- 业务方法数: 138
- 引用的表数: 87
- 字段总数: 298

涉及表:
```
$APS_AccVocA
$APS_AccVocB
$APS_InitB
$ARS_AccVocA
$ARS_AccVocB
$ARS_AccountAB_temp
$ARS_InitB
$ARS_ReceiptA
$ARS_ReceiptA_back
$BOM_MkCent
$BOM_WStation
$Cost_AMate_Voc
$Cost_Mate_Voc
$Cost_Product_Voc
$Cost_Sales_Voc
$Cost_Stock_Voc
$Fas_Pa_Init
$GLS_AcctAgingAnalysisRpt_temp
$GLS_AutoTransA
$GLS_CostReckoning_temp
$GLS_InitA
$GLS_InitB
$GLS_Journal_Report_temp
$GLS_MultiFieldA
$GLS_MultiFieldB
$GLS_MultiField_Rpt_temp
$GLS_MultiField_Rpt_tempB
$GLS_RPT_CashFlowSheet_temp
$GLS_SubsLedger_temp
$GLS_VocA
$GLS_VocB
$GLS_VocB_Cash
$GLS_VocB_Memo
$GLS_VotA
$GLS_VotB
$GLS_VotC
$GLS_cost_AccVocA_temp
$GLS_cost_AccVocB_temp
$Gls_AcctBalance_sp_temp
$Gls_DayVoc_sp_temp
$Gls_Details_sp_temp
$Gls_Ledger_detail_quanamt_sp_temp
$Gls_Ledger_quanamt_sp_temp
$Gls_Ledger_sp_temp
$Gls_VocSum_sp_temp
$HR_Emp
$RPT_GLS_BlanceSheetA
$RPT_GLS_BlanceSheetB
$RPT_GLS_IncomeStatementA
$RPT_GLS_IncomeStatementB
$SDS_OutA_back
$SKY_FieldExtenProperties
$SKY_FieldParams
$SKY_FunctionProperties
$SKY_Functions
$SKY_FunctionsParameter
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_BillCategory
$SYS_Cash_Set
$SYS_Curya
$SYS_Curyb
$SYS_CusA
$SYS_GoodInA
$SYS_InvNoE
$SYS_Item
$SYS_Option
$SYS_ParCatB
$SYS_ParCatC
$SYS_Settle
$SYS_UpLoadDat
$SYS_WhouseA
$SYS_WhouseB
$WHS_AdjA_back
$WHS_MoveA_back
$cash_set_Count_temp
$gl_CashSheet
$gls_balance_rpt_dept_temp
$gls_balance_rpt_temp
$gls_detailacco_sp_temp
$sys_acct
$sys_cusa
$v_SYS_Acct
$whs_BorrA_back
$whs_RetuA_back
$whs_ScrapA_back
```

业务方法:
```
APSCheckNotExec
BatchPosting
BillifCheckAccount
CalcBalance
ChangeNum
Check
CheckA
CheckExistRecord
CheckExistsFun
CheckExistsNo
CheckSearch
CheckSearchB
ChkSerial
ChkSerials
ClearFaVocNo
ClearOtherData
ClearTempData
CreateVoc
DelOrModAllCondition
DelVot
Delete
DeleteByID
DeleteTempRecord
DeleteTempTable
DoSearch
ErasebackNo
ExecRate_AdjustMain
Exec_AntiMonthSettle
Exec_GetCuryRate
Exec_MonthSettle
Exec_SpMain
Exists
ExistsPeriod
ExistsVoc
GetAcctsByParent
GetAll
GetAllData
GetAllFunc
GetAllItmes
GetAllList
GetBalanceSheetA
GetBalanceSheetB
GetBatchVocs
GetBillTypeByFun
GetBillTypeByFuns
GetCheckAll
GetData
GetDataByID
GetDataByMonthAndDepts
GetDateAcctByID
GetDeptLatestDate
GetExistsMon
GetFormatData
GetFormatItems
GetFormatItemsWithVal
GetFunType
GetLastMon
GetLastMonthLoginNa
GetListData
GetMaster
GetMaxAcctLevel
GetMemoID
GetMenuCode
GetMulti
GetMultiVersion
GetNextCheckID
GetNowMon
GetOldCheckMonth
GetOrgLatestDate
GetPagingData
GetPostingAll
GetQuanAmtData
GetQuanAmtDetail
GetSearchAcctCount
GetSeekData
GetSerialCodeInputWay
GetSerialType
GetSingle
GetSomeFunc
GetSub
GetSubData
GetTable
GetTablesAndMoneyFieldsByFuncID
GetTypeFieldByFuncID
GetVer_IDByVer_no
GetVerification
GetVocA
GetVocB
GetVocBByID
GetVocBList
GetVotAByVotAID
GetVotBByVotAID
Get_Calc_Mon
InitMultiVersion
MasterValidation
ModifyAudit
Post
Posting
ReCheck
ReRunWater
RecSerial
RedVoc
RunScheduleProc
SearchVotProc
SelectAllDate
SelectDate
SetVersionState
UnCheck
UnPost
UnReCheck
UpSerial
UpdateDeptNos
Voc_Export
deleteVoc
dispVoBMemo
getAccountUpdateSQL
getAcctsInfo
getAllInitA
getAllInitB
getDaByID
getDate
getInitFlag
getInitFlagUpdateSQL
getInitVocSQL
getInitVocUpdateSQL
getInitbcount
getVoBMemo
getVoBMemoA
getVoc
getVocA
getVocDat
getVocDate
getVocPostingDat
getVocTagByI
getcost_mon
getebal
unCheckA
unPosting
```

字段清单:
```
"", "0", "1", "B", "DB", "DC", "DF", "DL", "DY", "Err_Msg", "F", "JB", "JC", "JF", "JL", "JY", "L", "Y", "a", "aQM", "a_e", "b", "c", "delete, "lNC", "lQM", "l_b", "l_e", "select, "yyyyMMdd", $"select, *\r\n, -1, 0m, 10, 112, 121, 1\r\n, 20, 23, 2}, 36000, Acct_DC, Acct_DC\r\n, Acct_DC\r\n\r\n--step2:父阶：合计“子科目”借贷方余额，逐阶向上\r\ndeclare, Acct_Name, Acct_No, BsUnit, BsUnit_ID, CName, Cash_IF, Code, Credit_IF, Credit_IF\r\n, Cury_Case, Cury_ID, Cury_Name, Cury_No, Cus_Name, Direction, Emp_ID, Emp_No, GdName, ID, Item_ID, Item_No, Limit, MenuCode, Merge_if, Message, OragCD, OragID, OragId, Parameter, Parameters, SELECT, SFName, Serial, Serial_full, Settle_ids, Size, SortedDictionary<string, SqlDbType, SqlStr, SqlValue, Value, Voc_type_ID, Vot_IDs, Vot_date, Vot_type1, Vot_type2, Vot_type3, Vot_type5, Vot_type6, \r\n, \r\n\t, aID, a_id, acc_id, accessory, acctNo, acctYear, acct_all_name, acct_dc, acct_id, acct_name, acct_name\r\n, acct_no, acct_no\r\n, acctbeg, acctend, actual_calc_expression, assist_CD, assist_ID, assist_cd, assist_id, b_bal, b_exp, b_fc_tot, b_lc_tot, b_quan, balCode, balances, beg_date, bill_ID, bill_no, bill_type, bill_type_id, bool, c_amt, c_fc_amt, c_lc_amt, c_price, c_quan, ca_date, ca_user_ids, ca_user_no, calc_expression, calc_symbol, category_id, checkID, chk_type, cname, cost_mon, cr_date, curyId, cury_ID, cury_case, cury_id, cury_ids, cury_name, cury_no, cus_id, cus_ids, cus_name, cus_no, d_amt, d_lc_amt, d_price, d_quan, dc, dc_id, dc_price, deptCD, deptID, dept_id, dept_ids, dept_no, detailIf, double[]>, double[]>>, e_bal, e_exp, e_fc_tot, e_lc_tot, e_quan, emp_No, emp_id, emp_nam, emp_no, end_date, fc_amt, fc_rate, field_id, fieldname1, from_id, from_no, from_op_date, from_tag, from_tag_id, from_type, froma_id, funcID, id, index, init_date, int, item_ID, item_No, item_id, item_name, item_name\r\n, item_no, item_type, key:, lc_amt, level, line_no, line_no\r\n, line_no\r\n", memo, memo_id, memo_name, memo_no, mk_ids, mk_name, multi_bill, multi_clit, multi_dept, multi_firm, multi_proj, multi_staff, multi_ver_id, name, new, new, no, note, nt_amt\r\n, null, num, obj_id, obj_no, op_date, op_mon, oragcd, oragid, org_ID, org_No, org_id, outParams, p_unit, pacode, param, parent_no, per, period, price, price\r\n, pro_ID, pro_No, pro_name, pro_no, quan, quanamt_IF, row_no, s_price, s_quan, serial, serial_full, single_CD, single_id, sql, sqlWhere, state, state_ID, strSql, strSqlA, strWhere, string, string>, subAcctIds, top, type, type_id, type_name, type_no, user_id, user_ids, user_mark, user_no, val, val_no, val_rule, valexps[i], voc_date, voc_id, voc_no, voc_type, voc_type_id, wst_name, year, yearper, {0}, {1}, {2}, {6}ord_line, {field_name}
```

---

## SKY.NetFrameWork.BLL.Web.GRC

- BLL文件数: 18
- 业务方法数: 38
- 引用的表数: 18
- 字段总数: 79

涉及表:
```
$GRC_AVAStockReport
$GRC_OrgStockReport_temp
$GRC_SaleDailyReport
$GRC_SaleDetailReport
$GRC_StockReport
$SKY_Orangise
$SKY_Users
$SKY_WebStation
$SYS_CManagA
$SYS_GoodInA
$SYS_InvCatl
$SYS_ParCatC
$SYS_WhouseA
$SYS_WhouseB
$grc_drafta
$grc_draftb
$grc_offsetentera
$grc_reportitem
```

业务方法:
```
CheckData
CheckExistsCode
CheckPro_typeChange
ClearTempData
DelCheckBill
DelStockReport
DeleteByID
DeleteGrc_draftb
DoQuery
ExecGLS_BlanceSheet_Data_Main
ExecGLS_BlanceSheet_Version_Main
Exec_Organ
GetAVAStockReport
GetDailyReport
GetDataA
GetDataB
GetDataByID
GetDetailReport
GetDraftData
GetInit_if
GetListData
GetOffCheckData
GetOrgAll
GetProData
GetRemoteOrgan
GetStockReport
InitDataFun
InsertAVAStockReport
InsertDailyReport
InsertDataFun
InsertDetailReport
InsertStockReport
Pair
UnInitDataFun
UpdateOrgs
delSaleDailyReport
delSaleDetailReport
getPagingDat
```

字段清单:
```
BsUnit, CMCode, CMName, CMngA_ID, CName, Code, Cus_ID, DBName, FtCode, FtName, GStand, Gd_ID, ID, IID, InCode, InName, OragID, OragName, RepId, SELECT, Sales_ID, SpName, SpacNo, UserID, WHName, Where, [CMngA_Nam], [CMngA_No], [Cus_nam], [DeptNam], [Express_No], [FC_Tot], [FC_diff_Tot], [GStand], [Gd_No], [InCode], [InName], [OragName], [OutB_Note], [Out_User_Nam], [Qry_user_Nam], [RepId], [Sales_Nam], [Sales_No], [UserID], [Users_no_Nam], [cury], [cus_no], [gdName], [lc_Tot], [lc_diff_Tot], [op_dat], [out_dat], [out_no], [out_state], [rt_no], \r\n, \r\n\t, cont_fax, cont_nam, cont_tal, dra_no, gdCode, gdName, gd_id, item_name, null, org_id, org_name, org_no, out_id, parent_no, remote_id, remote_if, remote_name, string, top, whName, whcode
```

---

## SKY.NetFrameWork.BLL.Web.HR

- BLL文件数: 3
- 业务方法数: 16
- 引用的表数: 15
- 字段总数: 28

涉及表:
```
$BOM_MkCMachine
$BOM_WStation
$HR_EMP_Family
$HR_Emp
$HR_EmpAttendance
$HR_Emp_Job
$HR_Emp_Post
$HR_Emp_Train
$HR_Emp_WorkGroup
$Hr_Emp_Edu
$OA_ITEM_Defend
$OA_WordB
$SKY_Orangise
$SKY_Users
$SYS_ParCatC
```

业务方法:
```
BatchAdd
ChkExists
DeleteByID
Exists
ExistsByNo
GetCard_NoByID
GetCodeByID
GetDataByEmpNo
GetDataByID
GetDataLine
GetDataToNo
GetListData
GetWorkGroupEmps
HoursShare
IsInUser
Quit
```

字段清单:
```
120, 1\r\n, CName, ID, Org_ID, QRcode_if, ReUser_No, SELECT, Size, SqlDbType, SqlValue, Wordb_name, Wst_No, \r\n, cname, ctrol_if, emp_nam, emp_no, item_name, loginname, mcm_Name, mcm_No, new, password, string, wordb_name, wordb_no, wst_name
```

---

## SKY.NetFrameWork.BLL.Web.KB

- BLL文件数: 1
- 业务方法数: 1
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
getData
```

---

## SKY.NetFrameWork.BLL.Web.MMS

- BLL文件数: 105
- 业务方法数: 369
- 引用的表数: 177
- 字段总数: 867

涉及表:
```
$AMA_MouldTargetAllocation
$BOM_MkCMachine
$BOM_MkCent
$BOM_WStation
$BOM_WStationD
$BOM_WStationH
$BOM_WStationJ
$BOM_WorkB
$BOM_Wstation
$BOM_WstationB
$HR_EMP
$HR_Emp
$HR_EmpAttendance
$HR_WorkShift
$MMS_AdjA
$MMS_AdjAB_TrackRpt_Temp
$MMS_AdjB
$MMS_AdjChangeRecord_temp
$MMS_Chrome
$MMS_Collect
$MMS_Collect_QcWork_temp
$MMS_Collect_union_seek_temp
$MMS_CostCPK
$MMS_CostFOB
$MMS_CraftsA
$MMS_CraftsA_Back
$MMS_CraftsA_Batch_Temp
$MMS_CraftsA_Down
$MMS_CraftsA_Item
$MMS_CraftsB
$MMS_CraftsB_Back
$MMS_CraftsB_Batch_Temp
$MMS_CraftsB_Disch
$MMS_CraftsB_Item
$MMS_CraftsB_Item_view
$MMS_CraftsB_RePush_Temp
$MMS_CraftsB_chk_cycle_temp
$MMS_CraftsC
$MMS_DeviceA
$MMS_DeviceA_back
$MMS_DeviceB
$MMS_DeviceC
$MMS_DeviceD
$MMS_DeviceE
$MMS_DeviceF
$MMS_EmpMcmPriceA
$MMS_EmpMcmPriceB
$MMS_FitPrice
$MMS_Fitting
$MMS_FittingA
$MMS_FittingB
$MMS_FittingC
$MMS_FixtureA
$MMS_FixtureA_Mcm
$MMS_FixtureA_back
$MMS_FixtureB
$MMS_FixtureC
$MMS_FixtureD
$MMS_FixtureE
$MMS_GdProgressEKB_temp
$MMS_InMCMSchedule
$MMS_InMCMSchedule_past
$MMS_InjMoldA
$MMS_InjMoldB
$MMS_InjMoldB_sch
$MMS_LeanProduction_temp
$MMS_MCMSchedule
$MMS_MES_OffData
$MMS_MES_OffData_temp
$MMS_Man_ScheduleA
$MMS_Man_ScheduleB
$MMS_MkChart
$MMS_NoMCMSchedule
$MMS_PartA
$MMS_PartB
$MMS_PartB_FilterTemp
$MMS_PartB_ToOut_temp
$MMS_PartB_allo
$MMS_PartB_back
$MMS_PartWorkPlanRpt_temp
$MMS_Plates
$MMS_PlatesQuotA
$MMS_PlatesQuotB
$MMS_Pricea
$MMS_Pricea_Type
$MMS_QuotA
$MMS_QuotB
$MMS_QuotC
$MMS_QuotD
$MMS_QuotDPrice
$MMS_QuotE
$MMS_QuotPriceA
$MMS_QuotPriceB
$MMS_QuotPriceC
$MMS_ScheduleA_SelAdd_Temp
$MMS_Schedule_Search_Temp
$MMS_Schedule_report_temp
$MMS_SendBan
$MMS_ShipAddress
$MMS_SparePartsA
$MMS_SparePartsB
$MMS_Split_temp
$MMS_Style
$MMS_TonPrice
$MMS_WareA
$MMS_WareA_back
$MMS_WareB
$MMS_WareC
$MMS_WareD
$MMS_WareE
$MMS_WorkA
$MMS_WorkAB_temp
$MMS_WorkA_Emp_report_temp
$MMS_WorkB
$MMS_WorkBShift_temp
$MMS_WorkB_FlipMat
$MMS_WorkB_Mtain
$MMS_WorkB_Mtain_temp
$MMS_WorkC
$MMS_WorkDivision_list
$MMS_WorkWstPerformance_temp
$MMS_Work_list_temp
$MMS_WstPerOutPut_temp
$MOS_PlanA
$MOS_PlanA_back
$MOT_CatSet
$McmActivation_Stat_report_temp
$McmActivation_mon_report_temp
$OA_CRM_CusA
$OA_ITEM_Classb
$OA_ITEM_Speedb
$OA_ITEM_Speedb_temp
$OA_ITEM_itema
$OA_WordA
$OA_WordB
$POS_Pricing
$QC_Item
$SDS_SoB
$SDS_soA
$SDS_soB
$SDS_soB_back
$SKY_FunctionProperties
$SKY_Orangise
$SKY_Users
$SYS_BillCategory
$SYS_CManagA
$SYS_Curya
$SYS_CusA
$SYS_DealCost
$SYS_GoodInA
$SYS_GoodInG
$SYS_InvCatl
$SYS_Item
$SYS_MsUnit
$SYS_PackInf
$SYS_ParCatB
$SYS_ParCatC
$SYS_SMater
$SYS_SMaterB
$SYS_Sales
$SYS_Settle
$SYS_SpTypeA
$SYS_UpLoadDat
$SYS_WhouseA
$SYS_WhouseB
$Sys_Curya
$Sys_CusA
$bom_wstation
$h_performance_report_temp
$keyword
$sys_avail_stock
$sys_goodina
$v_SYS_GoodInA
$v_SYS_GoodInA_all
$v_SYS_Trans_End_GD
$v_SYS_Trans_End_NormalGdFt
$v_SYS_Trans_End_now_st
```

业务方法:
```
AddCheckDate
AddDataToTableFromCraftsB
AddMatOutLog
AddSchedule
AddToMosOut
AfterCopy
AppsMMS_CraftsData
AssistReport
AutoElec
AutoMatchMatToMOS_Out
AutoMatchMateSize
AutoSch
AutoSchCancel
AutoToolMat
BatchAddCraftsBByAID
BatchModif
BatchUnBind
BeforeDeleteCheck
BeforeSaveCheckAjdMode
BeforeSaveCheckQuan
BeforeSignSubmit
BillCancelLock
BillLock
BillPost
BillStop_Proc
BillTo_Standard
Bind
CallBackAbnorImproveB
CanOperate
CanSaveWst
CancelBillPost
CancelSch
CaptureForwardSchedule
ChangeEvaluateC
ChangeQuotState
ChangeSel_if
CheckAndDataDeal_Main_Proc
CheckBillBeforeDel
CheckBillData_FlipMat
CheckBillUsedIf
CheckBillVersion
CheckDTableOverAlloAmt
CheckDTableSQuan
CheckDate
CheckDel
CheckDeleteBill
CheckExistsCode
CheckExistsNo
CheckFixNo
CheckMat_NoRepeatValue
CheckNStandMat_NoValue
CheckNo
CheckNotWstRec
CheckOver
CheckTarVal
Checkline_ID
ChkCraUsed
ChkCrbUsed
ChkCrcProgramName
ChkCrcUsed
ChkDataBeforeSplit
ChkExists
ChkMasterData
ChkMatNoByPlanaId
ChkOverSt
ChkRFIDUsed
ChkSametimeCycle
ClearCAMConfigs
ClearCheckStock_Temp
ClearTempData
CodeType
CompletedDailySub
CopyAfterSyncData
CopyCRBUpLoadDatImage
CopyChildTableData
CopyEvaluateC_Child
CopyOtherBill
CopyOtherData
CopyPartImage
CopyQCImage
DTableAutoGoods
DataType
DealBatchNewDataAdd
DealBatchNewDataSelect
DealChecked
DealOnToOffData
DealSplitProc
DealUpdateSort
DealWorkBFlipMat
DelMatOutLog
DelMcmSchedule
DelQuotPriceC
DeleteAllData
DeleteBillByID
DeleteByBillB_ID
DeleteByID
DeleteBySelectIDs
DeleteFilterTempData
DeleteFilterbyid
DeleteSearchRecord
DeleteSelectRecord
DeleteSubItem
DeleteSubSteps
DeleteTemp
DeleteTempData
DeleteTempTable
DeleteTempTableData
Dispose
DoBatchDeleteA
DoBillLock
DoMESReport
ERPField
ERPFieldName
ExecChangeBill
ExecSettle
ExecUnSettle
ExistVerifyBysch_idS
Exists
ExistsBomVer
ExistsFit_No
ExistsQuotPrice
ExistsQuot_No
ExistsWare_No
Existsdev_No
Existsfix_No
FixMcmEmpSchedule
GetABDiffPrice
GetAllMcm
GetAllquan
GetApiData
GetAutoBthMatGridData
GetBMarginByCus
GetBeginDate
GetBeginingData
GetBillAuto_IF
GetBillDataByID
GetBillTableByFuncID
GetBomVersion
GetBom_ver
GetCalcRate
GetChartById
GetChartData
GetColororUnitData
GetCraftParam
GetCraftsAOutPut
GetCraftsBAc_Quan
GetCraftsByLine_ID
GetCraftsWKDetail
GetCus_IDByNo
GetDTablePagingData
GetDataByID
GetDataByLineIDAndLineNo
GetDataBySearch
GetDataList
GetDefaultStyle
GetEmpByReUser
GetEmpStatus
GetEvaluateCByC_ID
GetFittingCostPrice
GetFittingCostPriceByGd
GetGdByCode
GetGridTitleName
GetGridTitleText
GetHr_EmpWorkGroup
GetItembByAID
GetLastDataID
GetLine_IDByEDraNo
GetLine_IDByRFID
GetLine_Id
GetLinkDataApsSch
GetListData
GetMCMScheduleDate
GetMCMState
GetMMSPartAState
GetMMS_PartBByID
GetMMS_SparePartsB
GetMachPrice
GetMat_IDByMat_No
GetMaxItemNumber
GetMaxItemValue
GetMaxMinDateByBillaID
GetMcmInfo
GetMcm_ByEmp
GetMcm_Mtain
GetMesPassword
GetMmsMcmByWst
GetMmsMcmSchedule
GetMmsWorkbData
GetMosPlanData
GetMtainReasons
GetNewDataAdjA
GetNewDataCraftsA
GetNewSortFilterString
GetNoMcm_EmpNo
GetOffMachData
GetOnData
GetOptionValue
GetOutsourcingData
GetPageDataByID
GetPageDataList
GetPartCostPrice
GetPartData
GetPieceNames
GetPlanListData
GetPlanListSql
GetPlatePrice
GetPlatesData
GetPobPartbIdsBySpbId
GetPreAndNextCb
GetQuotANewData
GetQuotBData
GetQuotBDataByPlatNo
GetQuotBTol
GetQuotCDataByFitNo
GetQuotPrice
GetQuotPriceAcheck_if
GetQuotPriceBycrb_ID
GetRootStepItem
GetSMater
GetSMaterData
GetSchData
GetSchIDByCrbID
GetSchduling
GetSchdulingMcms
GetSoaIDBySobID
GetStateRate
GetStyleData
GetSubStepItem
GetTimestampByMIds
GetTreeData
GetVersionByPlat
GetWFUploadIcons
GetWStationItem
GetWordbByCode
GetWstBy_MMS_CraftsID
Getmat_noBygd_a
ImportChart
ImportFromExternal
InsertArs
InsertDevA
InsertWareA
IntoBom
IntoFAS_FixAdj
IntoMMS_WorkB_QuotPrice
IsCanDelete
IsCanDeleteBill
IsCanManageItem
IsCheckedBill
IsExeChanged
IsExistGDBom_ver
IsExistParts
IsExistPlatVersion
IsExistsPartA
IsExistsPeiceByGdID
IsExistsPlat_No
IsExistsSameItem
IsMatInPlan
IsPlanWork
IsRecipientMat
IsRepeatForMat_No
IsUsedBill
IsUsedForCraftsA
IsUsersCraftsA
IsUsesBillDTable
IsWKCalcAUsing
IsWKCalcBUsing
IsWorkIng
LoadDataFromPlan
LoadDataFromlineIDSeek
LockBill
LockBills
MMSCraftsASelectAndNew
MakeBillFromTempData
Model
ModifyMode
NCTag
NCTagSeparator
OperState
PLMDir
PartLevel
PreWst_Proc
QueryData
QueryOtherStyle_No
QuotPriceB_facthour
RFIDBindLine_ID
RefDegreeByQuan
RefLineNo
RefPer_rate
RefQuanByWrokIf
RefreshLine
RunScheduleProc
SavaPrintLog
Save
SaveCraftsBItems
SaveData
SaveDataToBthMatTempTable
SaveItemNos
SaveMMS_AdjCData
SavePrintData
SaveProcLotNo
SaveSchedule
SaveSob
ScheduleWayIf
Schedule_BatchAlter
Schedule_BatchSort
Schedule_BatchStopIF
SchedulingQuery
Search
SearchOffMachData
SetCalcRate
SetOperateLog
SetOptionValue
Settle
ShiftDelete
StopBill
SubItemOrderBy
SubOrderByItem
Suspend
SynchOffer
TMoldStart
TimeUnit
Title
ToMMS_CraftsAB
ToneIntoSchedule
UQuotDPrice
URated_hour
UnSettle
UpdActTimes
UpdQuotDPlates
UpdateAcUser
UpdateCraftsbWithSch
UpdateEdition
UpdateGStand_Note
UpdateGoodinG
UpdateGuidance_doc
UpdateHour
UpdateIntoGdIf
UpdateItem_Max_Value
UpdateMatOutLog
UpdatePerRate
UpdatePreWstNumber
UpdateSchedulByCraftsB
UpdateState
UserMark
calcFactHour
clamp
clear_QuotPrice
crc_id
deleteTempData
doUpdateSortDateByAlter
filePath
ftName
getChartDetailData
getCuryByID
getMmsWorkbDataByLineId
getPartbByGd_id
getmat_idBymat_no
isNewCrc
line_no
order
pgNo
plmid
pro_name
pro_note
pro_tool
time_unit
unLockBill
unStopBill
updateMcms
```

字段清单:
```
"", "0", "1", "3", "MMS_Collect_union_seek_temp", "MMS_PartB_Auto", "MMS_Quot_API_temp", "auto_sch_enable_if", "bill_no", "mcm_priority_if", "state", "table", "taxprice", "上传程序单文件异常：", "数据验证通过！", #MMS_AdjB_diff, #MMS_PartB_diff, $"<root>{xe}</root>", *\r\n, --, --实际开工日\r\n, --计划开工日\r\n, --输出消息\r\n, --错误码, 0m, 10, 100, 1000, 1008", 1008\r\n", 101, 112, 120, 14697\r\n, 14698, 14699, 14769\r\nelse, 14770\r\nelse, 14771\r\n, 14771\r\nelse, 14772", 14772\r\n, 14903\r\nelse, 14904\r\nelse, 14905\r\nelse, 14906\r\nelse, 14907\r\nelse\r\n, 14912\r\n, 15, 15497\r\n, 15498\r\n, 15499\r\n, 15500\r\n, 16500\r\n, 16500\r\nelse, 16501\r\nelse, 16502\r\n--else, 16564, 16565, 16566, 16782, 16783, 16784, 16785, 17995\r\nelse, 19, 1\r\n, 1\r\nelse\r\n, 1m, 20, 2053, 2054, 21, 300, 34, 360, 3600, 36000, 7\r\nelse, ABCPro, ABCPro\r\n, ABCPro_ID, AID, A_ID, AbsolutePath, AdjA_ID, Adj_User_ID, Adj_date, BID, BdSp_ID, BdSp_No, BdWh_ID, BdWh_No, BillID, Billa_ID, Billb_ID, Bom_Style, Bond_SP_No, Bond_WH_No, BsUnit, BsUnit_ID, CMCode, CMName, CManagA_ID, CManagA_No, CMngA_ID, CMngA_No, CName, Ca_User_ID, Ca_User_No, CalcIF_ID+, Cat_ID, Cat_Name, Cat_No, Cavity, CavityBase, Code, CodeIF_ID, Cost_Name, Cost_Name\r\n, CraftsA_ID, Crafts_Explain, CuCode, Cury_Name, Cury_Name\r\n, Cury_No, Cus_ID, Cus_Name, Cus_Name\r\n, Cus_No, Cus_No\r\n, Decimal, Dept_No, Depth, Diameter, Dictionary<string, Die_Drawing, Direction, EDraNo, Edrano, Emp_ID, Emp_No, EnName, EnName\r\n, Exte_Type, Exte_if, F1, F2, F3, FMater_ID, Ft_ID, Ft_No, GAbbre, GStand, GStand_Note, GStand_Note_id, GWidth, GWidth_if, GdArea, GdCode, GdInB_ID, GdName, Gd_ID, Gd_No, Height, Htreat, ID, ID\r\n, ID\r\n\t\t\t\t\t, IEnumerable<dynamic>, IEnumerable<string>, IFName, IFName\r\n, IList<string>, InCod1, InCod2, InCode, InCode1, InCode2, InDiameter, InName, Item, Item2, Item3, Item_nam, Item_nam\r\n, Item_no, Item_nos, JObject, Length, List<HashTableEx>, Lock_User_ID, Mat_ID, Mat_No, Mcm_ID, Mcm_Name, Mcm_No, Mk_ID, Mk_No, Model, MosRec_if, MtainNote, NetWeight, NoMcm_if, Org_ID, Org_No, Org_id, Output, Output_if, OverTimeV, Parameters, Parameters2, PartA_ID, PartB_ID, QC_AImproveAID, QC_AImproveANo, QC_AReportAID, QC_AReportANo, RFID, ROHS, Rec_ID, Rec_No, Recent_date, Recursive:, RelaFd, RelaID, RemoveEmptyEntries, Repair_date, SArea, SFName, SMater, SMater_ID, SMater_Name, SMater_name, SMater_quan, SModel, S_SWeight, Sales_Name, Scrap_date, Settle_Caption, Size, Soa_ID, SpName, SpTypeA_ID, SpTypeA_No, Sp_ID, Sp_No, SqlDbType, SqlStr, SqlStrA, SqlStrB, SqlValue, Stand, State_ID, String, Style_ID, Style_Name, Style_No, Suspend_if, TableFieldInfo>, TableFieldInfo>>, Tables[0].Rows[0]["ID"], Tables[0].Rows[0]["PartA_ID"], TargetValue, TaxType_ID, Tax_Rate, Tax_Type, Thick, Type_Name, Uline_ids, UpID, User_ID, User_No, Value, VarChar, WHName, Weight, Wh_ID, Wh_No, Width, Wordb_ID, Wordb_Name, WorkIF_ID, Work_IF, Wst_ID, Wst_Name, Wst_No, X1, X2, X3, Z1, Z2, Z2_ID, Z3, Z3_ID, [name], [timestamp], \n, \r\n, \r\n--, \r\n\t, \r\n\t\t, aID, a_ID, a_id, ac_quan, ac_quan-a.down_rec_quan, actualValue, add_if, addendIf, address, adj_cnt, adj_no, ali_date, ali_user_No, ask_no, askb_id, assign_if, assist_crb_ID, assist_wst_id, autoCraft_partaId, b_id, b_ids, ban_Name, ban_t, base_quan, base_quan\r\n, beg_date, beg_date";, begin_date, bid, billId, bill_no, billaID, billa_ID, billa_ids, billb_ID, binding_if, bomVer, bom_style, bom_ver, bomver, bool, bt_Cnt, ca_date, cal_mon_oee, cal_today_hours, calc_if, calc_rate, case, cat_name, cate_id, cb_if, change_ID, chart_data, chart_data\r\n, chart_name, check_if, chkNoPosRecIf, chk_if, chkno_mcm, chold_if, cname, cnc_feed_override, cnc_feed_rate, cnc_prg_name, cnc_sp_override, cnc_sp_speed, code_if, colIndex, commandType, controlIF_ID, control_if, controlif_id\r\n, crDate, cr_date, cra_total, crbId, crcRow[key], crfRow[key], crfc_ID, crfc_id, crsftb_id, cury_Name, cury_id, cury_name, cury_no, cus_ID, cus_date, cus_id, cus_name, cus_no, cus_ord, data, data2, dataCnt:, dataObj, day_cnt, day_per_rate, days, deal_way, decimal, decimal>, defaultValue:, degree, deli_quan, deli_space, dep, dev_ename, dev_name, dev_no, dia, dirID, direction:, disable, discount, distinct, do_total, double, down_a_ID, down_b_ID, down_b_id, down_rec_quan, downs, dy_if, dynamic, e_piece_name, edition, effic_rate, emp_ID, emp_group, emp_grpnum, emp_hour, emp_id, emp_nam, emp_no, emp_per, emp_per_rate, end_date, end_date1, end_date2, end_date3, end_date4, end_date5, end_date6, end_date6\r\n, endin_date, enumerable, errorMsg, ex, expend_all, expend_if, ext_params, exte_type, f_discount, f_p_price, f_p_quan, fact_cost, fact_hour, fail, fc_rate, fieldname, fields, filesName, filter, fin_s_quan, finish_if, fix_ename, fix_name, fix_no, fixa_id, float, flow, fnote_id, fnote_no, frmFtpPassword, fromIndex, from_AID, from_ID, from_No, from_if, from_part_if, from_type, from_type_ID, ftpFiles, ftp_password, ftp_username, gd_Name, gd_id, gd_ids, gd_no, gdname, goods_ID, gstand, height, height_allow, ht2["Mat_No"], ht["Mat_No"], ht["PartB_ID"], htx["Mcm_ID"], htx["OverTimeV"], htx["Wst_ID"], htx["beg_date"], htx["billb_ID"], htx["emp_id"], htx["end_date"], htx["overtime_if"], htx["sch_id"], id, identity, idle, ids, ifDNC, indexs, int, into_item_if, inv_Name, item, item_ID, item_ID\r\n, item_ids, item_name, item_no, keyword, len, length, line, line_id, line_ids, line_no, line_no\r\n, list_billa, loan_date, lockIf, lock_if, long_allow, loss_rat, lpn, mIDs, machSface, mach_hour, maintain, maintain_bill_id, maintain_reason_id, maintain_reason_name, maintain_reason_no, make_tag, man_cost, man_hour, man_price, master, masterID, mat_lot, mat_no, mat_ver, matno, max_space, mcmFtpPassword, mcmId, mcmMain, mcm_ID, mcm_ID_w, mcm_Name, mcm_No, mcm_No_w, mcm_cost, mcm_id, mcm_img, mcm_name, mcm_name\r\n, mcm_no, mcm_no\r\n, mcm_price, mcm_tons, mcm_tons\r\n, mcms, midd_quan, midd_space, mign_hour, min_space, mk_id, mk_ids, mk_lot, mk_name, mk_no, mk_type, mk_type_ID, mold_id, mold_no, month_oee, multiple\r\n--, name, nbilla_ID, new, new, newID, nextrec_date, nid, nid\r\n, no_mcm, nomcm_if, notSort_If, note, null, null\r\n, oa_item_if, obilla_ID, object>, oee, off_Total, off_date, off_logo, ok_rate, oldID, on_date, op_date, op_type, ord, org_id, org_no, org_root_id, out, outParams, outa_ID, outa_No, output_if, over_date, over_if, overtime_if, overtimeif_ID, p_bf_quan, p_fg_quan, p_fg_rec_quan, p_mk_quan, p_pick_quan, p_price, p_quan, p_quan\r\n, p_rec_quan, p_scp_quan, p_tc_quan, p_unit, p_unq_quan, p_yc_rec_quan, page_no, parameters, paras, part_level, parta_ID, parta_id, partb_ID, partb_id, partitem, per_amt, per_plan, per_rate, pernum, piece_name, piece_no, piece_rate, piece_stand, plan_cost, plan_hour, plan_no, plan_total, plana_ID, plana_id, plana_ids, planb_date, planb_date\r\n, plane_date, plane_date\r\n, plat_no, po_tec, position, position\r\n, pre_e_dat, pre_hour, precision:, prg["mold"], price, priceB_ID, priceb_ids, pro_beg_date, pro_end_date, pro_name, pro_note, pro_tool, profit, put_opt, put_opt_ID, py_if, qc_deduct, qual_hour, qual_price, quan, quot_Name, r_date, rated_hour, rec_date, rec_if, rec_total, ref, rou_space, row["PartB_ID"], row_cnt_if, rownum\r\n, running, s_ac_quan, s_fg_rec_quan, s_mk_quan, s_n_quan, s_out_quan, s_pal_quan, s_pass_quan, s_pick_quan, s_price, s_quan, s_rec_quan, s_scp_quan, s_tc_quan, s_unq_quan, s_yc_rec_quan, save_if, sc_b_date, sc_e_date, sc_emp_no, sc_if, sc_mcm_no, scale:, scene, sceneId, scene_ids, schExce_if, sch_EmpOrMcm, sch_ID, sch_quan, sch_quan\r\n, sch_way_if, scp_price, scrap_User_Name, scrap_hour, sel_if, service_date, session_id, sfname, shapeIF_ID, shape_if, show_if, simulate_if, smartmf_type, smater, smater_name, so_date, so_no, so_type, soa_ID, soa_id, sobIds, sob_ID, sob_id, sortNo, sort_date, sort_date:, sort_id, sp_no, spa_id, spa_ids, spb_end_date, spec, sr_date, sta, stand_hour, start_date1, start_date2, start_date3, start_date4, start_date5, start_date6, state, state\r\n, state_Name, state_id, stop, stop_date, stop_if, stop_user_id, stop_user_no, str2, strSql, strTempSql, string, string>, string>>, style_ID, style_name, style_no, sweight, syn_height, syn_length, syn_width, tUnit, tUnit_ID, targetValue, taxrate, taxtype, temp_id, theory_space, time_unit, tmold_ID, tmold_date, tmold_start_if, top, un_total, unit_ID, unit_rate, use_date, user_id, user_mark, user_no, usermark, visual_if, wait_hour, way_if, week_oee, weight, where, width, width_allow, winItem, wk_type, wk_type_ID, wktB_ID, wordb_name, wordb_no, workIF_ID, workIf_ID, work_if, work_no, work_size, work_total, worka_ID, worka_id, workb_ID, workb_id, worker, wst, wst_ID, wst_Name, wst_alia, wst_ename, wst_ename\r\n, wst_id, wst_jname, wst_name, wst_name\r\n, wst_no, wst_num, {, {0}, {1}, {2}, {3}, {kvp.Value}, 不允许删除!";, 排产完工, 请检查!";
```

---

## SKY.NetFrameWork.BLL.Web.MOS

- BLL文件数: 16
- 业务方法数: 94
- 引用的表数: 88
- 字段总数: 355

涉及表:
```
$BOM_BOMA
$BOM_BOMB
$BOM_MkCMachine
$BOM_MkCent
$BOM_WStation
$BOM_WorkB
$BOM_WorkC
$BOM_Worka
$HR_Emp
$MMS_CraftsA
$MMS_CraftsA_Back
$MMS_CraftsA_back
$MMS_PartB
$MMS_PartB_back
$MMS_Style
$MOS_AdjB_Affect_temp
$MOS_CropA
$MOS_CropB
$MOS_CropB_back
$MOS_OutA
$MOS_OutB
$MOS_PPlanA
$MOS_PPlanB
$MOS_PPlanB_back
$MOS_PlanA
$MOS_PlanA_Crafts
$MOS_PlanA_Splan
$MOS_PlanA_back
$MOS_PlanB
$MOS_PlanB_back
$MOS_PlanOutAnalysisRpt_temp
$MOS_PlanOverdueUnpaidRpt_temp
$MOS_RecA
$MOS_RecB
$MOS_RecB_Back
$MOS_RecB_FlipMat
$MOS_RecDetail_temp
$MOS_ReqA
$MOS_ReqB
$MOS_ReqB_back
$OA_WordB
$POS_Pricing
$POS_Pricing_SMaster_view
$QC_FinishB
$QC_FinishB_back
$QC_TrecB
$QC_TrecB_back
$SDS_OutA
$SDS_soA
$SDS_soB
$SDS_soB_back
$SKY_Orangise
$SKY_Users
$SYS_BillCategory
$SYS_CManagA
$SYS_Curya
$SYS_CusA
$SYS_CusCode
$SYS_Feature
$SYS_GoodInA
$SYS_GoodInC
$SYS_GoodInE
$SYS_GoodInG
$SYS_InvCatl
$SYS_Item
$SYS_Option
$SYS_ParCatB
$SYS_ParCatC
$SYS_SMater
$SYS_Settle
$SYS_SpTypeA
$SYS_Trans_End
$SYS_WhouseA
$SYS_WhouseB
$mos_adja
$mos_adjb
$mos_ltno_allot_temp
$mos_out_detail_temp
$sds_sob
$sys_cusa
$v_SYS_GoodInA
$v_SYS_GoodInA_all
$v_SYS_Trans_End_GD
$v_SYS_Trans_End_NoltNo
$v_SYS_Trans_End_nosp
$v_SYS_Trans_End_now_st
$v_SYS_Trans_End_sp
$whs_monthA
```

业务方法:
```
BatchMateDetail_MainProc
BillCancelLock
BillCancelPostAcct
BillDealSplitProc
BillLock
BillPost
BillPostAcct
BillReSettle
BillSettle
CallBackAbnorImproveB
CancelBillPost
ChangeRecord
CheckAvailableQuan
CheckAvalStockQuan
CheckBeforeDelete
CheckBeforeDeleteB
CheckBeforePostAndUnPost
CheckBeforeUnCheckPost
CheckBeoforeDelete
CheckBillDataValid
CheckBillData_FlipMat
CheckBillMonth
CheckBillState
CheckBillStateForUnPost
CheckBillWhose
CheckBombCount
CheckCraftsA_Back_oDo_quan
CheckCropAQuan
CheckDataBeforePost
CheckFlipMatWhouseAB
CheckGoodsStockValue
CheckMMS_CraftsAIf
CheckMateData
CheckMms_craftsa
CheckOverQuan
CheckOverStockForPost
CheckOverStockForUnPost
CheckOweStockQuan
CheckPartB_Back_oDo_quan
CheckSQuanValue
CheckWorking
ChkAdj
ChkQuan
ChkWwUsedIf
ClearTempData
ConvertMoldCost
CreateBomDetail
DealAffectBill
DealRecBFlipMat
DelToGds
DeleteByID
DeleteTempTableData
ExeChange
ExpandDetail
GetAll_InsBillSele
GetBOM_WorkBData
GetBillNewData
GetBomWorkBC
GetChangeAffectBillData
GetCostLastDay
GetDataByID
GetGoodDataByCode
GetGoodInADataByGd_No
GetGoodsByMatID
GetListData
GetLotNoData
GetLot_noByMat_no
GetLot_noByPlan_no
GetLt_no
GetMTableState
GetMaxSplitQuan
GetMos_Out
GetNewStateData
GetPlanbData
GetSPContent
GetSPriceBySMaster
IntoTableFromData
IsHaveDubleWhoseB
IsNullToMatID
IsUsersMOSPlanAB
NotifySupplier
ReSettle
RefMosPlanaState
RunScheduleProc
SaveOldData
SetSPContent
Settle
SyncFlow
ToFixtureAProc
ToGoodInAProc
ToMMS_CraftsAB
UpdatePlanBStateByPlanA
UpdateTableFromData
WritePlanAState
```

字段清单:
```
"", "0", "2", "4", "\n", "emplan_recover_if", "m8", "mc", "mms_save_check", "move_no", "movea_id", "other_update", "out_rec_quan_if", "state", --用料出库量\r\n, 0m, 10, 120, 17442, 17443, 17444, 17445, 19322, 1\r\n, 1m, 20, 29, ABCPro, A_ID, Bom_No, BsUnit, BsUnit_ID, CMCode, CMName, CManagA_ID, CManagA_No, CMngA_No, CName, Ca_User_ID, Ca_User_No, Ca_date, Ca_date\r\n, CnRate, Crafts_Explain, CuCode, CuCode_ID, CuCode_No, Cury_Name, Cury_No, Cus_Name, Cus_No, Diameter, Direction, EDraNo, EOQuan, EnName, FMater, FtCode, Ft_ID, Ft_No, GAbbre, GColor, GStand, GStand\r\n, GWidth, GdCode, GdInB_ID, GdName, GdType, Gd_ID, Gd_No, GdinB_ID, GdinC_No, GooNum, GooNum\r\n, HMater, HashTableEx>, Height, Htreat, ID, InCod1, InCod2, InCode, InCode1, InCode2, InName, InName1, InName2, LPN, LT_NO, LT_NO\r\n, Length, Mat_No, Mcm_ID, Mcm_No, MinSal, Mk_ID, Mk_No, Mk_name, NetWeight, OIName, OragID, Org_ID, Out_User_No, PaCode, Parameters, PartB_ID, Plan_No, Plana_id, Planb_ID, Pre_Wst_Num, Pre_billb_ID, ROHS, Rec_User_ID, Remark, Req_No, Reqb_ID, SELECT, SER, SMater, SMater_ID, SMater_Name, SMater_name, SModel, SO_ID, SP_ID, SP_No, S_SWeight, Size, SpName, SpTypeA_ID, SpTypeA_NO, SpTypeA_Name, SpTypeA_No, Sp_ID, Sp_No, SpacNo, Splan_ID, Splan_No, SqlDbType, Value, WG_Weight, WHCode, WHName, WH_No, WHuAID, WIPWho, Weight, Wh_ID, Wh_No, Whouse, Wst_ID, Wst_Name, Wst_No, Wst_Up, \r\n, \r\n\t, \r\n\t\t, _interface_if, aID, a_ID, bID, base_quan, beg_date, billIf_ID, bill_ID, bill_if, bill_no, billa_ID, billa_id, bomIf_ID, bom_No, bom_id, bom_if, bom_no, bom_s_quan, bomif_ID, bond_if, bool, ca_date, ca_user_id, ca_user_no, cancellock_date\r\n, case, cb_if, cl_date, cl_note, cl_user_no, cname, craftsa_ID, cury_name, cus_id, cus_name, cus_no, cus_ord, decimal>, dept_id, dept_no, describe, emp_nam, end_date, extend_id1, fc_tot, fc_vat, fix_name, fix_no, flow, flow_id, from_AID, from_ID, from_No, from_type, from_type_ID, fromb_id, ft_id, ft_no, gd_id, gd_no, gdinc_id, gdinc_no, gstand, htx, i_GdInB_ID, i_p_unit, i_unit_rate, id, item_name, item_no, key2, key3, key4, lc_amt, lc_tot, lc_vat, line_id, line_no, lock_date, lock_note, lock_user_no, lt_no, lt_note, master, mat_ID, mat_No, mat_id, mat_no, mcm_name, message, mk_id, mk_name, mk_name\r\n, mk_no, mold_num, move_mat_id, move_mat_no, move_plan_no, new, new, not_state, note, note\r\n, null, opt_mark, org_id, other_update, out, outParams, out_date, out_no, outa_ID, p_m_quan, p_move_n_quan, p_n_quan, p_price, p_quan, p_sd_quan, p_so_quan, p_t_quan, p_unit, p_weight, p_y_quan, piece_name, plan_no, plana_ID, plana_id, planb_id, plugin, pre_e_dat, pre_s_dat, precision, rec_date, rec_quan_ctrl, recaID, reply_date, reply_text, reply_text\r\n, rohs, s_ac_quan, s_aval_quan, s_bu_quan, s_m_quan, s_o_do_quan, s_od_quan, s_out_quan*a.i_unit_rate, s_plan_quan, s_price, s_quan, s_req_quan, s_s_quan, s_sd_quan, s_sd_quan\r\n\t, s_so_quan, s_t_quan, s_ts_quan, s_y_quan, settle_caption, smater, smater_name, so_no, sob_ID, sp_id, sp_no, state, state_id, str, str2, strPlanNo, string, strval, style_name, style_no, tmphtx, top, treca_ID, unit_rate, wh_id, wh_no, wordb_id, wordb_name, wordb_no, work_no, wst_ID, wst_No, wst_id, wst_name, wst_no, y_GdInB_ID, y_mat_No, y_mbomIf_ID, y_mbom_ID, y_mbom_No, y_mbom_if, y_p_unit, {0}, {1}
```

---

## SKY.NetFrameWork.BLL.Web.MOT

- BLL文件数: 27
- 业务方法数: 33
- 引用的表数: 47
- 字段总数: 82

涉及表:
```
$BOM_MkCMachine
$BOM_MkCent
$BOM_WStation
$COST_Plan_Det
$HR_Emp
$MMS_PartA
$MMS_PartB
$MMS_Style
$MOT_CatSet
$MOT_CostAnalysisMatrixFigure_A_temp
$MOT_CostProductDiffReport_temp
$MOT_Cost_AMate_VocRpt_temp
$MOT_Cost_Mate_VocRpt_temp
$MOT_Cost_Product_VocRpt_temp
$MOT_ManSeta
$MOT_ManSetb
$MOT_ManSetb_Amt
$MOT_ManSetb_Dept
$MOT_MouldCostReport_temp
$MOT_ShareAWeightSet
$MOT_Sob_det
$MOT_StandardCost
$OA_ITEM_Classb
$OA_ITEM_itema
$OA_WordB
$SDS_soA
$SDS_soB
$SKY_Functions
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_BillCategory
$SYS_Curya
$SYS_CusA
$SYS_Feature
$SYS_GoodInA
$SYS_InvCatl
$SYS_Item
$SYS_MsUnit
$SYS_Option
$SYS_ParCatC
$SYS_Trans_Def
$SYS_WhouseA
$SYS_WhouseB
$SYS_item
$v_MOT_Partb_det
$v_SYS_GoodInA_all
```

业务方法:
```
CheckBeforeDel
CheckBeforeEdit
CheckExistsCode
CheckExistsNo
CheckMatend_cost
ClearTempData
DeleteByID
DoSearch
ExecMOT_Mold_SpMain
ExecMOT_OInv_SpMain
ExecMOT_ProductCostCalc_Main
GetBListData
GetChildMolds
GetDataByID
GetIdByGdId
GetLastMon
GetListData
GetListDataDetail
GetMOS_Planb_date
GetMotCat
GetMotCatSet
GetMouldCost
GetNewDataToMTable
GetNotStopCnt
GetPageDataList
GetTable_rate
RemoveMOTByMon
SetStop
UpdateCost_mat_det
UpdateDeptNos
UpdateManSetaByFeeAmt
UpdateManSetbApp_type
UpdateSob_DetFromPartB_Det
```

字段清单:
```
0m, 120, 16099\r\n, A_ID, BsUnit, BsUnit_ID, CName, Cus_Name, GAbbre, GStand, GdName, Gd_No, Gd_No";, GoodInA_No, ID, InCod2, InCode, InName, Inv_Name, Item_nam, Item_no";, Mat_No, MsUnit, Rows.Count, SoType_ID, SpName, Style_Name, WHName, Where, Wordb_Name, \r\n, adj_fee, adj_man, adj_mat, app_type, billa_ID, bool, cat_name, cat_no, cury_name, cus_ID, cus_date, cus_no, decimal, emp_nam, end_adj_fee, end_adj_man, end_adj_sum, gd_no, id, item_id, item_name, item_name\r\n, item_no, line_no, line_no";, line_no\r\n, mach_fee, mat_fee, mcm_name, mk_id, mk_name, mk_no, mold_no, new, new, org_no, plan_no, r_date, s_quan, so_Type, so_no, string, string>, top, wordb_name, wordb_no, wordb_no\r\n, wst_name\r\n, {0}, {1}, {fieldname}
```

---

## SKY.NetFrameWork.BLL.Web.OA

- BLL文件数: 18
- 业务方法数: 63
- 引用的表数: 56
- 字段总数: 351

涉及表:
```
$BOM_MkCMachine
$BOM_MkCent
$BOM_WStation
$BUD_Acct
$GLS_VocB
$HR_Emp
$OA_CRM_CusA
$OA_CashBorrow
$OA_CashBorrow_back
$OA_EstRequest
$OA_EstRequest_back
$OA_FeeOut
$OA_FeeOutB
$OA_FeeOut_Borr
$OA_FeeOut_Req
$OA_FormalRequest
$OA_LeaRequest
$OA_Maintain
$OA_OutRequest
$OA_OverRequest
$OA_ScheduleA
$OA_ScheduleB
$OA_TckRequestA
$OA_Tend
$OA_WordA
$OA_WordB
$OA_WordC
$SKY_Functions
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_Ann
$SYS_Bank
$SYS_BillCategory
$SYS_CManagA
$SYS_Channel
$SYS_Curya
$SYS_CusA
$SYS_DealCost
$SYS_GoodInA
$SYS_InvCatlB
$SYS_Item
$SYS_ParCatC
$SYS_Region
$SYS_SMater
$SYS_Sales
$SYS_Settle
$SYS_TradeInfo
$SYS_Transport
$SYS_UpLoadDat
$WF_SignA
$WF_SignB
$WF_WorkFlwa
$WF_WorkFlwa_User
$WF_WorkFlwb
$v_SYS_GoodInA_all
```

业务方法:
```
APS_AccountAToData
AutoCheckBill
Balanceinquiry
CancelApprovedSign
CheckDel
CheckDeliveQuan
CheckExistsBillSign
ChkDelRight
ChkDelWordB
CostLoanIntoVoc
DelBillFromSign
DelData
DeleteByID
DeliveToData
GetAllData
GetAskpriceB_InsPrice
GetBillDataForSign
GetBillFieldsVal
GetBillSubmitState
GetCheckedUsers
GetCury
GetCury_
GetDataA
GetDataB
GetDataByID
GetDataC
GetDealCostAcct
GetDebitSheetData
GetEmpWorkJob
GetFeeOutBorr
GetFeeOutReq
GetHtmlFromUrl
GetIdByVocId
GetListData
GetListData_borr
GetModule
GetModuleDataPreview
GetScheduleBList
GetSiblingCheckMan
GetSignaByID
GetSingleData
GetSingleDataByDate
GetSingleDataByID
GetTckRequestB
GetWordaInfo
GetWordaOrgIf
HasDuplicate
IntoGLABook
IntoVocCheck
IsApprovedByExternal
IsBillSigning
OnesTurnToSign
ReplyAsk
ReplyPob
SaveBillSummary
SearchDataProc
SendSMS
StopAskprice
StrBalance
UpdateFirstCaUserState
UpdatePOS_AskpriceB
chkDelRight
editOA_Word
```

字段清单:
```
"", "0", "1", "3", "[#＃]\\s*作\\s*业\\s*[#＃]", "[#＃]\\s*单\\s*号\\s*[#＃]", "[#＃]\\s*备\\s*注\\s*[#＃]", "\\{|\\}", "a", "b.state, "note", "wf", "wordb_no", "签核模板中签核说明设置错误：", #jzData, *\r\n, --qc.onebox_quan, --报销金额\r\n, --金额\r\n, -1, 0", 17702, 17703, 17704, Acct_ID, Acct_Name, Acct_No, Ann_Name, BillDataForSign, BillID, BillNo, BillSummary, Bill_no, Borr_ID, Borr_No, CMName, CManagA_No, CMngA_ID, CMngA_No, CName, C_Price, C_Value, Code, ConBat, Cost_Name, Crafts_Explain, Cury_ID, Cury_Name, Cus_Name, Cus_No, Cus_name, DataSet, DataTable>, Diameter, Direction, EDraNo, EnName, Fee_ID, FldBillNo, FldOpDate, FldOrgID, FldOrgNo, FldUserID, FldUserNo, FstCrUserPhone, FstNotifyMsg, Ft_No, FunName, Fun_ID, GAbbre, GStand, GWidth, GdCode, GdInA_No, GdInB_ID, GdName, Gd_ID, Gd_No, Gd_Spec, Get_date, HandIf_ID, Hand_If, Height, Htreat, ID, IFName, IsOA, Length, Mcm_Name, Mer_User_ID, ModeCustomIf, ModeID, ModeNo, Mode_ID, Mode_No, Op_date, P_SP_quan, Qabooks, ROHS, RelaFd, Req_ID, Req_No, Reqa_ID, ResultIf_ID, Result_If, SArea, SFName, SMS_if, SMater, SMater_name, SP_ID, SP_No, Serial, Settle_Caption, Settle_No, Signa_ID, Size, SpName, Sp_Name, Sp_No, SqlDbType, SqlValue, State_ID, Table_Name, Tables[1], Transport_Name, Upload_doc, UserName, User_ID, User_No, Value, WFUnCheckedStateNo, WHName, WH_ID, WH_No, Wh_Name, Wh_No, Wordb_ID, Wordb_ID10, Wordb_ID2, Wordb_ID3, Wordb_ID4, Wordb_ID5, Wordb_ID7, Wordb_ID8, Wordb_ID9, Wst_no, X1, X2, X3, X4, X5, X6, X7, \r\n, \r\n\t, \r\n\t\t\t\t\tA_ID, \t, \t\t\t\t\t, \t\t\t\t\t\t\t--报销金额\r\n, _bar_prt_date, _submit, acct_id, acct_name, acct_no, agio_rate, ask_no, ass_cus_id, ass_dept_id, ass_emp_id, ass_pro_id, assist_CD, barcode, billCC, billDataForSign, billID, billId, billNote, bill_ID, bill_no, bill_summary, billcheck, bool, box_quan, bx_ID, case, cash_acct_id, cateID, chk_date, cname, commandType, crUserID, cr_date, cr_user, cr_user_ID, crafts_explain, cury_no, cus_Name, cus_id, cus_name, cus_no, cus_ord, defaultValue:, depo_acct_id, deptID, direction, do_date, emp_nam, end_date, est_mon, fc_amt, fc_cash_tot\r\n, fc_rate, fc_tot, fc_vat, filterState2[navFilter], filterState[navFilter], from_no, ft_id, ft_no, funId, functionID, gd_id, gress_color, id, invo_date, invo_ma, invo_no, invo_type, invo_type_ID, invo_user_ID, invo_user_No, isFtSys, join_line, join_sign, jz_IDs, lc_amt, lc_cash_tot, line_no, line_no";, lt_no, mat_lot, mcm_id, mcm_no, memo, mk_lot, mk_name, mk_no, mode_no, mold_id, mold_no, msgContent, multi_dept, multi_firm, multi_proj, new, new, note, note\r\n, null, onebox_quan, opUserId, opUserNo, op_date, op_user_id, opinion, oppo_acct_id, opuser_id, out, p_a_price, p_b_price, p_c_fee, p_l_price, p_price, p_quan, p_unit, p_weight, param, parameters, pay_date, phone, piece_no, plan_no, po_no, po_type_Name, pr_no, price_rank\r\n, r_date, rec_no, rec_type_Name, ref, reject, reply_date, reply_text, rider, row_code, row_code\r\n, row_id, s_price, s_quan, settle_id, settle_no, sex, ship_no, signaID, signa_id, signb_id, single_cd, size, sms_if, sqlA, state, strSqlB, str[0], str[1], str[2], str[3], str[4], string, string>, string>, string>>, supple_note, tableName, tablename, tax_acct_id, tax_no, tax_rate, tax_type, tax_type_id, top, topic_msg, topic_msg\r\n, trec_no, unchkcode, unit_rate, useDefaultValueWhenEmpty:, userID, user_names, voc_type_id, wf_end_date, wf_hour, wordb_id, wordb_name, workFlow, wst_id, wst_name, wst_no, {, {0}, {1}
```

---

## SKY.NetFrameWork.BLL.Web.OA.Third

- BLL文件数: 1
- 业务方法数: 1
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
ClearCache
```

---

## SKY.NetFrameWork.BLL.Web.OA_ANN

- BLL文件数: 2
- 业务方法数: 12
- 引用的表数: 4
- 字段总数: 2

涉及表:
```
$OA_WordB
$SKY_Orangise
$SKY_Users
$SYS_ParCatC
```

业务方法:
```
DelData
DeleteByID
GetANNCategary
GetAllData
GetCountOfUnRead
GetDataByID
GetListByCategary
GetListData
GetNowDate
GetSingleData
UpdateUserReadTimestamp
chkDelRight
```

字段清单:
```
CName, \r\n
```

---

## SKY.NetFrameWork.BLL.Web.OA_CRM

- BLL文件数: 19
- 业务方法数: 45
- 引用的表数: 54
- 字段总数: 210

涉及表:
```
$HR_Emp
$OA_CRM_CallCycle
$OA_CRM_CusA
$OA_CRM_CusA_Filing
$OA_CRM_CusB
$OA_CRM_CusC
$OA_CRM_CusD
$OA_CRM_CusE
$OA_CRM_CusF
$OA_CRM_CusG
$OA_CRM_CusH
$OA_CRM_CusI
$OA_CRM_Description
$OA_CRM_DetectionA
$OA_CRM_DetectionA_Emp
$OA_CRM_DetectionB
$OA_CRM_DetectionC
$OA_CRM_Fault
$OA_CRM_ForumA
$OA_CRM_ForumB
$OA_CRM_GuestBook
$OA_CRM_ReturnA
$OA_CRM_ReturnB
$OA_CRM_ReturnC
$OA_CRM_RivalA
$OA_CRM_RivalB
$OA_CRM_ServiceA
$OA_CRM_ServiceA_Emp
$OA_CRM_ServiceB
$OA_CRM_ServiceC
$OA_CRM_ServiceD
$OA_CRM_ServiceDetail_temp
$OA_CRM_ServiceTotal_temp
$OA_CRM_ShareCusA
$OA_CRM_ShareCusD
$OA_CRM_Term
$OA_SalesTotal_temp
$OA_WordB
$SDS_OutA
$SDS_OutB
$SKY_Orangise
$SKY_Users
$SYS_Channel
$SYS_Curya
$SYS_CusA
$SYS_GoodInA
$SYS_ParCatC
$SYS_PriceType
$SYS_Region
$SYS_Sales
$SYS_Settle
$SYS_TradeInfo
$SYS_Transport
$SYS_UpLoadDat
```

业务方法:
```
AutoCheckNo
BatchConvert
BeforeSave_CRME
ChangeCus_Type
CheckBodyNo
CheckCusNo
CheckCusNum
ChkDelRight
CusConvert
CusConvertCJ
CusStop
DegreeIFCount
DelData
Delete
DeleteByID
Exists
GetAPIFilterSql
GetAllData
GetBList
GetChange_dept
GetChildDataByID
GetCusCheckNo
GetCusCount
GetCusIDByCheckNo
GetDataByID
GetListData
GetNorMal_if
GetOA_CRM_ForumB
GetPageDataByID
GetSales
GetShareCusCount
GetSingleData
GetSingleDataByID
GetWithinLimData
IsUsed
LoadAttach
RefreshLastDate
getFilterSql
getOA_CRM_Term
getPoaStaus
strSql_A
updBody_noByid
updateBody_noByid
updateMer_date
updateServiceAByID
```

字段清单:
```
"", "0", "1", "2", "294b0f1d-5796-41fc-851d-e8e1a9a07d18", "3", "4", "Dept_ID", "Mer_User_ID", "Sales_Mer_User_ID", "User_ID", "a", "b", "bill_no_auto_if", *\r\n, 10000, 112, 1\r\nunion\r\nselect, 20, 268238847", 268238847\r\nunion, 268238847\r\nunion\r\nselect, CName, CallCycle, Channel_ID, Channel_No, CheckNo, Check_No, Code, Cont_Birthday, Cont_ENam, Cont_Edu, Cont_Fax, Cont_Gender, Cont_Mail, Cont_Marriage, Cont_Mobile, Cont_Name, Cont_Note, Cont_Post, Cont_QQ, Cont_Tal, Content, ContwayIf_id, Contway_If, Cury_Name, Cury_No, CusState, CusType, Cus_Addr, Cus_Capital, Cus_Contact, Cus_Http, Cus_ID, Cus_Mobile, Cus_Name, Cus_Name\r\n, Cus_Name_e, Cus_No, Cus_Short, Cus_Size, Cus_Type, DISTINCT, DeptCD, DeptID, Dept_ID, Dept_No, EName, FName, GStand, GdInA_ID, GdInA_No, GdInB_ID, GdName, ID, IFName, JName, Lock, LoginName, Marriage_If, Mer_User_ID, NormalIF_ID, OnLine, OrangiseID, Org_ID, Org_No, PassWord, Region_No, RelaFd, RelaFd\r\n, RemindPer_ID, SFName, Sales_ID, Sales_Mer_User_ID, Sales_No, Settle_Caption, Settle_No, Sex, SoB_ID, Stand, Status, String, Tax_Rate, Tax_Type, Trade_ID, Trade_No, Transport_Name, Transport_No, UseIPWhitelist, User_ID, \r\n, \r\n\t, \r\n\t\t\t, \r\n\t\t\t\t\t\t\t\t\t\t, \r\nb.User_ID, allow_if, beg_date, bill_ID, body_no, cName, ca_date, ca_user_id, ca_user_no, canLoginFromPCWithWAN, case, cname, cnt, commandType, comment, cont_tal, crm_ID, cusNewID, cus_ID, cus_addr, cus_id, cus_id\r\n, cus_name, cus_short, cusa_id, cuse_id, custype, custypeID, des_no, direction:, emp_nam, end_date, errors, fault_no, feeIF_ID, fieldTitle, fieldname, follow_ID, func_id, gender_If, id, isLimit, isSupplier, item_name, lastId, last_date, line_no, mobiles, msgContent, new, new, next_date, note, null, op_date, org_ID, org_id, out_no, outa_ID, outa_No, p_quan, p_quan\r\n\t\t\t\t\t\t\t\t\t\t, p_unit, passWord, perms, position, precision:, region_no, remind, scale:, sex, short_no, size:, so_no, soa_ID, soa_No, state, state_ID, string, term_type, title_name, top, type, up_id, user_ID, user_id, user_names\r\n, wordb_id, wordb_name, {0}, {0}\r\n, {13}\r\n, {1}, {6}";, };, 地址:“{4}”{5}冲突
```

---

## SKY.NetFrameWork.BLL.Web.OA_ITEM

- BLL文件数: 45
- 业务方法数: 95
- 引用的表数: 96
- 字段总数: 356

涉及表:
```
$BOM_MkCMachine
$BOM_MkCent
$BOM_WStation
$HR_Emp
$MMS_CraftsA
$MMS_CraftsB
$MMS_PartA
$MMS_PartB
$MMS_WorkA
$MMS_WorkB
$MOT_CatSet
$OA_ITEM_AdjA
$OA_ITEM_AdjA_TrackRpt_Temp
$OA_ITEM_AdjB
$OA_ITEM_AdjB_link
$OA_ITEM_AllChild_AdjA
$OA_ITEM_AllChild_AdjB
$OA_ITEM_AllChild_AdjB_link
$OA_ITEM_Classa
$OA_ITEM_Classb
$OA_ITEM_ConfigA
$OA_ITEM_ConfigB
$OA_ITEM_ConfigB_Back
$OA_ITEM_Defend
$OA_ITEM_Defend_back
$OA_ITEM_ElementsA
$OA_ITEM_ElementsB
$OA_ITEM_ElementsC
$OA_ITEM_ProjA
$OA_ITEM_ProjB
$OA_ITEM_ProjBFile
$OA_ITEM_Report_Re_temp
$OA_ITEM_Report_temp
$OA_ITEM_SpeedB
$OA_ITEM_SpeedB_dy_gds
$OA_ITEM_SpeedB_dy_items
$OA_ITEM_Speed_El_temp
$OA_ITEM_Speed_Re_temp
$OA_ITEM_Speeda
$OA_ITEM_Speeda_back
$OA_ITEM_Speedb
$OA_ITEM_Speedb_L_Wordb
$OA_ITEM_Speedb_Piece
$OA_ITEM_Speedb_Wst
$OA_ITEM_Speedb_back
$OA_ITEM_Speedb_bk
$OA_ITEM_Speedb_pob
$OA_ITEM_Speedb_sch_temp
$OA_ITEM_Speedb_temp
$OA_ITEM_Speedc
$OA_ITEM_WorkA
$OA_ITEM_WorkB_dy_gds
$OA_ITEM_WorkB_dy_items
$OA_ITEM_WorkB_piece
$OA_ITEM_Worka
$OA_ITEM_Workb
$OA_ITEM_Workb_Wst
$OA_ITEM_Workb_dy_gds
$OA_ITEM_Workb_line
$OA_ITEM_itemA
$OA_ITEM_itema
$OA_ITEM_itema_piece
$OA_ITEM_itema_wst
$OA_ITEM_itemb
$OA_Item_speed_report_temp
$OA_Project_Collect
$OA_Project_Collect_union_Seek_temp
$OA_WordB
$OA_WordC
$PLM_Bill_Attatchments
$POS_RecA
$POS_RecB
$QC_ChkB
$QC_ChkB_back
$QC_TrecA
$QC_TrecB
$QC_TrecB_back
$SDS_soB
$SDS_soB_back
$SKY_Orangise
$SKY_Users
$SKY_users
$SYS_BillCategory
$SYS_CManagA
$SYS_CusA
$SYS_GoodInA
$SYS_GoodInB
$SYS_InvCatl
$SYS_Item
$SYS_ParCatC
$SYS_UpLoadDat
$oa_item_proj_temp
$oa_item_speed_temp
$oa_item_speed_wordb_temp
$v_SYS_GoodInA
$v_SYS_GoodInA_all
```

业务方法:
```
AddFromProgress
AutoCorr
AutoSpeed
CancelSch
CheckBeginWorkData
CheckChildUsed
CheckClassb
CheckDelSpb
CheckLockIf
CheckSob
CheckSobID
CheckUsed
ChkAddChild
ChkAdj
ChkDel
ChkDelB
ChkDocEdIf
ChkSchPiece
ChkWorkbExists
CopyOtherData
CopyOtherTable
CorrelationOp
CreateProject
DealSearchData
DelData
DelOrModAllCondition
Delete
DeleteByID
DeleteC
DeleteTempTable
Dispose
DoSearch
ExChange
Exist
Exists
GetAllData
GetChildMaxLine
GetData
GetDataA
GetDataB
GetDataByID
GetDataVisibleFilter
GetDeptMKAbility
GetGdImg
GetGd_Date
GetGoodsListByGoodsConfig
GetItemData
GetItemWordb
GetItemWorkb
GetItembByAID
GetLineIdForLink
GetListData
GetMaxItem
GetOA_ITEM_ConfigB
GetOA_ITEM_ProjB
GetOA_ITEM_ProjItem_no
GetOA_ITEM_Projline_no
GetOA_ITEM_WorkB
GetOA_ITEM_WorkBandbID
GetOnMachineData
GetOpDate
GetPartData
GetPreTask
GetProcessByProj
GetRelationLineID
GetRelationPOS
GetRelationWL
GetSingleData
GetSpaId
GetSpeedBs
GetTaskDate
QueryItem
RefreshLineNo
RefreshSpaState
RunScheduleProc
SavaBack
SaveOldData
SaveOtherData
Schedule_Main
SetSobDate
StopCraftsAB
UpdateByID
UpdateData
UpdateFactHour
UpdateMMSCraftsBOverdate
UpdateOtherByItema
UpdateParentNos
UpdateSpbEstHour
ViewChanges
getItem
getItem_hour
getPoaStaus
getUpdateleader
getlock_If_User
updateTableBWordb
```

字段清单:
```
"", "3", "billID", "billNo", "billstate", "mcm_over_before_hour", "out_msg", "show_back_if", "signa_id", *\r\n, --以下多余栏位用于“界面表头排序”\r\n, 0m, 10, 100, 111, 112, 120, 15243, 15243\r\n, 15244, 15244\r\n, 15252\r\nelse, 15253\r\nelse, 15254\r\nelse, 15255\r\nelse, 15256\r\nelse, 15257\r\n", 1\r\n, 50, 60, ABCPro, ABCPro_ID, BID1, B_ID, Bottom_if, CMName, CMngA_ID, CMngA_No, CName, Ca_User_ID, Ca_User_No, Cat_Name, Category, Category_ID, Class_ID, Classb_ID, Classb_No, Com_IF, Cus_Fax, Cus_ID, Cus_Name, Cus_Name\r\n, Cus_No, Cus_Short, Cus_Tal, DataRow>, DeptCD, Dept_ID, Dept_No, Direction, EDraNo, Emp_ID, Emp_No, GStand, GStand\r\n, GdInA_ID, GdInA_No, GdInB_ID, GdName, GdName", GdUnit, Gd_ID, Gd_No, ID, ID\r\n, IFName, Ia_User_No, Ia_date, InCod1, InCod2, InCode, InCode1, InCode2, InName, Inv_Name, Item, ItemIF_ID, Item_ID, Item_IF, Item_Name, Item_No, Item_nam, Item_nam_E, Item_nam_J, Item_no, L_Wordb_ID, List<HashTableEx>, Mat_ID, Mcm_ID, Mcm_No, Mk_ID, Mk_No, Mold_if, OragID, Org_ID, Org_No, Over_Emp_ID, Over_Emp_No, Over_phone, Parameters, PartB_ID, Play_User, RelaFd, Resources, SELECT, SFName, SMater, Show_if, Size, So_No, Soa_ID, Sob_ID, SqlDbType, State_ID, Unit_time, User_No, Value, VarChar, Warn_Emp_ID, Warn_Emp_No, Warn_phone, Wordb_ID, Wordb_ID\r\n, Wordb_No, WorkIF_ID, Work_IF, Wst_ID, Wst_No, Wst_Nos, \r\n, _isparent, _isparent\r\n, aID, a_id, act_end, adj_date, adjaID, adja_no, adjb_id, b_id, b_ids, beg_date, begin_date, bids, bill_no, bill_type, billa_ID, billb_ID, bomver, bool, buffered:, ca_date, case, cname, col1, color_code, commandType, confirm_user_no, cr_date, craftsa_id, craftsb_id\r\n, cron, cron_hours, cus_name, cus_no, dbType:, degree, dept_id, dept_no, direction:, distinct, doc_ed_if, dy_gds, dy_items, emp_nam, emp_nam\r\n, emp_no, end_date, endin_date, endin_date_fact, est_hour, failmsg, files_name, flow, gd_ID, gd_no, gdid, gditem_name, gditem_no, gr_user_no, grpFieldVals, guest_show_if, handover_dist_days, handover_end_date, id, int, inv_Name, issuedIF_ID, issued_IF, item, item_id, item_if, item_nam, item_name, item_no, jr_user_no, line, line_id, line_no, line_no\r\n, link_days, link_type, link_type_id, lv, markerIF_ID, marker_IF, marker_if, markerif_id, mcm_name, modify_mold_days, mold_beg_date, mold_dist_days, msgContent, name, new, new, new_mold_days, norm_days, norm_times, note, null, o_State_ID, o_state, oa_item_if:, off_logo, op_date, op_date\r\n";, outParams, over_emp_no, over_rate, p_po_quan, p_price, p_quan, p_quan\r\n, p_unit, page_no, para, parameters2, pid, piece_name, piece_no, piece_nos, plan_days, plan_dist_days, plan_end_date, plan_hour, po_no, po_nos, pr_user_no, precision:, pro_user_no, problem_solved, problem_solved\r\n, problem_unsolved, qr_user_no, r_date, rec_date, rec_date\r\n, rec_no, ref, reply_date, reply_text, s_ac_quan, s_po_quan, s_price, s_quan, scale:, sel_id, session_id, show_if, size:, so_date, so_no, soa_Note, soa_id, soa_no, sob_id, sp_id, sp_no, spa_ID, spa_id, spbId, spbIds, spb_ID, spb_IDs, spb_id, sr_date, sr_user_no, st_hours, start_User_ID, start_User_No, start_date, state, state1, stopIf, stop_User_ID, stop_User_No, stop_date, str, strSql, string, style_no";, test_mold_num_no, time_unit, top, trec_no, unit_rate, up_ajb_ids, up_id, up_line_nos, up_spb_ids, wait_hour, warn_emp_no, wordbL_B_ID, wordb_Ename, wordb_Jname, wordb_id, wordb_name, wordb_name\r\n, wordb_no, wordb_type, wordc_id, wordc_id\r\n, wordc_name\r\n, work1, worka_ID, worka_id, wst_name, wst_no, wst_nos, wst_num\r\n, {0}, {0}\r\n, {1}, {1}\r\n, 请检查!";
```

---

## SKY.NetFrameWork.BLL.Web.OA_JOINT

- BLL文件数: 1
- 业务方法数: 6
- 引用的表数: 5
- 字段总数: 16

涉及表:
```
$OA_JointCheckBillA
$OA_TckRequestA
$SKY_Orangise
$SKY_Users
$SYS_ParCatC
```

业务方法:
```
DeleteByID
GetAllData
GetDataByID
GetListData
GetSingleData
GetTckRequestB
```

字段清单:
```
Gd_ID, Gd_Name, Gd_No, Gd_Spec, ID, Reqa_ID, \r\n, lc_amt, line_no, note\r\n, p_price, p_quan, p_unit, s_price, s_quan, unit_rate
```

---

## SKY.NetFrameWork.BLL.Web.PLM

- BLL文件数: 18
- 业务方法数: 108
- 引用的表数: 25
- 字段总数: 140

涉及表:
```
$BOM_BOMA_Log
$BOM_SBOMA
$BOM_SBOMB
$BOM_SBOMB_Flow
$MMS_Style
$MOT_CatSet
$PLM_Directorys
$PLM_Files
$PLM_SignA
$PLM_SignB
$PLM_SignB_Users
$PLM_WorkFlowA
$PLM_WorkFlowAuthor
$PLM_WorkFlowB
$PLM_WorkFlowB_Users
$PLM_WorkFlowFileDir
$PLM_WorkFlowRoles
$PLM_permission
$SKY_Orangise
$SKY_Roles
$SKY_Users
$SKY_UsersRoles
$SYS_BillCategory
$SYS_ParCatC
$bom_sbomb_chk_temp
```

业务方法:
```
CancelSign
ChkBOMCycle
ClearMatVerAfterUpdate
CopyDirectory
CopyOtherData
CreateBillDesignData
DeleteByID
DeleteDirectory
DoSign
Exists
ExistsDirectory
FileCanOperate
FileOperVerify
GetAgentFlow
GetAgentOtherUser
GetAllAgent
GetDataByID
GetFileHistory
GetFileLog
GetFileLogDetail
GetGridAttatchment
GetGridListData
GetListData
GetMatDirId
GetPlmPerm
GetPlmPermByOwner
GetPlmPermFull
GetStageID
GetWorkFlowAs
Host
IsBillExists
IsDirNameDuplicate
IsFileSigning
Password
Path
ResetIntoFlag
SavePlmPerm
SetAsBillAttatchment
SetStage
SignSubmit
UnSetBillAttatchment
UpdateLineNo
UpdateParentNos
UpdateProcCost
UpdateUpID
UseSeal
UseWatermark
Username
WriteFileLog
bill_func_id
bill_func_name
bill_func_url
bill_id
bill_if
ca_user_id
ca_user_name
checkout_if
checkout_user_id
checkout_username
companyName
connector
cr_user_id
cr_username
datestr
deptName
dir_fullpath
dir_name
empty_display
exam_if
field
file_ver
func_id
incod
isParent
items
length
line_no
linkage_if
location
md_user_id
md_username
mvar_
name
not_changed
note
notnull_if
open
org_id
org_no
pId
path
perms
pid
position
precision
stage
stageStr
stage_id
stage_name
stage_text
state
state_name
statusStr
text
type
value
verIsExists
watermarkString
```

字段清单:
```
"", "0", "656e0a96-01cc-48f9-b8bb-1c17888abf17", "AA", "ID", "PLM_Directorys", "PLM_FileVersions", "PLM_Files", "\\d+", "保存文件出错。", "签入文件出错。", 1000, 120, CDir_ID, CName, HOLDLOCK, HandleSameFileName, ID, IFName, Now, Parameters, RelaFd, RemoveEmptyEntries, RolesID, SFName, VarChar, ["cr_date"], ["cr_user_id"], ["line_no"], ["name"], ["org_id"], ["pid"], [name], \r\n, \r\n\t, _lv+1, add, add_dir, bool, case, checkExists, checkExists:, checkinFileId, checkout_username, cname, code, code:, contentRange, convertPdf, cr_date, cr_date\r\n\r\n;with, cr_user_id, data:, dataObj, dirId, dirName, dir_id, edit, ex, exam_if, exam_if\r\n, failmsg, false, field, fileExtension, fileId, fileId:{fileId}", filePath, file_id, file_ver, filedId, filename, filesize, htxList, id, includeRoot, int, isFtSys:, keyword, long, lv+1, mat_ver, md_date, mode_no, modeb_id, name, new, new, newFileId, new_val, new_val";, no_perms, note, null, object>, old_val, optype, orgId, owner_type, pId, pacode, pagesize, pagingParams, parent_no_perms, parent_perms, path, perms, pid, pid\r\n, plm_id, plm_type, pms, rangeEnd, rangeStart, ref, renderPdf:, sqlPer, stage, stage_id, start, state, state_id, state_name, str, strSql, string, string>, string[], style_name, text, top, totalSize, trans, true, url, user_id, userid, where, {, {3}
```

---

## SKY.NetFrameWork.BLL.Web.POS

- BLL文件数: 27
- 业务方法数: 125
- 引用的表数: 94
- 字段总数: 405

涉及表:
```
$APS_ReceiptA
$APS_ReceiptB
$BOM_MkCMachine
$BOM_WStation
$FAS_Pa_Type
$FAS_Pa_init
$HR_Emp
$MMS_CraftsA
$MMS_CraftsB
$MMS_CraftsB_Back
$MMS_PartB
$MMS_PartB_back
$MMS_Style
$OA_ITEM_Speeda
$OA_ITEM_Speedb
$OA_ITEM_Speedb_pob
$OA_WordB
$POS_AdjA
$POS_AdjB
$POS_AdjB_Affect_temp
$POS_AskpriceA
$POS_AskpriceA_Processed_temp
$POS_AskpriceB
$POS_AskpriceB_back
$POS_Askprice_temp
$POS_Askpriceb
$POS_Collect
$POS_OrderRecTrackRpt_temp
$POS_POABAnalysisRpt_temp
$POS_POB_UnPaid_temp
$POS_PoA
$POS_PoA_Confirm
$POS_PoA_Payments
$POS_PoA_Payments_back
$POS_PoB
$POS_Pob
$POS_Pricing
$POS_PrtA
$POS_PrtA_back
$POS_PrtB
$POS_PrtB_back
$POS_RePoA
$POS_RePoB
$POS_RePoB_Reason
$POS_RePoB_back
$POS_RePo_temp
$POS_RePob
$POS_RecA
$POS_RecB
$POS_RecB_back
$POS_RecStatusPreRpt_temp
$Pos_Pob_back
$QC_ChkB
$QC_ChkB_back
$QC_TrecA
$QC_TrecB
$QC_TrecB_back
$SDS_soA
$SDS_soB
$SKY_Orangise
$SKY_Users
$SYS_BillCategory
$SYS_CManagA
$SYS_Curya
$SYS_Curyb
$SYS_CusA
$SYS_CusCode
$SYS_CusRate
$SYS_Cusa
$SYS_DealCost
$SYS_Feature
$SYS_GoodInA
$SYS_GoodInC
$SYS_InvCatl
$SYS_Item
$SYS_ParCatB
$SYS_ParCatC
$SYS_PriceType
$SYS_SMater
$SYS_Sales
$SYS_Settle
$SYS_SpTypeA
$SYS_Trans_End
$SYS_UpLoadDat
$SYS_WhouseA
$SYS_WhouseB
$v_POS_PoB
$v_POS_RecB
$v_SYS_GoodInA_all
$v_SYS_Trans_End_GD
$v_SYS_Trans_End_Normalnosp
$v_SYS_Trans_End_now_st
$v_SYS_Trans_End_nowh
$v_SYS_Trans_End_sp
```

业务方法:
```
Accept
AllWriteoff_if
BeforeSaveCheckQuan
BillSettleAndUnSettle
CallBackAbnorImproveB
CanDelete
ChangeRecord
Check
CheckA
CheckAAll
CheckAPS_Account
CheckAPS_ReceiptA
CheckApsStatement
CheckBillBeforeDel
CheckBillBeforeEdit
CheckChkMOS_Crop
CheckCompare
CheckDelete
CheckExists
CheckFromDate
CheckOver
CheckOverQuan
CheckPosOutIf
CheckPriorty
CheckRePob_QuanForJS
CheckSameCusfromPre
CheckUse
ChkIfMore
Chk_if_more
Chk_sp_quan
ClearData
Compare
CompareToPo
ConvertAdjaToSdsProc
DealAffectBill
DealSplitProc
DealVocProc
DelOrModAllCondition
Delete
DeleteByID
DeleteSameRecord
DeleteTempTableData
ExeSettle
ExecChangeBill
Exists
GetAState
GetAll
GetAllRecBByRecAID
GetApiDataByID
GetChangeAffectBillData
GetDataByID
GetDateBySch_ID
GetDatebyAsk_no
GetDatebyP_quan
GetDynamicCusDatas
GetEmpDataByEmpNo
GetEst_price
GetFirstLast
GetGdByCode
GetGoodsByAjaxPoaCode
GetGoodsByPoaID
GetGoodsByPoaIDAndGdID
GetGoodsByRePoaID
GetGridDatas
GetListData
GetMTableNewData
GetOld_price
GetOut_type
GetPoaByCusID
GetPobAddinfo
GetPosRePo
GetPos_RepoToAsk
GetPos_RepoToPo
GetPos_pocByID
GetPrice_no
GetPrices
GetRePoA
GetRePoBData
GetRepobUnionData
GetSingleData
GetStoreDataByGdID
GetWhouse
Getpos_poa_img
GridCanDelete
InsertPos_poa_union_temp
IntoPa
IntoTableFromData
IsCanDeletePobData
NotifySupplier
Pos_AskpriceBToCompare
Processed
Produce_LineID
QueryDataProc
ReAsk
RefreshBillState
RefreshPrice_rank
SaveOldDataFromPoAB
SearchDataProc
SerachDataProc
SetAState
SplitBillCheck
StopAsk
UpdateCraftsbWithSch
UpdateExists
UpdateMasterData
UpdateReAsk_no
UpdateReP_quan
UpdateRePoBStateByRePoA
UpdateTableFromData
WritePoaState
addConfirm
delConfirm
editConfirm
getAllPobList
getConfirmList
getDateState
getPOSReason
getPoaStaus
getSigleRecord
getStaus
getUPposADll
getUPposDll
getdatePrice
unCheck
unCheckA
```

字段清单:
```
"", "0", "3", "POS_PoA", "POS_PoB", "barcode", "deduction_quan_if", "e", "p_quan", "po_ID", "po_no", $"\r\n, *\r\n, --, --单位\r\n, --单位换算率\r\n, --单重\r\n, --工程图号\r\n, --特征码\r\n, --预交日期, 0m, 10, 1000, 121, 1\r\n, 30, AID, Adj_User_ID, Adj_User_No, Adj_date\r\n, Ask_no, Bill_Rate, Bond_SP_ID, Bond_SP_No, Bond_WH_No, BsUnit, BsUnit_ID, CMCode, CMName, CMngA_ID, CMngA_No, CName, CName\r\n, C_Value, Ca_User_ID, Category_ID, Code, ConBat, ConSer, Crafts_Explain, CuCode, CuryID, Cury_ID, Cury_Name, Cury_No, Cus_Boss, Cus_Contact, Cus_Fax, Cus_Name, Cus_No, Cus_Rate, Cus_Shipping, Cus_Short, Cus_Tal, Cus_Virtue, Diameter, EDraNo, EnName, Ename, FT_ID, From_ID, From_No, Fromb_ID, FtCode, Ft_ID, Ft_No, GAbbre, GColor, GD_ID, GD_No, GStand, GWidth, Gabbre, GdCode, GdInA_ID, GdInA_No, GdInB_ID, GdName, GdType, Gd_No, GooNum, GoodInA_GStand, GoodInA_ID, GoodInA_Name, GoodInA_No, Gweight, Height, Htreat, ID, ID\r\n, IFName, InCod1, InCod2, InCode, InDiameter, InName, InvState\r\n, Length, Limit, Mcm_Name, NetWeight, OIName, OInvID, OInvNo, OldState_ID, OragCD, OragID, OrderColumn, Org_ID, P_SP_quan, PaCode, Parameters, ROHS, ReUser_ID, ReUser_No, Reason, Reason_ID, Reason_name, Reason_name\r\n, Reason_no, RelaFd, SELECT, SFName, SMater, SMater_ID, SMater_Name, SMater_name, SMater_name\r\n, SModel, SP_ID, SP_No, SP_Rate, S_SP_quan, S_quan, S_weight, Sales_Name, Sales_No, SettleID, Settle_Caption, Settle_No, Settle_id, Size, SpName, SpName\r\n, SpType, SpTypeA_ID, SpTypeA_No, Sp_ID, Sp_No, SpacNo, Sql, SqlDbType, SqlValue, State_ID, Style_Name, Style_No, Tax_Rate, Traders, Traders_id, Type_Name, VarChar, VirtueID, VirtueName\r\n, VirtueNo, Virtue_ID, WG_Weight, WHCode, WHName, WH_ID, WH_No, Weight, Where, Wst_ID, Wst_no, X2, X3, Z1, Z2, Z3\r\n, [timestamp], \r\n, \r\n\r\n, \r\n\t, agio_rate, ask_no, b_ID, barcode, billID, billIds, billNo, bill_ID, bill_id, bill_no, bill_tag, bill_tag_id, billa_ID, bool, ca_date, ca_user_id, ca_user_no, case, check_if, cl_date, cl_user_id, cl_user_no, cmcode, cmdP_quan, cmd_billa_id, cmd_billb_ID, cmd_billb_id, cmdr_date, cname, code, cr_date, crafts_explain, craftsbId, cury_ID, cury_id, cury_name, cury_no, cus_Name, cus_fax, cus_id, cus_name, cus_no, cus_no\r\n, cus_ord, cus_short, cus_tal, deduction_quan_if, def_type, deptCD, deptID, detailData, distinct, emp_nam, emp_no, end_date, est_tot, fc_amt, fc_rate, fc_tot, fc_vat, fieldname1, fill, fill_ID, filterCus, from_id, from_no, from_tag, from_tag_id, frost, ft_no, gd_id, gd_no, htx, htx3, id, invo_tot, isSettle, item_id, item_name, item_no, key2, lc_amt, lc_tot, lc_vat, line_id, line_no, line_no", line_no\r\n, lt_no, lt_note, master, masterID, mk_lot, mold_id, mold_no, msgStr, new, note, null, op_date, op_type, op_type_ID, out, out_id, out_no, p_chk_quan, p_df_price, p_est_price, p_fc_low_price, p_fc_price, p_from_quan, p_from_sp_quan, p_in_quan, p_inv_quan, p_lc_price\r\n, p_po_quan, p_price, p_quan, p_re_quan, p_sp_price, p_sp_quan, p_st_quan, p_unit, p_weight, parameters, parta_id, partb_id, piece_no, po_ID, po_id, po_no, po_quan, po_user_no, poa_ID, poaid, precision, price, price_id, r_date, rea_id, rec_ID, rec_date, rec_id, rec_no, rec_type, rec_type_id, rec_user_id, rec_user_no, reca_id, recb_id, reply_date, reply_text, reply_text\r\n, req_date, rohs, s_ac_quan, s_chk_quan, s_est_price, s_est_price\r\n, s_fc_low_price, s_in_quan, s_po_price, s_re_quan, s_sp_price, s_st_quan, s_tac_quan, shape_if, shapeif_id, ship_no, state, state_ID, string, string>, taxTypeName, taxTypeNo, tax_rate, tax_type, tax_type_ID, top, trec_id, trec_no, unit_rate, user_id, user_mark, user_no, vCode, val, wordb_name, wordb_no, wordc_field, wordc_field_length\r\n, wordc_field_type, wordc_name, wordc_no, wordc_no", wst_alia, wst_ename, wst_id, wst_jname, wst_name, wst_name\r\n, wst_no, y_recb_ID, y_recb_ID2, {0}, {1}, {2}, {4}, 数量超出{1}个单位, 模具工艺卡\r\n, 程序中检查当前采购单承上工序ID是否存在\r\n, 请购单
```

---

## SKY.NetFrameWork.BLL.Web.POS.QS

- BLL文件数: 1
- 业务方法数: 4
- 引用的表数: 3
- 字段总数: 16

涉及表:
```
$SYS_GdClass
$SYS_GdClass_def
$SYS_GoodInA
```

业务方法:
```
Delete
DeleteByID
GetDataByID
GetListData
```

字段清单:
```
-1\r\nelse\r\nbegin\r\n, BsUnit, BsUnit_ID, GStand, Gd_ID, Gd_No, SELECT, \r\n, bool, class_name, id, p_id, price_1, price_2, price_3, price_4
```

---

## SKY.NetFrameWork.BLL.Web.QC

- BLL文件数: 19
- 业务方法数: 55
- 引用的表数: 50
- 字段总数: 287

涉及表:
```
$BOM_MkCMachine
$BOM_MkCent
$BOM_WStation
$BOM_WStationB
$BOM_WstationC
$HR_EMP
$HR_Emp
$MMS_Style
$MMS_WareA
$MOS_PlanA
$MOS_PlanA_back
$OA_WordB
$POS_PoB
$POS_RecA
$POS_RecB
$Pos_Pob_back
$QC_ChkA
$QC_ChkB
$QC_ChkB_back
$QC_ChkC
$QC_Item
$QC_Rework
$QC_TrecA
$QC_TrecARpt_temp
$QC_TrecB
$QC_TrecB_back
$QC_UrecA
$QC_UrecB
$QC_Worka
$SDS_soB
$SKY_Orangise
$SKY_Users
$SYS_BillCategory
$SYS_CManagA
$SYS_CusA
$SYS_Feature
$SYS_GoodInA
$SYS_GoodInC
$SYS_GoodInF
$SYS_InvCatl
$SYS_ParCatC
$SYS_SMater
$SYS_SpTypeA
$SYS_Trans_End
$SYS_UpLoadDat
$SYS_WhouseA
$SYS_WhouseB
$sky_users
$v_SYS_GoodInA
$v_SYS_Trans_End_now_st
```

业务方法:
```
AddDataToMOS_RecBill
AddDataToPOS_RecBill
AddDataToQC_UrecABill
AddDataToSDS_OutBill
ChangeDept
ChangeStaus
CheckBeforeDelete
CheckBillBeforeDel
CheckExistsNo
CheckOver
CheckPermit_day
CheckQuan
Chk_if_more
Chk_if_moreApp
Chk_sp_quan
CountLoss
DeleteByID
DeleteTempData
ExistsItem_No
GetBOM_WstationC
GetBadRecord
GetChkbAddChkC
GetDataByID
GetDetailData
GetFinBData
GetFinCByID
GetLPNDate
GetListData
GetMCMOrEmpData
GetMcmState
GetMcm_Data
GetOtherDataByWst
GetPageDataByID
GetSYS_BillCategory
GetWorkBData
GetWorkG
GetWorkGDataByID
GetWst
GetWstsByMcmID
GetchkbBybID
Getgd_idAddChkC
IntoTableFromData
IsUsedBill
IsUsersQCchkAB
MoneytoLoss
SceneProceOp
SearchMcmData
UFromBillNo_Sign
UpdateCraftsB_Back
backMosPlanAData
chkm_tacQuan
chktacQuan
getDtablePagingData
getMTableState
sqlA
```

字段清单:
```
"", "0", "1", "2", "Gd_No", "QC_FieldProceWstList_Temp", "\n", "out_rec_quan_if", "p_quan", $"select, 0m, 10, 1000, 16585, 16586, 16587, 16588, 16589, 16590, 17442, 17443, 17444, 17445, 29, BsUnit, BsUnit_ID, CMName, CManagA_No, CName, Caps_quan, Code, Crafts_Explain, Cus_Name, Cus_No, Diameter, EDraNo, EnName, FieldQuerySql, Ft_No, GAbbre, GStand, GWidth, GdCode, GdInA_No, GdMSDS, GdName, GooNum, GoodInA_GStand, GoodInA_ID, GoodInA_Name, GoodInA_No, GrPart, Height, Htreat, ID, IFName, InCod2, InCode, InCode1, InCode2, InName, InName1, InName2, JObject, Length, Limit_quan, Mcm_Name\r\n, Mk_Name, OIName, Output, Parameters, ROHS, ReUser_ID, RelaFd, Remark, Result_If, SFName, SMater, SMater_Name, SMater_name, SpName, SpTypeA_ID, SpTypeA_Name, SpTypeA_No, Splan_ID, Splan_No, State_ID, String, Style_Name, TPTRep, Top_quan, Type_ID, Type_Name, Type_Name\r\n, Type_No, WHName, Where, Wst_Name, Wst_name, [state], \r\n, \r\n\t, \r\nf.SFName, abnb_ID, auto_IF, bID, barcode, base_quan\r\n, billa_ID, bom_s_quan, bool, case, check_explain, childJson, childJson2, chk_no, chka_id, chkb_ID, cmdP_quan, cmdr_date, cname, commandType, cus_Name, cus_name, cus_name\r\n, cus_no, cus_ord, day, days, decimal, degree, down_quan, empIds, emp_nam, emp_no, end_date, filter, finb_ID, flow, gd_id, gd_no, gdinc_id, gdinc_no, htx, htx4, htx6, id, int, item_ID, item_Name, item_name, item_no, jbeg_date", jbeg_date";, key, keys, lang, line_no, lt_no, lt_note, master, mat_no, mcm_ID, mcm_name, mcm_name\r\n, mcm_no, mk_name, mk_name\r\n, mk_no, mold_no, msg, msg2, msgStr, msgStr2, msgStr3, new, new, no_mcm, note, null, opType, op_date, op_user_id, opt_mark, otherUser\r\n, p_quan, p_quan1, p_quan10, p_quan2, p_quan3, p_quan4, p_quan5, p_quan6, p_quan7, p_quan8, p_quan9, p_unit, p_weight, piece_Name, piece_no, piece_no\r\n, plan_no, plana_ID2, plana_ID3, plana_id, po_no, pob_ID, pob_ID2, precision, r_date, result_1, result_10, result_11, result_12, result_13, result_15, result_16, result_17, result_18, result_19, result_2, result_3, result_4, result_5, result_6, result_8, result_9, revise_num, s_do_quan, s_do_sp_quan, s_in_quan, s_quan, s_rt_quan, sob_id2, sqlCmd, sqlStr, state, stateCode, stress_IF, string, string>, subData, text10, text11, text12, text13, text14, text15, text17, text18, text19, text2, text20, text3, text4, text5, text6, text7, text8, text9, tool_ID, tool_no, treca_ID, type, unit_rate, useTrans:, user_id, ware_name, ware_no, wayIF_ID, way_IF, way_if, way_if_ID, wordb_name, wordb_no, worker, wst, wst_Name, wst_name, wst_no, {, {0}, {1}, {2}, {3}, 模具工艺卡\r\n, 请购单
```

---

## SKY.NetFrameWork.BLL.Web.Report

- BLL文件数: 2
- 业务方法数: 7
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
AddQueryLog
ClearData
SaveAsHomeCard
SaveChartSolutionList
SaveSolutionAs
SaveSolutionFilter
SaveSolutionList
```

---

## SKY.NetFrameWork.BLL.Web.SDS

- BLL文件数: 35
- 业务方法数: 219
- 引用的表数: 128
- 字段总数: 698

涉及表:
```
$ARS_ReceiptB
$ARS_StatementsA
$ARS_StatementsB
$BOM_MkCent
$BOM_WStation
$GLS_VocA
$MMS_Style
$MOS_RecA
$MOT_CatSet
$OA_CRM_CusA
$OA_CRM_ServiceA
$OA_ITEM_Speeda
$OA_ITEM_itema
$OA_WordB
$SDS_AdjA
$SDS_AdjB
$SDS_AdjB_Affect_temp
$SDS_DiscountA
$SDS_DiscountB
$SDS_OrderRecTrackRpt_temp
$SDS_OutA
$SDS_OutA_FreightA
$SDS_OutA_FreightB
$SDS_OutA_back
$SDS_OutB
$SDS_OutB_back
$SDS_OutStatusPreRpt_temp
$SDS_Policy
$SDS_Policy_temp
$SDS_Pricing
$SDS_Pricing_temp
$SDS_ProRecTrackRpt_temp
$SDS_QuotA
$SDS_QuotA_Details
$SDS_QuotB
$SDS_ReManageA
$SDS_ReManageB
$SDS_ReMonthA
$SDS_ReMonthB
$SDS_ReMonthC
$SDS_RePolicyA
$SDS_RePolicyB
$SDS_RePolicyC
$SDS_RecA
$SDS_RecB
$SDS_SalesAnalysisRpt_temp
$SDS_SoA
$SDS_SoABNotOutRpt_temp
$SDS_SoA_back
$SDS_Soa
$SDS_SpedA
$SDS_SpedB
$SDS_SpedB_GdNos
$SDS_SpedC
$SDS_SpedD
$SDS_SpedD_Vests
$SDS_SrtA
$SDS_SrtAB_temp
$SDS_SrtA_back
$SDS_SrtB
$SDS_SrtB_back
$SDS_TempA
$SDS_TempB_GdNos
$SDS_TempC
$SDS_TempD
$SDS_TempD_Vests
$SDS_soA
$SDS_soA_Confirm
$SDS_soA_Rate
$SDS_soA_temp
$SDS_soB
$SDS_soB_back
$SDS_soa
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_BillCategory
$SYS_CManagA
$SYS_CManagC
$SYS_Channel
$SYS_Curya
$SYS_Curyb
$SYS_CusA
$SYS_CusB
$SYS_CusC
$SYS_CusCode
$SYS_CusD
$SYS_CusRate
$SYS_Cusa
$SYS_DealCost
$SYS_Feature
$SYS_GoodInA
$SYS_GoodInB
$SYS_GoodInC
$SYS_InvCatl
$SYS_InvNoA
$SYS_Item
$SYS_MsUnit
$SYS_PackInf
$SYS_ParCatB
$SYS_ParCatC
$SYS_PriceType
$SYS_Region
$SYS_SMater
$SYS_Sales
$SYS_Settle
$SYS_SpTypeA
$SYS_TradeInfo
$SYS_Trans_End
$SYS_Transport
$SYS_UpLoadDat
$SYS_WhouseA
$SYS_WhouseB
$SYS_WhouseC
$V_SYS_Param
$WF_WorkFlowRun
$WHS_MoveA
$WHS_MoveB
$v_SYS_GoodInA
$v_SYS_GoodInA_all
$v_SYS_Trans_End_GD
$v_SYS_Trans_End_M
$v_SYS_Trans_End_Normalnosp
$v_SYS_Trans_End_nosp
$v_SYS_Trans_End_now_st
$v_SYS_Trans_End_sp
$v_sds_outb_back
$v_sky_users_seal
```

业务方法:
```
AcceptStatic
AddFreight
AddReMonth
AddRePolicy
AddSOA
AllWriteoff_if
Back_So_State
BeforeCheckPost
BeforeUnCheckPost
BillCancelLock
BillLock
BillsAccept
ChangeRecord
CheckA
CheckBillBeforeDel
CheckCusCredit
CheckDetailLock_if
CheckExists
CheckIsExistsPOBill
CheckMateData
CheckOverQuan
CheckPost
CheckProperty
CheckRecordExists
CheckStockQuan
Check_if_OverSt
Check_if_OverSt_save
Chk_if_OverSt
Chk_if_more
Chk_if_moreTrans
Chk_if_moreXhth
Chk_sp_quan
CleanTempData
CusRate
DealAffectBill
DelOrModAllCondition
DelSdsRemonthA
DelSped
Delete
DeleteByID
DeleteByIDRate
DeleteTempData
DeleteTempTableData
ExeSettle
ExecChangeBill
Exec_CalcOrderPrice
Exists
ExistsFreight
ExistsSo_No
ExpandDetail
GetAccountWithInCode
GetAll
GetAllCusList
GetAllList
GetAllTradCusList
GetApiDataByID
GetBAndCDataByBillId
GetBillCategory
GetCMGrpByIncode
GetCategory
GetChangeAffectBillData
GetChildDataByID
GetConfirmPagingData
GetDataByID
GetDateToRec
GetFC_SubsistVale
GetGdByCode
GetGoodIncbyA
GetGoodsByCMGrp
GetGoodsBySoaID
GetGstandByIncode
GetListData
GetLotNoData
GetMasterByID
GetOrangiseUser
GetOutDetailByCusAndDate
GetOutDetailByOutId
GetOutSoaMByCusID
GetOutSoaMByDeptIDWH
GetOutaMByCusID
GetOutaMBydeptID
GetPPlanGoodA_No
GetPageDataByID
GetReMonthB
GetReMonthC
GetSDS_SOA_Rate
GetSYSWhouseValue
GetSearchDataBySob
GetSeecCus
GetSeekDefaultWhere
GetSo_type
GetSoaByCusID
GetSoaMByCusID
GetSoaState
GetStyle_Name
GetSumOrderQuan
Getsds_so_from_no
Getsds_soa_img
HasDuplicate
InsertSped
IntoGD
IntoMMS_EvaluateA
IntoOaItemSpa
IntoPricing
IntoTableFromData
InvCatl
IsCanDeleteBill
IsUserBillSoAB
LoadCMGrpAndPrice
NoExisted
ObtainMatePrice
OverCaseCheckData
Overcase
QueryDataProc
ReOvercase
RefHisPrice
RefreshLineNo
RefreshMasterSum
RelaIDifGoodIna
SaveDataToTempTable
SaveOldDataFromSoAB
SaveSeekDefaultWhere
SettleBill
SoStoreOutlist
SubmitData
ToOutAB_Proc
UnSettleBill
UpdateCopymvar
UpdateExists
UpdateGoodInAItem
UpdateRePolicy
UpdateRemonth
UpdateSOA
UpdateTableFromData
WriteSoaState
WriteSobState
addConfirm
addOrUpdateData
addSDS_Discount
addSDS_ReManageB
calcSquan
checkGStand
creatSOACode
delConfirm
delRePolicyA
delSdsSobByOutID
editConfirm
editSDSPolicy
editSDSPricing
getAllOutBList
getAllRecord
getAllSobList
getAlldisbList
getAllrembList
getConfirmList
getControl
getCusByID
getCusByNo
getCusList
getDateByfrom_ID
getDealCost
getDiscChildList
getDiscount
getFcRate
getFreightAList
getFreightBList
getGodsBySobID
getGoodInbList
getGoodIncList
getGoodsAByCode
getGoodsAByID
getGoodsDat
getInvWhouseA
getInvWhouseB
getMoveNoUpdateSQL
getOfftakeItem
getOtherGoods
getOtherGoodsNo
getOutIDByNo
getOutMoveSQL
getOutMoveUpdateSQL
getP_priceByGd_ID
getPagingDat
getPriceGoods
getPriceType
getReplyState
getSDSSoAByCusID
getSDSSoAByNo
getSYSGoodInA
getShipments
getSigleRecord
getSingleRecord
getSoStaus
getSoaGoogd
getSoaStaus
getSoutQun
getTax
getUnits
getUpdateReturnNoSQL
get_p_price
getsdspriceByhis
haveRecordUnDeal
isBillChk
isBillChkArsReceipt
isBillChkB
isBillChkOaCrmService
isBillChkOaCrmStatementsB
isEnableCode
isJgCategory
unCheckA
uniqueCheck
upOverCase
upUnOverCase
updateAccept
updateReMonthB
updateReMonthC
updateSDSSoB
updateSDSoutB
updateState
```

字段清单:
```
"", "0", "1", "2", "3", "7", "Out_State", "change_report", "false", "out_no", "overst_if", "p_quan", "p_sp_quan", "success_if", *\r\n, --出货单号\r\n, --单位，单价，出货数量\r\n, --单位，单价，出货数量\r\n\t\t, --商品ID, --型号\r\n\t\t, --序号\r\n\t\t, --特征码\r\n\t\t, --颜色, 00, 0m, 10, 1000, 120, 121, 1\r\n, 200, 23, 36000, ABCPro, ABCPro_ID, ABCPro_Name, Acct_Name\r\n, Addr_Info, Bill_Rate, Bill_Rate\r\n, Billa_ID, BomIF_ID, Bom_ID, Box_Nums, BsUnit, BsUnit_ID, CA_Date, CA_user_No, CAttrb, CMCode, CMGrp, CMGrp\r\n, CMGrp_ID, CMName, CManagA_ID, CManagA_No, CMngA_ID, CMngA_No, CName, Cat_ID, Cat_Name, Cat_No, Category, Category_ID, Channel_Name, Channel_Name\r\n, Channel_No, Channel_Note, CnRate, Code, ConBat, Cont_Fax, Cont_Name, Cont_tal, Contact_Tel, Cost_Name, Cost_Name\r\n, Cost_No, Cost_Note, Cr_Date, CuCode, Cucode_ID, Cury_ID, Cury_Name, Cury_Name", Cury_Name\r\n, Cury_No, CusCode, Cus_Addr, Cus_Boss, Cus_Contact, Cus_Factor, Cus_Fax, Cus_ID, Cus_Name, Cus_Name\r\n, Cus_No, Cus_Rate, Cus_Shipping, Cus_Short, Cus_Tal, Cus_Times, Cus_Virtue, Delivery_Addr, DeptCD, Dept_No, Diameter, Direction, Discount1, Discount10, Discount2, Discount3, Discount4, Discount5, Discount6, Discount7, Discount9, EDraNo, EnName, EndDate, FA_Carrier, FA_Date, FC_Amt, FC_Subsist, FC_Tot, FC_Vat, FC_after_Amt, FC_after_Tot, FC_after_Vat, FMater, FT_ID\r\n, FT_ID\r\n\t, Feature_ID, Feature_No, FreightA_Addr, FreightA_ID, FreightA_Note, FreightB_Note\r\n, FromType_ID, FromType_No, From_ID, From_ID2, From_No, FtCode, Ft_ID, Ft_No, GAbbre, GColor, GD_ID, GStand, GStand\r\n, GWidth, Gabbre, GdArea, GdBrand, GdCode, GdInA_ID, GdInA_No, GdInA_No\r\n, GdInA_No\r\nhaving, GdInB_ID, GdInC_ID, GdInC_No, GdName, GdType, GdUnit, Gd_ID, Gd_Name, Gd_No, GdinC_ID, GdinC_No, GodAID, GooNum, GoodInA_ID, GoodInA_No, GoodInC_ID, GoodInC_No, Height, Htreat, ID, IFName, Id, InCod1, InCod2, InCode, InCode1, InCode2, InDiameter, InID, InName, InName1, InName2, In_State_ID, In_state, Item_Num, Item_nam, LC_Amt, LC_Subsist, LC_Tot, LC_Vat, LC_after_Amt, LC_after_Tot, LC_after_Vat, LT_NO, Length, LoginName, Lt_ID, Lt_ID\r\n\t, Lt_No, Lt_No\r\n\t, Manu_Input, Mer_User_ID, MosRecA_ID, MsUnit, NO, NVarChar, NetWeight, Now, OCCode, OC_date, OIName, OInvNo, OldState_ID, Old_State, OutBState_ID, OutB_Note, OutB_State, Out_ID, Output, PICode, PIName, PStand, P_RE_quan, P_SP_quan, P_SWeight, P_quan, PaCode, Parameter, Parameters, ROHS, Rec_Date, Rec_User, Region_Name, RelaFd, RelaID, Remark, SArea, SELECT, SFName, SMater, SMater_ID, SMater_Name, SMater_name, SMater_quan, SMater_weight, SModel, SO_ID, SO_No, SP_ID, SP_No, SP_Rate, S_SP_quan, S_SWeight, S_ac_quan, S_price, S_quan, S_so_quan, S_weight, Sales_Name, Sales_No, Save_Rate, SectionIF_ID, Section_IF, Settle_Caption, Settle_Fixed, Settle_ID, Settle_No, Settle_Note, SfQuan, SfQuan\r\n, Size, SoB_ID, SoState_ID, So_State, SobState_ID, Sob_ID, Sob_state, SpName, SpName\r\n, SpTypeA_ID, SpTypeA_Name, SpTypeA_No, SpTypeA_No\r\n\t, Sp_ID, Sp_No, SpacNo, SqlDbType, Strict_pric, String, Style_No, TaxType_ID, Tax_Rate, Tax_Type, Trade_Name, Transport_ID, Transport_Name, Transport_No, Type_Name, Type_No, Type_Note, Users_ID, Users_no, Value, VarChar, Virtue_ID, Volume, WG_Weight, WHCode, WHName, WH_ID, WH_No, Weight, Wh_ID, Wst_Name\r\n, [CMGrp_ID], [Channel_ID], [Channel_NO], [Cr_Date], [Cury_ID], [Cury_No], [Cus_Rate], [Ft_ID], [Ft_No], [GStand], [GdInB_ID], [GoodInA_ID], [ID], [InCod1], [InCod2], [OragCD], [OragID], [S_quan], [beg_date], [deptCD], [deptID], [end_date], [fc_rate], [note], [olds_fc_price], [olds_lc_price], [p_fc_low_price], [p_lc_low_price], [p_lc_price], [p_unit], [price_type], [price_type_ID], [s_fc_low_price], [s_fc_price], [s_fc_price_in], [s_lc_low_price], [s_lc_price], [timestamp], [unit_rate], [user_id], [user_no], \r\n, \r\n\r\n, \r\n\r\n\t, \r\n\t, \r\n\t\t, \r\n\t\t\t, \r\n\t\t\t\t, \r\n\t\t\t\t\t, \r\n\t\t\t\t\t\t, \r\n\t\t\t\t\t\t\t\t\t, \r\n\t\tcus.Cus_Name, \t\t\t, aID, a_ID, a_id, ac_date, accordant, adjIF_ID, adj_IF, adja_ID, after_Discount1, after_Discount2, agio_rate, autocraf_if, bIDs, b_oc_date, b_oc_user_id, b_oc_user_no, base_quan, billID, bill_ID, bill_no, bill_type, bill_type_ID, billa_ID, body_no, bom_if, bom_no, bool, brand, buffered:, cName, c_GdInA_ID, c_GdInA_No, c_price, c_value, case, cat_no, chamfer, checkList, childJson, cl_date, cl_user_id, cl_user_no, cmcode, cmname, cname, code_if, code_if\r\n, codeif_id, commandType, con_cont, conf_date, cont_Mobile, cont_Name, control_if, cucode_No, cury_ID, cury_No, cury_id, cury_name, cury_no, cus_ID, cus_Name, cus_No, cus_fax, cus_id, cus_name, cus_no, cus_ord, cus_rate, cus_short, cus_tal, decimal, decimal>, delivery, det_name, distinct, end, end2, fc_after_amt, fc_amt, fc_cash_tot, fc_rate, fc_rate\r\n, fc_subsist, fc_tot, fc_tot_amt, fc_vat, fill_ID, fill_if, findid, from_ID, from_No, from_id, from_no, from_tag, from_tag_id, from_type, from_type_ID, gd_ID, gd_No, gd_ids, gstand, gwidth, height, hrc_price, htx, htx2["_chk_more_bids"], id, in_part_if, int, into_oa_item_spa_id, invo_tot\r\n, isCheck, isXhth, isincoming, item_ID, item_No, item_id, item_name, item_name\r\n, item_no, key, lc_after_amt, lc_amt, lc_cash_tot, lc_pro_tot, lc_tot, lc_tot_amt, lc_vat, length, line_no, line_no\r\n\t, lock_date, lock_if, lock_note, lock_user_id, lock_user_no, lot_no, lot_no";, lt["_chk_more_bids"], lt_no, lt_note, ltno["_chk_more_bids"], master, masterwh_id, masterwh_no, mate_price, matesize_if, md_date, mill, mill_price, mold_id, mold_no, msgStr, msgStr2, msgStr3, new, new, note, null, oa_item_spa_id, object>, old_State, old_State_ID, oldp_fc_price\r\n, opType, op_date, ord, ot_quan\r\n, ot_quan\r\n\t\t, outParams, out_id, out_if, out_line, out_mode, out_no, outa_id, over_check, p_ac_quan, p_avg_cost, p_b_price, p_fc_low_price, p_fc_low_price\r\n\t, p_fixed_price, p_his_price, p_nt_quan, p_price, p_quan, p_re_quan, p_so_quan, p_so_quan\r\n\t, p_sp_quan, p_st_quan, p_sub_quan, p_unit, p_unit\r\n, p_weight, p_y_quan, page_no, para, parameters, pgp_price, pk_ID, pk_cnt, pk_no, po_type, pob_if, precision, price_type, pt_quan, q_no, quan, quota_ID, r_date, reply_date, reply_text, rohs, round_price, row_code, s_ac_quan, s_ac_sp_quan, s_aval_quan, s_b_price, s_fc_low_price, s_fc_price, s_fc_standard_price, s_fc_wholesale_price, s_fixed_price, s_in_quan, s_lc_price, s_nt_quan, s_out_quan, s_po_sp_quan, s_pqua_quan\r\n, s_price, s_quan, s_re_quan, s_rec_sp_quan, s_so_sp_quan, s_sp_quan, s_st_quan, s_sub_quan, s_y_quan, sales_id, sales_name, sales_name\r\n, sales_no, sample_quan, sds_so_sratio, settle_no, shape_if, shapeif_id, short_no, soB_Note, so_ID, so_Virtue, so_date, so_id, so_no, soa_Note, soa_Note\r\n, soa_id, soaid, sob_ID, sob_id, sob_state, sob_state\r\n, sp_id, sp_no, st_Sp_ID, st_Sp_No, st_WH_ID, st_WH_ID\r\n\t, st_WH_no, start_date, state, state_ID, strID, string, string>, success, sweight, tax_rate, tax_rate\r\n\t, tax_type, tax_type_ID, taxtype_id, temp_no, tempa_ID, timestamp, timestamp\r\n\t, tolerance, top, trad_cus, trad_cus_id, trade_name, typewrite, unit_rate, unlock_date, vcode, voc_no, weight, wh_id, where_default, where_from, wheres, wordb_name, wordb_no, writeoff_amt, wst_name, y_out_ID, y_out_No, yuan_code, yuan_if, {0}, {1}, {2}, 不能结案, 种类\r\n\t\t, 规格\r\n\t\t, 请检查！"
```

---

## SKY.NetFrameWork.BLL.Web.SYS

- BLL文件数: 1
- 业务方法数: 4
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
DeleteByID
GetDataByID
GetListData
GetScheduleLog
```

---

## SKY.NetFrameWork.BLL.Web.SYS.BaseInfo

- BLL文件数: 18
- 业务方法数: 110
- 引用的表数: 25
- 字段总数: 106

涉及表:
```
$CHAT_Group
$CHAT_GroupMsg
$CHAT_GroupUser
$CHAT_MsgAttach
$OA_ITEM_Defend
$SKY_BusinessLog
$SKY_FieldExtenProperties
$SKY_FunctionFieldLog
$SKY_FunctionLog
$SKY_Functions
$SKY_FunctionsParameter
$SKY_Message
$SKY_MessageBak
$SKY_OperationLog
$SKY_Orangise
$SKY_Users
$SYS_BillCategory
$SYS_InvNoA
$SYS_InvNoB
$SYS_InvNoC
$SYS_NumDecSet
$SYS_Option
$SYS_ParCatB
$SYS_ParCatC
$v_sky_msg_all
```

业务方法:
```
AddCard
ChkAll
ChkRight
Content
CreateCard
CreateGroup
DelGroup
DelMsg
DelMsgByGroup
DelMsgByUser
DeleteByID
DeleteUserAddFunc
DoQuery
ExistsGroup
ExistsUser
GetAcctParaoptList
GetAllDecimalCategoryPrecision
GetAllGroupByLoginUser
GetAllOptions
GetBillCategoryForManagement
GetCategoryInfo
GetDataByID
GetDecimalByDecType
GetFieldLog
GetFromFun
GetFuncByCateID
GetFuncByTransCode
GetGroupBillInfo
GetGroupByLoginUser
GetGroupByUserID
GetGroupInfo
GetListData
GetMsgsByGroup
GetMsgsByUser
GetNumPrecByField
GetNumPrecByFunc
GetNumPrecByTblAndFld
GetOpetdLog
GetOrgComboxList
GetParaList
GetParaListByName
GetSessions
GetTableFieldsByTableName
GetUnReadCountByUser
GetUnReadGroups
GetUnReadMsgsByUser
GetUnReadUsers
GetUsersByGroup
InitNumPrecByFunc
IsCateNullDefault
Name
OutGroup
ReadAllMsg
ReadMsg
RemoveCard
SaveAllOptions
SaveAttach
SaveMsg
SaveSelection
SendMessage
SetCardCacheData
SetDecimalCat
SetHomeCard
ToJson
ToSendJs
UpdateBatchPara
UpdateFunction
UpdateGroupState
addMessage
assembly_name
contentType
create_by
delMessage
enabled_if
getAddMsgSql
getBillCategoryByCode
getBillCategoryEPS
getBillCategoryFlowType
getBillCategoryUseable
getCaption
getCaptionTable
getCateIsUsed
getDetail
getFunField
getFunIDTabName
getFunTabName
getFunctionLog
getInvNoBList
getInvNoCList
getInvNoList
getSended
getTabField
handTran
invoke_by
msgID
msgTitle
name
note
plugin_name
plugin_parameter
receiveID
sendEmail
sendID
sendName
title
updateFromCate
updateSYSInvNoB
updateSYSInvNoC
val_type
value
```

字段清单:
```
"$SKY_Message", "$v_sky_msg_all", 121, A_ID, CName, Cname, Content, Cr_user_ID, Data_Type, EMail, EMail1, EnbSet, FieldExtenPropertiesID, Gp_ID, ID, IPAddress, Item_Field, Key, LogDateTime, LogDescription, LogEvent, LogLevel, Manu_Input, Name, NewValue, NumDec_Value", OldValue, OperateTime, OperateType, Option_Note, OragCD, OragID, OrgId, ParamValue, SELECT, Separt, SerNum, Size, SqlDbType, SqlValue, TableName, UserId, UserName, Value, [Code], [Content], [IsDelete], [IsNode], [ShowOrder], [Type], [UpID], [findid], [msgDate], [msgID], [msgTitle], [msgType], [sendID], \r\n, bool, cat_precision, cateID, cname, code, code\r\n, contentType\r\n, datatype, false, fieldName, flow_type, flow_type_id, funID, fun_id, int, int>, item_name, item_no, log:, logo, msgDate, msgDate\r\n, msgID, msgTitle, name, new, new, note, org_id, receiveID, sendDel, sendID, session_user_id, sortNo, string, strval, strval", tableName, top, user_id, usrID, valtyp, wordSpot, {0}, {1}, {2}, {7}", };
```

---

## SKY.NetFrameWork.BLL.Web.SYS.Common

- BLL文件数: 1
- 业务方法数: 3
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
DeleteByID
GetDataByID
GetListData
```

---

## SKY.NetFrameWork.BLL.Web.SYS.CusBasicInfo

- BLL文件数: 16
- 业务方法数: 105
- 引用的表数: 40
- 字段总数: 124

涉及表:
```
$BUD_Acct
$MOT_CatSet
$OA_CRM_CusA
$OA_WordB
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_Ann
$SYS_Bank
$SYS_CManagA
$SYS_CManagC
$SYS_Channel
$SYS_Curya
$SYS_CusA
$SYS_CusA_MerUser
$SYS_CusB
$SYS_CusC
$SYS_CusC_multiDiscount_temp
$SYS_CusD
$SYS_CusF
$SYS_CusG
$SYS_CusRate
$SYS_Cus_SettleDays
$SYS_DealCost
$SYS_DealCost_Acct
$SYS_Feature
$SYS_InvCatl
$SYS_ParCatB
$SYS_ParCatC
$SYS_PriceType
$SYS_Region
$SYS_SMater
$SYS_Sales
$SYS_Settle
$SYS_TradeInfo
$SYS_Transport
$SYS_UpLoadDat
$SYS_WhouseA
$SYS_WhouseB
$sys_cusa
```

业务方法:
```
CheckCoUserCnt
CreatBillCode
DelDealCosts
DelPriceTypes
DelSettles
DelTransports
Delete
DeleteByID
Exists
GetAllDealCost
GetAllList
GetAllPeriod
GetAllSettle
GetCusAndRelationByID
GetCusByID
GetCusByUserId
GetCusIDByUserID
GetCusIdByRight
GetDataByID
GetDealCostsById
GetListData
GetPriceType
GetSalesByMerUser
GetScopeWhere
GetTransport
GetYearBefore
InsertDealCost
InsertPriceType
InsertSettle
InsertTransport
IsCanDelBill
IsCusExists
IsCusNameExists
IsOrganizationCodeDuplicate
MultiDiscountUpdate
RecBillCode
RtSettle_Days
SettleDays
UpDealCostAcct
UpdateDealCost
UpdatePriceType
UpdateSettle
UpdateTransport
UserBindToCusType
addCusA
addOrUpdateData
addSYS_CusB
addSYS_CusD
delSYS_CusB
delSYS_CusD
delSysCusA
geAnnByCode
geBankByCode
geSettleByCode
getAnn_No
getBank_No
getBlood
getCManagA
getChannelNo
getChannel_NoByCode
getCodeCount
getCuryByCode
getCuryNo
getCus
getCusA
getCusCodeByID
getCusType
getDateByCus_ID
getDeptNo
getFeature
getGender
getInvCatl
getMarriage
getMaxAddrNo
getPayMethod
getRegion
getRegionByCode
getSYSCusB
getSYSCusC
getSYSCusD
getSalType
getSales
getSalesByCode
getSeekPriceType
getSettleNo
getSigleRecord
getSupType
getSysCusAByCode
getSysCusAByID
getTax
getTradeByCode
getTradeInfo
getTransport
getTransportByCode
getcusBByCusID
getcusDByCusID
isExisted
saveMerUserNos
typeExisted
updateCusA
updateSYS_CusB
updateSYS_CusC
updateSYS_CusD
valiRepeatCusDAddr
valiShortNoRepeat
```

字段清单:
```
"oaca.Dept_No", "oaca.Mer_User_ID", "oaca.User_ID", *\r\n, Addr_Info, Addr_Note, Ann_Name, Ann_No, Bank_Name, Bank_No, CMCode, CMGrp, CMName, CManagA_Code, CManagA_ID, CName, Cat_Name, Channel_Name, Channel_No, Channel_Note, Code, Cont_Fax, Cont_Mobile, Cont_Name, Cont_Tal, Cury_Name, Cury_No, Cus_Addr, Cus_Boss, Cus_Contact, Cus_Credit, Cus_Factor, Cus_Fax, Cus_ID, Cus_Mail, Cus_Name, Cus_Name\r\n, Cus_No, Cus_Rate, Cus_Shipping, Cus_Tal, Cus_Virtue, DeptCD, DeptId, Discount1, Discount10, Discount2, Discount3, Discount4, Discount5, Discount6, Discount7, Discount8, Discount9, EndDate, Feature_Code, FtCode, ID, ID\r\n, InCode, InID, InName, Mer_User_ID, OragCD, OragID, PaCode, Region_Name, Region_No, Region_Note, Remark, SMater_name, Sales_Name, Sales_No, Sales_Note, Sales_Task, Save_Note, Save_Note\r\n, Save_Rate, Settle_Caption, Settle_Fixed, Settle_No, Settle_Type, SpName, Tax_Rate, Tax_Type, Trade_Name, Trade_No, Trade_Note, Transport_Name, Transport_No, Transport_Note, Type_Name, Type_No, Type_Note, Virtue_ID, \r\n, acct_Name, bool, cname, cr_date, cusType, cus_no, emp_nam, emp_no, fc_rate, null, short_no, strSql, strSqlS, strWhere, string, string>, top, user_id, user_names, user_no, user_nos, wordb_Name, wordb_name, wordb_no, {0}, {0}Name, {1}, {2}
```

---

## SKY.NetFrameWork.BLL.Web.SYS.FinanceBasicInfo

- BLL文件数: 11
- 业务方法数: 60
- 引用的表数: 33
- 字段总数: 111

涉及表:
```
$APS_InitA
$APS_InitB
$APS_ReceiptB
$ARS_InitA
$ARS_InitB
$ARS_ReceiptB
$GLS_InitA
$GLS_InitB
$GLS_VocA
$GLS_VocB
$GLS_VotB
$SDS_ReManageB
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_AcctNorm
$SYS_Ann
$SYS_AssignRateA
$SYS_AssignRateB
$SYS_Bank
$SYS_Cash_Set
$SYS_CuryA_Org
$SYS_CuryForRate_view
$SYS_Curya
$SYS_Curyb
$SYS_DealCost
$SYS_InvCatl
$SYS_Item
$SYS_MsUnit
$SYS_Option
$SYS_ParCatB
$SYS_ParCatC
$sys_item
```

业务方法:
```
Add
AddAcct
BillStop_Proc
CheckCodeValueByZone
CheckExistsCode
CheckExistsNo
CheckRepeatForCode
DelAcct
DelOrModCondition
Delete
DeleteAllAcct
DeleteByID
ExistAs
Exists
GetAcctByCode
GetAcctByParentNo
GetAcctNormByParentNo
GetAllList
GetChildAccts
GetCurybByKey
GetDataByID
GetGLDay
GetListData
GetLocalCury
GetNameByID
GetSYS_ParCatB
GetSYS_ParCatC
GetSingleAcctData
GetSingleDataForTree
ImportNormalData
InitExistAcct
IsCanDelete
IsCanEditByCode
IsExisted
IsExistsPro_no
IsImported
IsUsedAcct_ID
RefByGLSPrt
SeekGetByOrg
UpdateAcct
addOrUpdateData
delAssignRateA
getAcct
getAcctByCode
getAcctByCodeExcel
getAcctById
getAllSeek
getAssignRateA
getAssignRateB
getDeepDeptNo
getDefaultCuryAndBillRateByOrg
getDeptNo
getEAllSeek
getSeek
getSeekAcctNo
getSigleRecord
saveAssignRateA
updateAssignRateA
updateAssignRateB
validateAcctNo
```

字段清单:
```
"", "0", "1", 0\r\n, 111, 121, 14846, 14847, 1\r\n, 23, AcctDept_IF, Acct_DC, Acct_ENam, Acct_ID, Acct_Nam, Acct_Name, Acct_Name\r\n, Acct_No, Adj_Date, Adjust_IF, AnnType_ID, Ann_Name, Ann_No, Ann_Note, Ann_Type, Bank_Account, Bank_Addr, Bank_Contact1, Bank_Fax1, Bank_Fax2, Bank_ID, Bank_Name, Bank_No, Bank_Tel1, Bank_Tel2, Bill_Rate, Bill_Rate", CName, Cash_IF, Code, Credit_IF, CuryCase_ID, Cury_Case, Cury_ID, Cury_Name, Cury_Name\r\n, Cury_No, Cury_Note, DC_ID, DeptCD, DeptID, DeptId, Direction, FC_Amt, GdInB_ID, ID, InCode, InID, InName, Inv_IF, LC_Amt, Offset_IF, OragCD, OragID, Parameters, Parent_No, Pro_name\r\n, Rank_IF, Rate_Note, Rate_Year, Remark, SELECT, SaveType_ID, Save_Type, Size, SqlDbType, Start_Date, Stop_Date, User_Code, User_ID, User_code, Value, \r\n, acct_ID, acct_id, acct_no, acct_sht, assist_CD, assist_ID, bank_no, business_IF, distinct, findid, id, item_no, line_no, multi_dept, multi_firm, multi_staff, new, no, p_unit, quanamt_IF, single_CD, single_ID, single_cd, string, top, ver_type, zone_ID, {0}
```

---

## SKY.NetFrameWork.BLL.Web.SYS.GoodsBasicInfo

- BLL文件数: 20
- 业务方法数: 141
- 引用的表数: 59
- 字段总数: 233

涉及表:
```
$BOM_WStation
$MMS_PartA
$MMS_PartB
$MMS_WareA
$MOT_CatSet
$POS_Pricing
$QC_Item
$SKY_FieldExtenProperties
$SKY_FunctionProperties
$SKY_Functions
$SKY_Orangise
$SKY_Users
$SYS_Acct
$SYS_CManagA
$SYS_CManagB
$SYS_CManagC
$SYS_ConfigA
$SYS_ConfigA_Orangise
$SYS_ConfigB
$SYS_Curya
$SYS_CusA
$SYS_CusCode
$SYS_Feature
$SYS_GoodInA
$SYS_GoodInA_Find
$SYS_GoodInA_Users
$SYS_GoodInA_temp
$SYS_GoodInA_tempT
$SYS_GoodInB
$SYS_GoodInC
$SYS_GoodInD
$SYS_GoodInF
$SYS_GoodInF_Wst
$SYS_GoodInG
$SYS_InvCatl
$SYS_InvCatlB
$SYS_InvCatlC
$SYS_InvCodA
$SYS_InvCodA_Funcs
$SYS_InvCodB
$SYS_InvCodC
$SYS_Item
$SYS_MsUnit
$SYS_PackInf
$SYS_ParCatB
$SYS_ParCatC
$SYS_SMater
$SYS_SMaterB
$SYS_SpTypeA
$SYS_Trans_End_Day
$SYS_UpLoadDat
$SYS_WhouseA
$SYS_WhouseB
$v_SYS_GoodInA
$v_SYS_Trans_End_GD
$v_SYS_Trans_End_M
$v_SYS_Trans_End_NoltNo
$v_SYS_Trans_End_Normalnosp
$v_SYS_Trans_End_sp
```

业务方法:
```
Add
AddDraftsFromBill
AddInvCatl
AvailStockCheckProc
BeforeDelete
BeforeSaveCheck
CheckBillBeforeDel
CheckCodeExist
CheckError
CheckGoodsInC
CheckGoodsInD
CheckNameStand
ChkUsedIfByStock
CodeHaveExisted
DateExists
DelOrModCondition
Delete
DeleteByID
DeleteByOrangiseID
DeleteGoodInC
DeleteInvCatl
DraftsToNormal
ExecCUDTran
ExistOfGd_No
Exists
GdHasStock
GetAllList
GetCatybyCon
GetColor
GetColorGroup
GetDataByID
GetGStandbyCon
GetGoodInCByGoodsID
GetGoodInCByOInvNo
GetGoodInDByGoodsID
GetGoodPreLevelCode
GetGoodsByCusID
GetGoodsByWHID
GetGoodsForPosRepoA
GetGoodsOutByWhere
GetGoodsOutByWhereSDS
GetGoodsOutByWhereSP
GetGoodsOutByWhereSPP
GetGoodsRelatedList
GetIDByCode
GetIDByNo
GetInCode
GetInvBigCatl
GetInvCatl
GetListData
GetMultiGd_no
GetOGStand
GetPagingUnit
GetParent_no
GetPrice
GetSpTypeBByKey
GetWhSpByOrgID
InvAHaveChild
InvBHaveChild
IsExistsForPartB
IsInvCatlRefed
MMPartIf
NameHaveExisted
PrCodeif_Exist
ReSetLevelCodeProc
ReferenceBom_Boma
SeekBig
SeekInvCd
UpdateData
UpdateInvCatl
UpdateInvCodB
addGoodInA
addGoodInB
addInvCodeA
addInvCodeC
addOrUpdateData
addOrUpdateMsUnitData
addOrUpdatePackInfData
addUpLoadDat
batchABCPro
batchABCPro_wh
batchGoods
beforedeleteMsUnit
beforedeletePackInf
checkGrpQuote
checkGrpRepeat
checkMsUnitData
checkPackInfData
clearTempData
creatGdCode
delGoodInA
delGoodInB
delInvCodADat
delInvCodBDat
delInvCodCDat
delUpLoadDat
deleteMsUnitData
deletePackInfData
deleteSingleInvCatl
editGoodInA
editGoodInB
editInvCodeA
existsUpLoadDataByFile
getAllInvCodC
getBsUnit
getCAttrb
getCreattGoodIn
getCusCode
getCusCodeByCode
getEnableDat
getGdType
getGd_No_Price
getGoodInA
getGoodInAByID
getGoodInB
getGoodsByID
getGoodsByName
getGoodsField
getGoodsbyCode
getGroupType
getInvCManagA
getInvCatl
getInvCodeAAll
getInvCodeAByID
getInvCodeBAll
getInvWhouseA
getInvWhouseB
getMsUnitAll
getPackByName
getPackInfAll
getSigleRecord
getSingleInvCatl
getSpType
getVlType
getusable
isDuplicate
isEnableCode
tempForPersistence
updataInvCodC
valiGdCode
valiGdType
```

字段清单:
```
"", "$SYS_GoodInA", "0", "reset_lv_date", "reset_lv_user_id", $SYS_GoodInA, $v_SYS_GoodInA, *\r\n, -1, -2, -3, 101, 1800, 1\r\n, 3600, ABCPro, ABCPro_ID, Acct_ID, Acct_No, AdDate, BondGS, BondWH, Bond_SP_ID, Bond_SP_No, Bond_WH_ID, Bond_WH_No, BoxDes, BoxNum, BsUnit, BsUnit_ID, CADDra, CAttID, CAttrb, CMCode, CMGrp, CMGrp", CMGrp_ID, CMName, CMName\r\n, CManID, CManag, CManagA_ID, CName, CName\r\n, C_Price, C_Value, Cat_Name, ChPers, CnRate, Code, ConBat, ConSer, CostAcct_ID, CostAcct_No, CrDate, CrPers, CuCode, Curren, Cury_No, CusCode, Cus_Name, Cus_No, CustNo, DBName, EDraNo, EOQuan, EfDate, EmitAcct_ID, EmitAcct_No, EnDate, EnName, EnbSet, ExRate, FMater, FMater_em, FtCode, GAbbre, GBatch, GCType, GCUnit, GColor, GCycle, GSpace, GStand, GWidth, GdArea, GdBase, GdCode, GdMSDS, GdName, GdType, GdUnit, GodAID, GooNum, Grpart, HMater, Height, Htreat, ID, ID\r\n, InAcct_ID, InAcct_No, InCod1, InCod2, InCode, InCode2, InName, InName1, InName2, InUpID, InvAID, IsBond, IsCode, ItemFd, IvDate, Length, LnDoc1, LnDoc2, MaterialAcct_No, MinSal, MsUnit, MxLeng, Nreple, OIName, OIName\r\n, OInvNo, OragID, Org_ID, PICode, PIName, PaCode, PrCode, ReDate, Remark, ResDay, Reserv, RetAcct_ID, RetAcct_No, RetCostAcct_ID, RetCostAcct_No, Rorder, SELECT, SMater, SMater_ID, SMater_name, SModel, SP_ID, SP_No, SPrice, SRatio, S_SWeight, SdCost, Separt, SerNum, SetVal\r\n, SfQuan, SpName, SpType, SpTypeA_ID, SpTypeA_NO, SpTypeA_Name, Sp_ID, SpacNo, StandP, StockAcct_ID, StockAcct_No, StorageAcct_ID, StorageAcct_No, TPTRep, UCurre, UPrice, VlType, Volume, WHCode, WHName, WH_ID, WH_No, WIPWho, Weight, Whouse, \r\n, args, brand, cName, case, cattrName, cname, code, cury_id, cus_id, dbo.SKY_Orangise, distinct, fldfrm, gdID, gd_ID, gd_id, gdcode";, gdid, good_type, good_type_id, id, incode, item_name, listC, master, new, new, note, null, oragid, org00_id, orgID, org_id, p_fc_low_price, p_price, pacode, parent_id, plm_dir_id, plm_dir_name, po_type, s_fc_low_price, s_price, stop_date, stop_user_no, strUpdSet, strWhere, string, timestamp, top, ware_name, wst_name, {0}, {1}
```

---

## SKY.NetFrameWork.BLL.Web.WF

- BLL文件数: 24
- 业务方法数: 104
- 引用的表数: 27
- 字段总数: 97

涉及表:
```
$OA_WordB
$SKY_FunctionReportModel
$SKY_Functions
$SKY_Orangise
$SKY_Users
$SYS_BillCategory
$SYS_GoodInA
$SYS_ParCatC
$SYS_SMater
$SYS_UpLoadDat
$WF_FlowChart
$WF_SignA
$WF_SignA_History
$WF_SignB
$WF_SignB_History
$WF_SignB_repeat
$WF_SignHand
$WF_SmartMesA
$WF_SmartMesB
$WF_SmartMesB_User
$WF_WorkFlwa
$WF_WorkFlwa_CC
$WF_WorkFlwa_Cate
$WF_WorkFlwa_Dept
$WF_WorkFlwa_User
$WF_WorkFlwb
$WF_WorkFlwb_User
```

业务方法:
```
AddNewBillToBillStateChange
ClearFlowChart
ClearNotifyWays
DelFlowChartById
DelWFUploadIcon
DeleteBase
DeleteByID
DeleteTempData
DispUserM
DoSign
DuplicateAllUser
DuplicateUser
Enable
GetAccess_Token
GetAgentByBillId
GetAgentByID
GetAgentFlow
GetAgentHistory
GetAgentHistoryByID
GetAgentHistoryList
GetAgentOtherUser
GetAllAgent
GetAllAgentCount
GetAllAgentCountByFunction
GetAllList
GetAllOrgAgentCountByFunction
GetAllOrgCCCountByFunction
GetAllWarningCount
GetAllWarningListData
GetAllWarningListWithCnt
GetCCToMe
GetCurrentFlowBidByBillId
GetCurrentFlowModeBidByBillId
GetDataByID
GetDtableDate
GetFlowChartById
GetFlowIdByBillId
GetListData
GetMsgBySignResult
GetMyInitiation
GetNotifyUsersByFuncAndState
GetPagingDatas
GetReportMenu
GetSignDetailByBillID
GetWFUploadIcons
GetWorkFlowUserM
ImportFlowChart
InsertBase
InsertData
IsAgree
IsExistFuncMsgSetting
MailEnableSSL
MailHost
MsgContent
Name
NotifyMsgByFuncAndState
NotifyUser
Plugin
PushHuaWei
PushJiGuang
PushToUsers
ReciverId
RequestToUser
ResetFlowChart
SearchDataProc
SendTemplateMessage
SenderAccount
SenderCode
SenderId
SenderName
SenderPassword
SetAsRead
SetRegIDToUser
SetReportMenu
SignOpinion
SignbId
TrgSqlValidation
TurnStateName
UpdateBase
UpdateData
UpdateWorkFLowB
alert
content
content_type
dataId
dataTitle
funcId
funcName
getSigleRecord
loadWarningDetail
markAsRead
msg_content
page
platform
pushTitle
readIf
receiver
receiverId
relayIf
replyIf
sender
senderId
title
userSex
```

字段清单:
```
$"select, CName, Dept_ID, Dept_No, Diameter, Fun_ID, GStand, GWidth, GdArea, GdName, Height, ID, JObject, MenuCode, Mode_ID, Org_ID, Org_No, Result_If, SMater, SMater_name, Sex, SqlValue, State_ID, Step_ID, Table_Name, URL, User_ID, User_No, Volume, Wordb_ID, [timestamp], [user_id], \r\n, \r\n\t, _cnt, bill_ID, bill_no, bill_note, bill_summary, cname, code, cr_date, cr_user_ID, custom_if, depts, field_cond, filter, flow_chart, flow_name, fun_id, fun_name, gridPaging, id, imgData\r\n, isUserHide, last_date, line_no, md_date, menuFunid, mode_no, new, new, null, op_date, op_user_id, op_user_id\r\n, opinion, paname, phone, reportFunid, result_if, roles, sex, sfname, sign_info, signb_id, signlevel, sms_if, state, string, top, topic_msg, tr_Signal, tr_Signal\r\n, tr_cond, tr_cond1, tr_cond_json, url, use_if, userId, user_name, user_sex, userids, users, wordb_name, wordb_name\r\n, {0}
```

---

## SKY.NetFrameWork.BLL.Web.WF.Notify

- BLL文件数: 3
- 业务方法数: 2
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
ClearCache
Send
```

---

## SKY.NetFrameWork.BLL.Web.WFS

- BLL文件数: 2
- 业务方法数: 11
- 引用的表数: 0
- 字段总数: 0

业务方法:
```
Approve
BeforeDeleteFormData
CanEditData
DeleteByID
DeleteFormData
GetCommentsStr
GetDataByID
GetFormIdByFunId
GetFormTableByFormId
GetFormTableByFunId
GetListData
```

---

## SKY.NetFrameWork.BLL.Web.WHS

- BLL文件数: 23
- 业务方法数: 107
- 引用的表数: 56
- 字段总数: 249

涉及表:
```
$BOM_MkCMachine
$BOM_MkCent
$GLS_VocA
$HR_Emp
$OA_WordB
$SKY_Functions
$SKY_Orangise
$SKY_Users
$SYS_BillCategory
$SYS_CManagA
$SYS_Curya
$SYS_CusA
$SYS_CusCode
$SYS_Feature
$SYS_GoodInA
$SYS_GoodInB
$SYS_InvCatl
$SYS_InvNoA
$SYS_Option
$SYS_ParCatB
$SYS_ParCatC
$SYS_SMater
$SYS_SpTypeA
$SYS_Trans_End
$SYS_WhouseA
$SYS_WhouseB
$WHS_AdjA
$WHS_AdjA_back
$WHS_AdjB
$WHS_DiffDetail_temp
$WHS_GdsAreaStockRpt_temp
$WHS_GdsStockReport_temp
$WHS_InitA
$WHS_InitB
$WHS_InvoicingMon_temp
$WHS_MoveA
$WHS_MoveA_back
$WHS_MoveB
$sys_avail_billlook
$sys_stock_end
$v_SYS_Trans_End_GD
$v_SYS_Trans_End_nosp
$whs_BorrA
$whs_BorrA_back
$whs_BorrB
$whs_BorrB_back
$whs_RetuA
$whs_RetuA_back
$whs_RetuB
$whs_ScrapA
$whs_ScrapA_back
$whs_couA
$whs_couB
$whs_couB_temp
$whs_monthA
$whs_monthB
```

业务方法:
```
ABnormalUpdatePrice
Archived
BarCodeDetailisCheck
BeforeCheckPost
Borr
CanArchived
CancelUpdateStock
CheckA
CheckAvalStockQuan
CheckBeforeDelete
CheckBillBeforeDel
CheckBillState
CheckGoodsStockValue
CheckPirce
CheckStock
CheckStockWithLT
ClearMark
ClearTempData
CreatePro_no
DelOrModAllCondition
Delete
DeleteBID
DeleteBarCode_Set
DeleteByID
DeleteData
DeleteTempData
Exists
ExistsCou
ExistsCoubGoods
GetABnormalCheckData
GetAdjB
GetAll
GetBarCode_Set
GetBillNewData
GetBookQuan
GetBorrADate
GetDataByID
GetDefaultCategory
GetExcelABnormalCheckData
GetIDByOpMonth
GetLastOpmonth
GetListData
GetListDataLot_quan
GetListDataRelation
GetListDataRelation_quan
GetLt_no
GetMaxWhsMonthA
GetMoveB
GetPageDataList
GetPro_name
GetSPrice
GetSeekWhere
GetSingle
GetStateIDCode
GetSubPagedData
GetTransUsedByTempTable
GetWhousePrity
GetWordSpotByCategory
GoodInAExists
InitA
InsertCouB
InsertInitB
IntoTableFromData
IsCostAdjForEnd
IsCouBillAllPost
IsDoubleData
IsFromIDOver
IsMonthUsed
LoadGoods
Move
OpenBarCode_Set
OpenBarCode_SetNew
PrintData
RetuAByborrB
RetuByborr_No
RunScheduleProc
SaveBarCodeWhere
SaveBarCode_Set
SaveData
Scrap
SearchData
SearchDataInf
SelectAll
Settle
SettleAll
SettleSingle
StepLock
SyncData
UnSettle
UpdateBarcodeSet
UpdateExists
UpdateStock
getAllCoubList
getAllInitbList
getAllmonthbList
getLastRecord
getOldP_quan
getRecordBycoumonth
getSigleRecord
getcoumonth
sys_transDate
unArchived
unBorr
unCheckA
unInitA
unMove
unScrap
```

字段清单:
```
"", "0", "3", "cost_ctrl_wh", "op_month", "state", "库存结转出现错误。结转年月：{0};, -1, 0m, 10, 10800, 112, 121, 17306, 20, 200, 3600, ABCPro_Name, Adj_Cause, Billa_ID, BorrAId, Borrb_ID, BsUnit, CMCode, CMName, CMngA_ID, CMngA_No, CName, Category, Category_ID, Cl_user_ID, Code, ConBat, ConBat\r\n, CuCode, Cury_ID, Cury_Name, Cury_No, Cus_Name, DateTime, Direction, EDraNo, EnName, FromType_ID, FromType_No, FtCode, Ft_ID, Ft_No, GAbbre, GStand, GdCode, GdInA_ID, GdInA_No, GdInB_ID, GdName, Gd_ID, Gd_No, GooNum, GoodInA_No, HMater, Htreat, ID, IN_Quan-a.OU_Quan, InCod1, InCod2, InCode, InCode1, InCode2, InName, InName2, LT_NO, Mk_ID, Mk_No, NetWeight, OragCD, OragID, Org_ID, PagingParams, Parameters, ROHS, Remark, SELECT, SMater, SMater_ID, SMater_name, SModel, S_book_quan, S_cou_quan, S_quan, S_weight, Size, SpName, SpName\r\n, SpTypeA_ID, SpTypeA_No, Sp_ID, Sp_No, SpacNo, SqlDbType, State_ID, Value, VarChar, WG_Weight, WHCode, WHName, WHName", WH_ID, WH_No, WIPWho, Weight, Wh_ID, Wh_No, [timestamp], \r\n, \r\n\t, _prt_times, _prt_user_id, _prt_user_no, _submit, _submit\r\n, ac_date, ac_user_id, ac_user_no, adja_ID, arsb_ID, bId, balweight, billID, bill_ID, bill_no, bill_type, bool, borra_ID, cName, ca_date, ca_user_id, ca_user_no, cl_date, cname, code, code_beg, code_end, cost_mon, cou_ID, cou_date, cou_month, cou_no, coua_ID, coub_id, coub_no, cr_date, cr_user_id, cury_ID, cury_name, cury_no, deptCD, emp_nam, emp_no, fc_amt, fc_rate, fieldname1, from_no, frost, frost_id, ft_id, fun_id, gd_ID, i_Ft_ID, i_Ft_No, i_OragCD, i_OragID, i_Sp_ID, i_Sp_No, i_WH_ID, i_WH_No, i_deptCD, in_em, in_em\r\n, in_fee, in_man, in_mat, lc_amt, line_no, lt_no, lt_note, master, mk_name, month, move_if, moveif_ID, new, new, note, now_times, o_Ft_ID, o_Ft_No, o_OragCD, o_OragID, o_Sp_ID, o_Sp_No, o_WH_ID, o_WH_No, o_deptCD, o_deptID, opMonth, op_date, op_if, opif_ID, orgID, out, p_book_quan, p_cou_quan, p_ist_quan, p_ost_quan, p_price, p_quan, p_unit, p_weight, parameters1, parameters2, prod_date, quan_no, reason_id, rohs, s_ist_quan, s_ost_quan, s_price, s_quan, s_retu_quan, s_weight, scpa_ID, sob_price, state, state_ID, strID, string, timestamp, top, trans, unit_rate, user_id, user_no, voc_no, wh_ID, whname, wordb_name, {0}, {1}, {2}
```

---

## SKY.NetFrameWork.BLL.WF

- BLL文件数: 18
- 业务方法数: 106
- 引用的表数: 30
- 字段总数: 79

涉及表:
```
$SKY_FieldExtenProperties
$SKY_Functions
$SKY_FunctionsParameter
$SKY_Message
$SKY_Orangise
$SKY_UserFieldRelation
$SKY_Users
$SYS_InvNoA
$SYS_InvNoB
$Sky_Style
$V_SYS_Param
$WF_ConditionMsg
$WF_FlowRose
$WF_FlowSetpForm
$WF_FlowSvg
$WF_FormClass
$WF_FormInfo
$WF_SetpRose
$WF_StartChildFlow
$WF_UserFlowRole
$WF_Verify
$WF_VerifyAttach
$WF_WorkFlowClass
$WF_WorkFlowCondition
$WF_WorkFlowLogs
$WF_WorkFlowModel
$WF_WorkFlowRun
$WF_WorkFlowSetp
$WF_WorkItem
$WF_WorkProxy
```

业务方法:
```
Approve
CondKey
FlowName
GenerateCode
NSetpID
NextState
RunID
StepID
StepState
addAttachment
addFlowForm
addFlowModel
addFlowRole
addFormClass
addStepSendMsg
addStepStepCondition
addWFStepForm
addWorkFlowModel
buildWorkFlowRelation
checkFunModelExist
checkStepRight
clacelProxy
creatStyle
delFlowCnod
delFlowData
delFlowModelByID
delFolwClassByID
delFolwFormByID
delFolwRoleByID
delFolwStep
deleteCond
deleteFile
deleteFormDate
doFieldRight
doFunctionRight
downloadFile
editStepSendMsg
editStepStepCondition
edtiFlowModel
enforceDelModel
expFunData
expWorkFlowModel
getAttachment
getChildFlFlow
getCodeCount
getCurUserWork
getCustomSend
getDeptCheckFlow
getDeptWorkFlow
getDoenFlowBox
getFlowForm
getFlowFormByID
getFlowModelClass
getFlowModelClassByID
getFlowModelInfo
getFlowModelMsg
getFlowModelName
getFlowModelOrg
getFlowRole
getFlowRoleByID
getFlowRunBox
getFlowStemInfo
getFolwClassByID
getFormClass
getFormProp
getFunForm
getFunFormInfo
getModelXml
getNewFlowBoxInfo
getNextStepUser
getNoticeUser
getPageWidget
getParamsTabName
getPrevStep
getProxInfo
getProxyWork
getQuote
getReceiveUser
getRoleType
getSetpFormInfo
getStepCondition
getStepMsg
getStepRole
getStepSendMsg
getStepType
getWFStepForm
getWorkFlowBoxInfo
getWorkFlowForm
getWorkFlowModel
getWorkFowModelById
havUnAudit
initCustomField
messageNotification
resetFieldLable
resetStyle
saveCustomFieldStyle
startWorkFlow
testCondition
testExpression
updataFlowForm
updataFlowModel
updataFlowRole
updataStepRole
updateFlowModel
validateModel
writeSqlToFile
```

字段清单:
```
111, 121, CName, Cancel, Code, ConditionName, CreateDate, DISTINCT, Direct, DstUserID, Expression, FlowModelID, FlowRoseName, FlowRunState, FlowSetpID, FormClassName, FormID, FormName, FormShowName, FormState, FormURL, FunID, ID, IsFormShowName, Item_Field, ModelCoding, ModelName, ModelState, NextSetpID, NoticeID, OragCD, OragID, ParamValue, PrevSetpID, ProStepID, SELECT, SetpID, SetpMode, SetpName, SetpPurview, SetpType, SortNumber, SrcUserID, URL, UserID, VerifyContent, VerifyDate, WorkFlowClassName, WorkFlowModelID, WorkFlowName, [CreateDate], [FunId], [ID], [ModelCoding], [ModelName], [ModelState], \r\n, \r\n\t, billNo, billNo\r\n, case, distinct, fieldName, id, language, msgId, msgReceive, msgTemplet, stepID, stepId, stepid, svgXml, tableName, top, url, widStyle, widgetID, {0}, {1}
```

---

## SKY.NetFrameWork.Web.OA_CRM

- BLL文件数: 1
- 业务方法数: 12
- 引用的表数: 21
- 字段总数: 31

涉及表:
```
$OA_CRM_DetectionA
$OA_CRM_ShareCusA
$OA_CRM_ShareCusB
$OA_CRM_ShareCusC
$OA_CRM_ShareCusD
$OA_CRM_ShareCusE
$OA_CRM_ShareCusF
$OA_CRM_ShareCusG
$OA_CRM_ShareCusH
$OA_CRM_ShareCusI
$OA_WordB
$SKY_Orangise
$SKY_Users
$SYS_GoodInA
$SYS_GoodInA_Find
$SYS_GoodInA_Users
$SYS_ParCatC
$SYS_Region
$SYS_Sales
$SYS_TradeInfo
$SYS_UpLoadDat
```

业务方法:
```
CheckBodyNo
DelData
DeleteByID
GetAllData
GetCRM_CusB
GetCRM_CusC
GetCRM_CusD
GetDataByID
GetListData
GetMsgData
GetSingleData
getCodeCount
```

字段清单:
```
1\r\n, CName, Cont_Fax, Cont_Mail, Cont_QQ, Cont_Tal, CreditIf_ID, Credit_If, Cus_Addr, Cus_Http, Cus_No, Cus_Post, DegreeIf_ID, Degree_If\r\n, GdInA_No, IFName, IFName\r\n, RelaFd\r\n, RelationIf_ID, Relation_If, SFName, Share_ID, StageIf_ID, Stage_If, User_ID\r\n, \r\n, body_no, cname, line_no, wordb_name, {0}
```

---


## 统计汇总

- 模块总数: 50
- 字段总数: 7410
- 覆盖: 100% BLL源码
