from pathlib import Path
import json
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[2]
# 手册的适用版本就是仓库的发布身份：版本号从 package.json 读取，不另抄一份。
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
OUT = ROOT / 'docs' / 'operations' / f'Modern-ERP-用户测试手册-DRAFT-v{VERSION}.docx'
NAVY = '17324D'; BLUE = '246B8E'; PALE = 'EAF2F7'; GRAY = '52606D'; LIGHT = 'D8E2EA'; WHITE = 'FFFFFF'

def shade(cell, fill):
    props = cell._tc.get_or_add_tcPr(); element = OxmlElement('w:shd'); element.set(qn('w:fill'), fill); props.append(element)

def border_table(table):
    props = table._tbl.tblPr; borders = OxmlElement('w:tblBorders')
    for edge in ('top','left','bottom','right','insideH','insideV'):
        node = OxmlElement(f'w:{edge}'); node.set(qn('w:val'),'single'); node.set(qn('w:sz'),'4'); node.set(qn('w:color'),LIGHT); borders.append(node)
    props.append(borders)

def add_table(doc, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers)); table.alignment = WD_TABLE_ALIGNMENT.CENTER; table.autofit = False
    for i, text in enumerate(headers):
        cell = table.rows[0].cells[i]; cell.text = text; shade(cell, NAVY); cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        for run in cell.paragraphs[0].runs: run.font.color.rgb = RGBColor(255,255,255); run.font.bold = True
    for r_index, row in enumerate(rows):
        cells = table.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = str(text); cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if r_index % 2: shade(cells[i], 'F6F8FA')
    if widths:
        for row in table.rows:
            for i, width in enumerate(widths): row.cells[i].width = Cm(width)
    border_table(table); doc.add_paragraph(); return table

def bullet(doc, text, level=0):
    p = doc.add_paragraph(style='List Bullet' if level == 0 else 'List Bullet 2'); p.add_run(text); return p

def step(doc, text):
    p = doc.add_paragraph(style='List Number'); p.add_run(text); return p

def note(doc, title, text):
    table = doc.add_table(rows=1, cols=1); table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0,0); shade(cell, PALE); p = cell.paragraphs[0]; r=p.add_run(f'{title}  '); r.bold=True; r.font.color.rgb=RGBColor(23,50,77); p.add_run(text)
    border_table(table); doc.add_paragraph()

doc = Document(); sec = doc.sections[0]
sec.page_width=Inches(8.5); sec.page_height=Inches(11); sec.top_margin=Inches(.72); sec.bottom_margin=Inches(.68); sec.left_margin=Inches(.78); sec.right_margin=Inches(.72)
styles=doc.styles
styles['Normal'].font.name='Microsoft YaHei'; styles['Normal']._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft YaHei'); styles['Normal'].font.size=Pt(9.5); styles['Normal'].font.color.rgb=RGBColor(45,55,65)
for name,size,color in [('Title',30,NAVY),('Heading 1',19,NAVY),('Heading 2',13,BLUE),('Heading 3',10.5,NAVY)]:
    s=styles[name]; s.font.name='Microsoft YaHei'; s._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft YaHei'); s.font.size=Pt(size); s.font.color.rgb=RGBColor.from_string(color); s.font.bold=True
styles['Heading 1'].paragraph_format.space_before=Pt(14); styles['Heading 1'].paragraph_format.space_after=Pt(8)
styles['Heading 2'].paragraph_format.space_before=Pt(10); styles['Heading 2'].paragraph_format.space_after=Pt(5)

# Header/footer
header=sec.header.paragraphs[0]; header.text='MODERN ERP  ·  用户测试手册'; header.alignment=WD_ALIGN_PARAGRAPH.RIGHT
for run in header.runs: run.font.size=Pt(8); run.font.color.rgb=RGBColor.from_string(GRAY)
footer=sec.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
footer.add_run('DRAFT · 仅用于客户测试    |    ')
field=OxmlElement('w:fldSimple'); field.set(qn('w:instr'),'PAGE'); footer._p.append(field)

# Cover
p=doc.add_paragraph(); p.paragraph_format.space_before=Pt(70); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
r=p.add_run('MODERN ERP'); r.bold=True; r.font.size=Pt(15); r.font.color.rgb=RGBColor.from_string(BLUE)
p=doc.add_paragraph(style='Title'); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.add_run('用户测试手册')
p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; r=p.add_run('腾讯云客户测试环境 · MySQL 8'); r.font.size=Pt(14); r.font.color.rgb=RGBColor.from_string(GRAY)
p=doc.add_paragraph(); p.paragraph_format.space_before=Pt(24); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
r=p.add_run('DRAFT'); r.bold=True; r.font.size=Pt(18); r.font.color.rgb=RGBColor(180,68,50)
add_table(doc,['项目','内容'],[
    ('适用版本',f'v{VERSION}'),('文档状态','DRAFT（待客户测试反馈后修订）'),('Owner','Platform / 项目交付负责人'),('发布日期','2026-11-18'),('网址与账号','由项目管理员通过安全渠道另行提供')],[4.2,10.8])
note(doc,'保密提示','本手册不包含密码、Token、数据库连接串或客户敏感数据。请勿在缺陷截图中暴露真实个人信息、密钥或生产数据。')
doc.add_page_break()

doc.add_heading('目录与使用方式', level=1)
add_table(doc,['章节','适合谁','目标'],[
('1. 测试前准备','所有测试人员','确认环境、账号、浏览器与安全要求'),('2. 快速上手','首次使用者','10 分钟内完成登录、导航和退出'),('3. 角色与权限','业务负责人/管理员','理解“看不到、不能点”通常是权限边界'),('4. 核心业务测试','各业务岗位','按推荐顺序完成端到端测试'),('5. 信用管理专题','销售/信用管理岗位','使用中文业务选择器和元金额完成信用流程'),('6. 移动端测试','手机/窄屏使用者','验证 390px 主基线与关键任务'),('7. 问题反馈','所有测试人员','提交可复现、可定位的反馈'),('8. 附录','负责人','测试清单、术语与支持边界')],[3.8,4.5,7.0])
note(doc,'建议','第一次测试请先阅读第 1–3 章，再按岗位选择第 4 章流程。不要从高级配置页面开始探索。')

doc.add_heading('1. 测试前准备', level=1)
doc.add_heading('1.1 环境确认', level=2)
add_table(doc,['检查项','要求','结果'],[
('环境','腾讯云客户测试环境；数据库为 MySQL 8','□'),('访问地址','使用管理员单独发送的 HTTPS 地址','□'),('浏览器','最新版 Chrome / Edge；允许本站 Cookie','□'),('账号','使用个人测试账号，不共享账号','□'),('数据','只录入脱敏测试数据','□'),('窗口','桌面建议 ≥ 1280px；移动端按第 6 章','□')],[3.5,9.5,1.2])
doc.add_heading('1.2 安全与数据边界', level=2)
for t in ['不要上传身份证、银行卡、真实合同或包含商业秘密的附件。','不要在备注、截图或问题反馈中填写密码、Token、数据库地址或连接串。','测试环境用于业务验证，不要将其当作正式生产系统。','任何清库、备份恢复、迁移、数据库脚本或部署操作必须由项目管理员执行。']: bullet(doc,t)

doc.add_heading('2. 十分钟快速上手', level=1)
doc.add_heading('2.1 登录与退出', level=2)
for t in ['打开管理员提供的 HTTPS 地址。','输入个人测试账号与密码并登录。','登录后先确认右上角显示的账号身份。','测试结束后使用系统的“退出登录”，不要只关闭浏览器标签页。']: step(doc,t)
note(doc,'无法登录？','先确认网址、网络和账号输入；连续失败不要反复尝试或共享密码，请把时间、浏览器和错误提示发给管理员。')
doc.add_heading('2.2 认识页面', level=2)
add_table(doc,['区域','作用','使用提示'],[
('应用列表/导航','按九大业务域打开功能','只显示当前账号有权访问的应用'),('页面使用提示','说明本页所属业务域、用途和常见上游','首次进入先读这一行'),('页面标题与说明','说明当前任务','历史 Wave/阶段注释已从用户工作面移除'),('主操作区','新增、提交、审批、确认或查询','优先完成主操作，不要随意改高级配置'),('状态/提示','显示成功、预警、阻断或错误','记录完整提示再反馈')],[3.2,6.2,5.4])
doc.add_heading('2.3 返回、刷新与直接链接', level=2)
for t in ['可使用浏览器 Back / Forward 返回前后页面。','可刷新当前页面；系统应保持在同一路由。','复制链接给同事前确认对方具有相同权限；无权访问时系统会拒绝，而不是自动扩大权限。']: bullet(doc,t)

doc.add_heading('3. 角色与权限', level=1)
add_table(doc,['角色示例','常用范围','常见限制'],[
('销售/客户人员','客户、报价、订单、出货、退货、信用查询','不能维护系统权限或执行无授权审批'),('计划人员','预测、MRP、计划订单、计划员工作台','不能替代采购/生产确认'),('采购人员','供应商、请购、采购订单、收货、委外','不能操作销售或会计凭证'),('仓库人员','库存作业、异动、批次序列、报废、月结','高风险确认受权限与状态限制'),('生产/质量人员','制令、领料、入库、扫码、IQC/OQC','不能跳过检验或库存事实'),('财务/会计人员','应收应付、收付款、发票、凭证、报表','过账、反冲、期间操作受严格控制'),('系统管理员','用户权限、组织、编号、流程、SOD','不应代替业务岗位完成日常交易')],[3.3,6.0,5.7])
note(doc,'权限原则','页面隐藏不等于授权；所有关键权限由后端再次校验。若菜单缺失或按钮不可用，请先确认岗位与权限，而不是要求共享管理员账号。')

doc.add_heading('4. 核心业务测试', level=1)
doc.add_heading('4.1 推荐顺序', level=2)
add_table(doc,['顺序','业务域','建议先测'],[
('1','Master & Engineering','货品、BOM、工艺路线等基础资料'),('2','Sales & Customer','客户 → 报价/订单 → 出货/退货'),('3','Planning','预测 → MRP → 计划订单/指令'),('4','Procurement & Outsourcing','供应商 → 请购 → 采购订单 → 收货/委外'),('5','Manufacturing & Quality','制令 → 领料 → 检验 → 入库'),('6','Inventory & Warehouse','库存作业、异动、追溯、报废/月结'),('7','Finance Operations','应收应付、收付款、发票'),('8','Accounting & Analytics','会计事件、凭证、对账和报表'),('9','Platform','用户权限、流程、编号与通知')],[1.5,5.2,8.3])

flows=[
('4.2 销售到收款（Order to Cash）',['准备一个启用客户和可销货品。','创建销售报价或销售订单，检查客户、货品、数量、单价和总额。','按权限提交/审批订单，观察状态变化和错误提示。','创建销售出货并确认；若启用质量/信用控制，按提示完成前置步骤。','在应收/收款模块核对下游记录，完成收款或核销测试。','在经营分析或相关报表核对数量、金额与状态。']),
('4.3 采购到付款（Procure to Pay）',['准备启用供应商、货品和仓库。','创建请购/采购订单并完成审批。','执行采购收货；需要 IQC 时先完成来料检验。','核对库存增加、供应商账单/应付记录。','执行付款或核销，并检查审计与状态。']),
('4.4 计划到生产（Plan to Produce）',['维护预测或需求来源。','运行 MRP 并查看建议；确认计划日期和数量。','把批准的计划转换为生产/采购指令。','生产侧按制令完成领料、过程检验与入库。','核对 WIP、库存和成本结果；失败时确认无部分副作用。']),
('4.5 委外加工（Plan to Outsource）',['准备已启用的供应商、委外货品与发料仓库；由计划需求或已有委外订单发起委外需求。','在「委外加工」中确认委外订单、发料仓库、发料数量与加工工序。','按委外用料清单发料到供应商；核对发料单状态、库存减少与发料记录。','供应商加工完成后收料并检验；核对委外入库数量、批次信息与检验结论。','在应付结算核对加工费与材料成本，确认委外入库的材料加加工费进入存货成本。','任何一步失败时，确认没有留下半成品：发料、收料与应付要么都成立，要么都不成立。']),
    ('4.6 记录到报告（Record to Report）',['从一笔已完成业务单据出发，查看它生成的库存、应收或应付事实。','在会计事件台账核对事件是否生成；重复触发不应产生重复事件。','查看生成的凭证，核对借贷平衡与业务来源；不要手工伪造业务来源。','在业务财务对账中运行对账，核对差异是否为 0；出现差异时记录业务日期与期间。','期间结束后在报表平台核对财务报表与经营会计；未过账的事件不会进入报表。','过账、反冲、期间结账等高风险操作只按测试脚本执行。']),
    ('4.7 库存与追溯',['从库存作业查看可用量、仓库、批次/序列信息。','执行一笔有权限的调拨、盘点、调整或报废。','确认单据状态变化与库存异动一致。','在追溯页面从批次/序列号回查来源和去向。','涉及月结时仅由授权人员在约定测试期间执行。'])]
for title,items in flows:
    doc.add_heading(title,level=2)
    for item in items: step(doc,item)

doc.add_heading('5. 信用管理专题', level=1)
note(doc,'本版变化','客户、销售员、销售订单、销售出货、信用检查结果和评分人均通过授权范围内的中文业务选择器选择；不再要求手工粘贴数据库 ID。金额输入统一按“元”，系统提交时精确换算为整数分。')
doc.add_heading('5.1 信用档案', level=2)
for t in ['打开“信用管理基础”并进入“信用档案”。','从客户下拉框选择“代码 · 名称 · 状态”。客户信用对象会自动绑定。','如需销售员子额度，选择销售员；留空表示客户总额度。','输入信用额度（元，最多两位小数）；留空表示不设上限。','选择评级、逾期策略和生效日期后保存。']: step(doc,t)
doc.add_heading('5.2 信用检查与特别审批', level=2)
for t in ['选择客户、可选销售员和业务阶段。','输入本次敞口增量（元），再选择销售订单或销售出货，两者选其一。','执行检查并查看客户总额度/销售员子额度结果。','结果为“需要特别审批”时，在特别审批页选择对应检查结果并填写原因与金额。','审批人员按职责分离要求批准或拒绝；普通申请人不能替代审批人。']: step(doc,t)
doc.add_heading('5.3 信用评估', level=2)
for t in ['选择评分模型、客户和信用对象类型。','选择销售订单或客户作为信用对象。','通过多选列表选择评分人；停用账号仍按现有历史合同可见，不代表其一定能登录。','评分人逐项提交；所有指定评分人完成后才可终评。','应用评级需要信用管理 + 跨组权限，单独的评分权限不足。']: step(doc,t)

doc.add_heading('6. 移动端与窄屏测试', level=1)
add_table(doc,['宽度','用途','重点'],[('390 CSS px','主要移动基线','主任务、状态、主按钮可见'),('320 CSS px','极窄兼容','无永久横向滚动；字段不被截断'),('430 CSS px','大屏手机','卡片和操作区排列自然'),('680 CSS px','平板/窄桌面','导航切换合理，信息层级清楚')],[3.0,4.0,8.0])
for t in ['使用浏览器开发者工具或真实设备测试，不用页面缩放代替视口宽度。','验证 LIST → DETAIL → EDITOR/WORKFLOW 的核心路径。','复杂表格允许局部滚动，但核心任务不能依赖整页永久横向滚动。','检查软键盘出现后主按钮、错误提示和当前输入仍可访问。']: bullet(doc,t)

doc.add_heading('7. 问题反馈', level=1)
doc.add_heading('7.1 提交前自查', level=2)
for t in ['确认使用的是管理员提供的最新测试地址，并刷新一次。','记录发生时间、账号角色（不要写密码）、页面名称和单据编号。','再次按相同步骤复现；记录是否必现。','确认是否只是权限不足、状态不允许或必填字段缺失。']: bullet(doc,t)
doc.add_heading('7.2 反馈模板', level=2)
add_table(doc,['字段','示例'],[
('标题','【销售订单】提交后提示与预期不符'),('环境',f'腾讯云客户测试环境 / v{VERSION} / Chrome'),('账号角色','销售测试员（不要填写账号密码）'),('页面/单据','销售订单 / SO-TEST-001'),('前置条件','客户、货品已启用；订单为草稿'),('操作步骤','1. 打开订单；2. 点击提交；3. …'),('实际结果','完整错误提示、状态、是否产生下游记录'),('预期结果','希望出现的业务结果'),('复现率','3/3 必现 或 偶发'),('附件','脱敏截图/录屏；圈出关键区域')],[3.5,11.5])
note(doc,'严重级别','P0：系统不可用/数据安全；P1：核心流程阻断或数据错误；P2：有绕行办法的功能/交互问题；P3：文字、样式或建议。')

doc.add_heading('8. 附录', level=1)
doc.add_heading('8.1 测试完成清单', level=2)
checks=['可登录、退出和刷新','权限菜单符合岗位','至少完成一条销售流程','至少完成一条采购/收货流程','按岗位完成计划/生产/库存验证','按岗位完成委外加工验证','财务金额均按元理解','错误提示可理解且无静默失败','390/320/430/680 宽度已抽测','问题反馈不含敏感数据','关键单据编号与结果已留档']
for c in checks: bullet(doc,f'□ {c}')
doc.add_heading('8.2 常用术语', level=2)
add_table(doc,['术语','说明'],[('草稿','尚未提交，可按权限编辑'),('提交','进入审批或下一业务状态'),('确认','形成权威业务事实，通常不可随意撤销'),('过账','形成会计事实'),('反冲/冲销','按受控流程抵销既有事实，不直接删除历史'),('SOD','职责分离，同一人不能同时承担冲突职责'),('幂等','重复提交同一请求不会重复产生业务结果'),('业务日期','业务判断使用的日期，不等同于操作时间')],[3.4,11.6])
doc.add_heading('8.3 支持边界', level=2)
for t in ['本手册是 DRAFT 测试指导，不替代正式业务制度。','页面、权限、业务结果与手册不一致时，请提交反馈；不要自行修改数据库。','部署、备份恢复、迁移、清库和生产发布不在普通用户测试范围。','验收与冻结需在 Implementation 完成后按独立 Acceptance 流程执行。']: bullet(doc,t)

doc.core_properties.title='Modern ERP 用户测试手册（DRAFT）'; doc.core_properties.subject='腾讯云客户测试环境 / MySQL 8'; doc.core_properties.author='Modern ERP Platform'; doc.core_properties.keywords='ERP, 用户测试, MySQL, 腾讯云, DRAFT'
OUT.parent.mkdir(parents=True,exist_ok=True); doc.save(OUT); print(OUT)
