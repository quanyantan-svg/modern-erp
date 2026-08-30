# 部署指南

## 目标环境
| 项目 | 配置 |
|------|------|
| 云服务器 | 腾讯云轻量应用服务器 Lighthouse |
| 操作系统 | Ubuntu 22.04 LTS |
| 数据库 | MySQL 8.0 |
| 后端 | Node.js 22 LTS |
| 前端托管 | Nginx |
| 部署方式 | Git代码拉取 |

---

## 1. 服务器准备

### 1.1 系统更新
\\\ash
sudo apt update && sudo apt upgrade -y
\\\

### 1.2 安装基础软件
\\\ash
sudo apt install -y curl git vim nginx certbot python3-certbot-nginx
\\\

### 1.3 安装Node.js
\\\ash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
\\\

### 1.4 安装MySQL
\\\ash
sudo apt install -y mysql-server
sudo mysql_secure_installation
\\\

---

## 2. 数据库配置

### 2.1 创建数据库和用户
\\\sql
CREATE DATABASE erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER erp_user@localhost IDENTIFIED BY YourStrongPassword;
GRANT ALL PRIVILEGES ON erp.* TO erp_user@localhost;
FLUSH PRIVILEGES;
\\\

### 2.2 初始化表结构
\\\ash
cd /var/www/erp
pnpm install
pnpm db:migrate
\\\

---

## 3. 应用部署

### 3.1 创建应用目录
\\\ash
sudo mkdir -p /var/www/erp
sudo chown -R www-data:www-data /var/www/erp
\\\

### 3.2 从Git拉取代码
\\\ash
cd /var/www/erp
git clone <your-repo-url> .
\\\

### 3.3 配置环境变量
\\\ash
cp .env.example .env
nano .env
\\\

配置内容:
\\\ash
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

DB_HOST=localhost
DB_PORT=3306
DB_NAME=erp
DB_USER=erp_user
DB_PASSWORD=YourStrongPassword

JWT_SECRET=your-jwt-secret-key-here
\\\

### 3.4 安装依赖和构建
\\\ash
pnpm install
pnpm build
\\\

---

## 4. PM2进程管理

### 4.1 安装PM2
\\\ash
sudo npm install -g pm2
\\\

### 4.2 创建ecosystem配置
\\\javascript
module.exports = {
  apps: [{
    name: erp-api,
    script: server/index.js,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: 512M,
    env: {
      NODE_ENV: production
    }
  }]
};
\\\

### 4.3 启动应用
\\\ash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
\\\

### 4.4 PM2常用命令
| 命令 | 说明 |
|------|------|
| pm2 status | 查看状态 |
| pm2 logs | 查看日志 |
| pm2 restart | 重启 |
| pm2 stop | 停止 |

---

## 5. Nginx配置

### 5.1 创建Nginx配置
\\\ash
sudo nano /etc/nginx/sites-available/erp
\\\

配置内容:
\\\
ginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://server_name;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    root /var/www/erp/dist;
    index index.html;

    location / {
        try_files uri uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host host;
        proxy_set_header X-Real-IP remote_addr;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
\\\

### 5.2 启用配置
\\\ash
sudo ln -s /etc/nginx/sites-available/erp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
\\\

### 5.3 SSL证书
\\\ash
sudo certbot --nginx -d your-domain.com
sudo systemctl reload nginx
\\\

---

## 6. 备份配置

### 6.1 创建备份脚本
\\\ash
sudo nano /usr/local/bin/erp-backup.sh
\\\

内容:
\\\ash
#!/bin/bash
DATE=
BACKUP_DIR=/var/backups/erp
mkdir -p BACKUP_DIR
mysqldump -u erp_user -pERP_PASSWORD erp > BACKUP_DIR/erp_db_DATE.sql
find BACKUP_DIR -name "*.sql" -mtime +7 -delete
\\\

### 6.2 设置定时任务
\\\ash
sudo chmod +x /usr/local/bin/erp-backup.sh
sudo crontab -e
0 2 * * * /usr/local/bin/erp-backup.sh
\\\

---

## 7. 验证部署

### 7.1 检查服务状态
\\\ash
pm2 status
sudo systemctl status nginx
sudo systemctl status mysql
\\\

### 7.2 测试访问
- 前端: https://your-domain.com
- API: https://your-domain.com/api/health
- 预期: 返回 {status: ok}

---

## 8. 故障排查

### 8.1 查看日志
| 命令 | 用途 |
|------|------|
| pm2 logs | PM2日志 |
| sudo tail -f /var/log/nginx/error.log | Nginx错误日志 |
| sudo journalctl -u erp -f | Systemd日志 |

### 8.2 常见问题
| 问题 | 解决方案 |
|------|----------|
| 502 Bad Gateway | 检查PM2是否运行 |
| 数据库连接失败 | 检查.env配置 |
| SSL证书过期 | 运行certbot renew |

---

## 9. 参考文档
- docs/03-architecture.md - 目标架构
- docs/04-refactor-plan.md - 重构计划
- docs/05-database.md - 数据库设计