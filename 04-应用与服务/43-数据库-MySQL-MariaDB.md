# 第 43 章 数据库：MySQL/MariaDB

数据库和 Web 服务是开发工作里最常自建的两类服务。这一章以 MariaDB（Arch 仓库里的 MySQL 分支）为主线，走完「装 → 初始化 → 建库建号 → 授权 → 连接 → 备份恢复 → 排障」。同一个流程换到 PostgreSQL 只有命令差异，第 44 章会做对照。

> 本章目标：能完成 MariaDB 的安装与数据目录初始化并交给 systemd 托管；理解 root 的 `unix_socket` 认证为何让 `sudo mariadb` 免密；能建库、建应用账号并按最小权限授权；会用 `mariadb-dump` 做一致性备份并在新实例恢复；能从 `journalctl -u mariadb` 与错误日志定位「连不上」的四类原因。
> 对应 Wiki：[MariaDB](https://wiki.archlinux.org/title/MariaDB)

## 安装与初始化

（环境：WSL）

```bash
sudo pacman -S mariadb
sudo mariadb-install-db --user=mysql --basedir=/usr --datadir=/var/lib/mysql
sudo systemctl enable --now mariadb
systemctl status mariadb
```

`mariadb-install-db` 只跑一次，作用是在 `/var/lib/mysql` 建立系统表（`mysql`、`performance_schema` 等）。**跳过它，`mariadbd` 会因为找不到权限表而直接启动失败**：`systemctl status mariadb` 显示 `failed`，客户端报 `Can't connect to local server through socket`。看到这个报错先确认初始化有没有做，再怀疑 socket 路径。

初始化后立刻做一次安全初始化：

```bash
sudo mariadb-secure-installation
```

它会问四件事：是否设置 root 密码、是否删除匿名用户、是否禁止 root 远程登录、是否删除测试库。四个问题都建议答「是」。

三个版本差异要留意：较新的 MariaDB 把客户端命令改名为 `mariadb`（`mysql` 是兼容别名，逐步淡出）；`mysql_secure_installation` 对应改名为 `mariadb-secure-installation`；旧教程里的 `mysqldump` 现在叫 `mariadb-dump`。

## root 为什么不用密码也能进

Arch 的 MariaDB 默认给 `root@localhost` 启用 **`unix_socket` 认证**：只要你是本机 root（或通过 sudo 提权），就能直接进，不需要密码。

```bash
sudo mariadb            # 免密进入（走 unix_socket）
mariadb -u root -p      # 走密码认证；若没设密码会失败
```

这解释了新手最常遇到的矛盾：照着教程 `mysql -u root -p` 进不去，但 `sudo mysql` 可以。**它不是坏了，而是两套认证插件并存**。生产环境通常保留 `unix_socket`（本地管理方便）并给应用单独建密码账号。

## 建库、建号、授权

三件事一次做完（在 `sudo mariadb` 的交互界面里）：

```sql
CREATE DATABASE app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'app'@'localhost' IDENTIFIED BY '强密码放这里';
GRANT ALL PRIVILEGES ON app.* TO 'app'@'localhost';
FLUSH PRIVILEGES;
```

四条原则：

- **字符集用 `utf8mb4`**：MySQL 的 `utf8` 是历史遗留的三字节实现，存不了 emoji 与部分生僻字。
- **账号按来源限定**：`'app'@'localhost'` 只允许本机连接；要远程访问必须改 `'app'@'10.0.0.%'` 之类，**不要图省事写 `'%'`**——那等于对全世界开放。
- **授权按库限定**：`ON app.*` 而不是 `ON *.*`；应用只需要 DML 时进一步收窄到 `SELECT, INSERT, UPDATE, DELETE`。
- `FLUSH PRIVILEGES` 在现代版本里授予后并非必需（授权表会自动重载），但保留它无害，且能兼容旧版。

## 连接：四类「连不上」

应用连不上数据库时，按这四层查（第 14 章的六层模型在这里收窄成「服务/监听/认证/库」四层）：

| 层 | 现象 | 检查 |
| --- | --- | --- |
| 服务 | `Connection refused` | `systemctl status mariadb`、`journalctl -u mariadb` |
| 监听 | 本机能连、外部不能 | `ss -tlnp \| grep 3306`，看是 `127.0.0.1` 还是 `0.0.0.0` |
| 认证 | `Access denied for user` | 账号的 `host` 部分是否匹配来源；密码是否正确 |
| 库 | `Unknown database` | 库名拼写、字符集、是否连到了另一个实例 |

**Arch 的默认配置并不限制监听地址**：`/etc/my.cnf.d/server.cnf` 里的 `bind-address` 是注释掉的，服务默认监听所有接口。只给本机用就必须显式加上：

```ini
# /etc/my.cnf.d/server.cnf 的 [mariadb] 段
bind-address = 127.0.0.1
```

要开远程访问则反过来：保留更宽的监听、建带来源的账号、放行防火墙（第 46 章），三件事缺一不可。第 46 章「把数据库绑回环」的建议就落在这行配置上。

应用侧的连接串大致是：

```text
mysql://app:密码@127.0.0.1:3306/app?charset=utf8mb4
```

**用 `127.0.0.1` 而不是 `localhost`**：很多客户端库把 `localhost` 解释为「走 Unix socket」，而这与 TCP 的认证来源判定可能不同（socket 连接被视作 `localhost`），排查时容易误判。

## 备份与恢复

逻辑备份用 `mariadb-dump`，关键是「一致性 + 可重建」：

```bash
mariadb-dump --single-transaction --routines --triggers --events app > app.sql
mariadb-dump --all-databases --single-transaction > all.sql
```

- `--single-transaction` 在 InnoDB 上给出不锁表的一致性快照，**必须加**；
- `--routines`/`--triggers`/`--events` 把存储过程、触发器、事件一并导出，漏了它们恢复出来的库是「缺胳膊少腿」的；
- 备份文件要给权限（含数据），不要放进 Web 根目录。

恢复：

```bash
mariadb -u root -p app < app.sql          # 先建空库再导入
```

一致性验证是备份的一半：把 `app.sql` 导入到一个临时库（或临时实例），跑一次 `SELECT COUNT(*)` 与关键表校验，才算备份可用。只「生成文件」不验证，是每年都在发生的灾难模板。

物理备份（数据目录级、更快但要求停机或专用工具）用 `mariabackup`，适合大库；日常小库用 `mariadb-dump` 足够。

## 运维要点

```bash
sudo mariadb -e 'SHOW VARIABLES LIKE "character_set%"'
sudo mariadb -e 'SHOW PROCESSLIST'            # 谁在连、在跑什么
sudo journalctl -u mariadb -b --no-pager | tail -30
```

两条最值得先调的参数（写在 `/etc/my.cnf.d/server.cnf` 的 `[mysqld]` 段）：`innodb_buffer_pool_size`（建议为可用内存的 50%–70%，这是影响性能最大的一个）与 `max_connections`（连接池上限，调大要配合内存）。改完 `systemctl restart mariadb`。

## 小结

- 安装后必须 `mariadb-install-db` 初始化数据目录，否则服务起来也连不上。
- root 默认走 `unix_socket`，`sudo mariadb` 免密是正常行为，不是配置漏洞。
- 建库用 `utf8mb4`；账号按来源限定、授权按库限定，不要 `'%'` + `*.*`。
- 连不上按「服务 → 监听 → 认证 → 库」四层查；连接串优先 `127.0.0.1`。
- 备份必加 `--single-transaction` 与 `--routines/--triggers/--events`，并实际导入验证。
- 先调 `innodb_buffer_pool_size`，再谈其他性能参数。

## 练习

1. 装并初始化（环境：WSL）：完成安装、`mariadb-install-db`、启动，用 `sudo mariadb -e 'SELECT VERSION()'` 验证；再故意跳过初始化重装一次，记录报错原文。
2. 两套认证（环境：WSL）：分别用 `sudo mariadb`、`mariadb -u root -p`、`mariadb -u root` 尝试登录，解释三次结果差异。
3. 建库建号（环境：WSL）：按正文四条原则建 `app` 库与 `app@localhost` 账号，用 `mariadb -u app -p app -e 'SELECT 1'` 验证；再试 `mariadb -u app -p -h 127.0.0.1` 观察是否可连。
4. 字符集验证（环境：WSL）：插入一条含 emoji 的记录，用 `SHOW VARIABLES LIKE 'character_set%'` 证明是 `utf8mb4`。
5. 备份恢复（环境：WSL）：造 100 行数据 → `mariadb-dump` → 删除库 → 重建空库 → 导入 → 校验行数与内容一致；再试一次不带 `--single-transaction` 的导出，说明差别。
6. 四层排查（环境：WSL）：停服务复现 `Connection refused`；用 `ss -tlnp` 确认当前监听地址并写出应加的 `bind-address` 配置行（不实际改）；建一个 host 不匹配的账号复现 `Access denied`，从日志里找到对应行。

## 自检

- [ ] 能说出初始化数据目录的命令与跳过它的后果
- [ ] 能解释 `unix_socket` 认证与密码认证并存的现象
- [ ] 能按最小权限原则建库、建号、授权，并说出为什么不用 `'%'` + `*.*`
- [ ] 能按「服务 → 监听 → 认证 → 库」四层排查连接失败
- [ ] 能写出带 `--single-transaction` 与例程导出的备份命令，并说明验证方法
- [ ] 知道影响性能最大的一项参数是什么

## 参考

- [MariaDB](https://wiki.archlinux.org/title/MariaDB)
- [MariaDB 官方文档](https://mariadb.com/kb/en/documentation/)
- [Systemd](https://wiki.archlinux.org/title/Systemd)
