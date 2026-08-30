# IT管理员 - 数据库导出指令

## 按顺序运行以下命令

### 1. 导出所有表结构
sqlcmd -S (local) -d ft_sys -U rw -P "Rw@tF#..rongwei%26*01-09@fT" -Q "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_NAME, ORDINAL_POSITION" -o "C:\temp\all_columns.csv" -s"," -W

### 2. 导出所有存储过程
sqlcmd -S (local) -d ft_sys -U rw -P "Rw@tF#..rongwei%26*01-09@fT" -Q "SELECT ROUTINE_NAME, ROUTINE_DEFINITION FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE='PROCEDURE' ORDER BY ROUTINE_NAME" -o "C:\temp\all_procedures.txt" -s"|"

### 3. 导出所有视图
sqlcmd -S (local) -d ft_sys -U rw -P "Rw@tF#..rongwei%26*01-09@fT" -Q "SELECT TABLE_NAME, VIEW_DEFINITION FROM INFORMATION_SCHEMA.VIEWS" -o "C:\temp\all_views.txt" -s"|"

### 4. 导出所有外键关系
sqlcmd -S (local) -d ft_sys -U rw -P "Rw@tF#..rongwei%26*01-09@fT" -Q "SELECT fk.name AS FK_NAME, tp.name AS PARENT_TABLE, ref.name AS REFERENCED_TABLE FROM sys.foreign_keys fk INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id INNER JOIN sys.tables ref ON fk.referenced_object_id = ref.object_id" -o "C:\temp\all_foreign_keys.txt"

### 5. 导出核心表数据
sqlcmd -S (local) -d ft_sys -U rw -P "Rw@tF#..rongwei%26*01-09@fT" -Q "SELECT * FROM SKY_Register" -o "C:\temp\SKY_Register.txt"
sqlcmd -S (local) -d ft_sys -U rw -P "Rw@tF#..rongwei%26*01-09@fT" -Q "SELECT * FROM SEC_Module" -o "C:\temp\SEC_Module.txt"
sqlcmd -S (local) -d ft_sys -U rw -P "Rw@tF#..rongwei%26*01-09@fT" -Q "SELECT * FROM SEC_Role" -o "C:\temp\SEC_Role.txt"
sqlcmd -S (local) -d ft_sys -U rw -P "Rw@tF#..rongwei%26*01-09@fT" -Q "SELECT COUNT(*) AS USER_COUNT FROM SKY_Users" -o "C:\temp\user_count.txt"

### 6. 导出网站文件（推荐）
powershell -Command "Compress-Archive -Path C:\inetpub\B9CLOUD\* -DestinationPath C:\temp\b9cloud_site.zip -Force"

### 7. 压缩所有导出文件
powershell -Command "Compress-Archive -Path C:\temp\*.txt, C:\temp\*.csv -DestinationPath C:\temp\db_full_export.zip -Force"
