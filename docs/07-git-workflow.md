# Git工作流

## 1. 分支策略

### 1.1 分支命名
| 分支 | 用途 | 示例 |
|------|------|------|
| main | 生产环境 | - |
| develop | 开发主线 | - |
| feature/* | 新功能 | feature/user-auth |
| fix/* | 修复 | fix/order-status |
| refactor/* | 重构 | refactor/database |
| deploy/* | 部署配置 | deploy/production |

### 1.2 分支流程
\\\
main (生产)
  ^
  | merge (tag)
  |
develop (开发主线)
  ^
  | merge
  |
feature/xxx (功能开发)
\\\

---

## 2. 提交规范

### 2.1 提交信息格式
\\\
<type>: <subject>

<body>

<footer>
\\\

### 2.2 Type类型
| 类型 | 说明 |
|------|------|
| feat | 新功能 |
| fix | 修复bug |
| docs | 文档变更 |
| style | 代码格式(不影响功能) |
| refactor | 重构(非bug修复) |
| test | 测试相关 |
| chore | 构建/工具相关 |

### 2.3 示例
\\\
feat: 添加用户修改密码功能

- 添加修改密码API
- 添加前端密码修改表单
- 添加密码强度校验

Closes #123
\\\

---

## 3. 开发流程

### 3.1 开始新功能
\\\ash
git checkout develop
git pull origin develop
git checkout -b feature/xxx
\\\

### 3.2 提交代码
\\\ash
git add .
git commit -m "feat: 添加xxx功能"
\\\

### 3.3 推送到远程
\\\ash
git push origin feature/xxx
\\\

### 3.4 合并到develop
\\\ash
git checkout develop
git pull origin develop
git merge feature/xxx
git push origin develop
\\\

---

## 4. 生产部署

### 4.1 部署流程
\\\ash
# 1. 确保develop测试通过
git checkout develop
git pull origin develop

# 2. 创建发布分支
git checkout -b release/v1.0.0

# 3. 合并到main
git checkout main
git merge release/v1.0.0

# 4. 打标签
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin main --tags

# 5. 清理
git branch -d release/v1.0.0
\\\

### 4.2 服务器更新
\\\ash
cd /var/www/erp
git pull origin main
pnpm install
pnpm build
pm2 restart erp-api
\\\

---

## 5. .gitignore

### 5.1 必须忽略
\\\
# 依赖
node_modules/

# 构建产物
dist/

# 数据文件
data/
*.db
*.db-shm
*.db-wal

# 环境变量
.env
.env.local
.env.production

# 日志
*.log
logs/

# 备份
*.bak
*.backup

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
\\\

---

## 6. 保护规则

### 6.1 main分支保护
- 必须通过PR合并
- 必须至少1人 review
- 必须通过CI测试
- 禁止强制推送

### 6.2 develop分支保护
- 必须通过PR合并
- 建议review

---

## 7. 常用命令

| 命令 | 用途 |
|------|------|
| git status | 查看状态 |
| git log --oneline | 提交历史 |
| git branch -a | 查看分支 |
| git stash | 暂存更改 |
| git diff | 查看差异 |

---

## 8. 参考文档
- docs/04-refactor-plan.md - 重构计划
- docs/06-deployment.md - 部署指南