# 第 67 章 数据库：MySQL/MariaDB

数据库和 Web 服务是开发工作里最常自建的两类服务。这一章以 MariaDB（Arch 仓库里的 MySQL 分支）为主线，走完「装 → 初始化 → 建库建号 → 授权 → 连接 → 备份恢复 → 排障」。换到 PostgreSQL 时流程形状相同，但**认证、权限、备份三处差异很大**，照搬命令一定踩坑——第 68 章专门对照这三处。

> 本章目标：能完成 MariaDB 的安装与数据目录初始化并交给 systemd 托管；理解 root 的 `unix_socket` 认证为何让 `sudo mariadb` 免密；能建库、建应用账号并按最小权限授权；会用 `mariadb-dump` 做一致性备份并在新实例恢复；能从 `journalctl -u mariadb` 与错误日志定位「连不上」的四类原因。
> 对应 Wiki：[MariaDB](https://wiki.archlinux.org/title/MariaDB)

## 安装与初始化



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

它会逐项询问：设置 root 密码、是否保留 `unix_socket` 认证、删除匿名用户、禁止 root 远程登录、删除测试库、重载权限表。**建议保留 `unix_socket`**（这是 `sudo mariadb` 免密的基础）；若给 root 设了密码，注意登录方式会随之变化，收尾时把 `sudo mariadb` 与 `mariadb -u root -p` 各验证一遍。MariaDB 官方 KB 有「多数情况不必跑它」的说明，但脚本自身输出的 NOTE 仍推荐把各项都运行一遍。

三个版本差异要留意：较新的 MariaDB 把客户端命令改名为 `mariadb`（`mysql` 是兼容别名，逐步淡出）；`mysql_secure_installation` 对应改名为 `mariadb-secure-installation`；旧教程里的 `mysqldump` 现在叫 `mariadb-dump`。

## root 为什么不用密码也能进

Arch 的 MariaDB 默认给 `root@localhost` 启用 **`unix_socket` 认证**：只要你是本机 root（或通过 sudo 提权），就能直接进，不需要密码。

```bash
sudo mariadb # 免密进入（走 unix_socket）
mariadb -u root -p # 走密码认证；若没设密码会失败
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

应用连不上数据库时，按这四层查（第 24 章的六层模型在这里收窄成「服务/监听/认证/库」四层）：

| 层 | 现象 | 检查 |
| ---- | ------------------------ | -------------------------------------------------------- |
| 服务 | `Connection refused` | `systemctl status mariadb`、`journalctl -u mariadb` |
| 监听 | 本机能连、外部不能 | `ss -tlnp \| grep 3306`，看是 `127.0.0.1` 还是 `0.0.0.0` |
| 认证 | `Access denied for user` | 账号的 `host` 部分是否匹配来源；密码是否正确 |
| 库 | `Unknown database` | 库名拼写、字符集、是否连到了另一个实例 |

**Arch 的默认配置并不限制监听地址**：`/etc/my.cnf.d/server.cnf` 里的 `bind-address` 是注释掉的，服务默认监听所有接口。只给本机用就必须显式加上：

```ini
# /etc/my.cnf.d/server.cnf 的 [mariadb] 段
bind-address = localhost # 同时覆盖 127.0.0.1 与 ::1；只写 127.0.0.1 时走 ::1 的客户端仍连不上
```

要开远程访问则反过来：保留更宽的监听、建带来源的账号、放行防火墙（第 76 章），三件事缺一不可。第 76 章「把数据库绑回环」的建议就落在这行配置上。

应用侧的连接串大致是：

```text
mysql://app:密码@127.0.0.1:3306/app?charset=utf8mb4
```

**用 `127.0.0.1` 而不是 `localhost`**：很多客户端库把 `localhost` 解释为「走 Unix socket」，而这与 TCP 的认证来源判定可能不同（socket 连接被视作 `localhost`），排查时容易误判。

## 备份与恢复

逻辑备份用 `mariadb-dump`，关键是「一致性 + 可重建」：

```bash
umask 077 # 新文件默认 600
stamp=$(date +%F-%H%M)
sudo mariadb-dump --single-transaction --routines --triggers --events app > "app-$stamp.sql"
sudo mariadb-dump --all-databases --single-transaction --routines --triggers --events > "all-$stamp.sql"
```

普通用户直接跑 `mariadb-dump` 会以当前 OS 用户去连库、报 `Access denied`——用 `sudo` 走 root 的 `unix_socket` 认证（或显式给备份账号的 `-u/-p`）。

- `--single-transaction` 在 InnoDB 上给出不锁表的一致性快照，**必须加**；
- `--routines`/`--triggers`/`--events` 把存储过程、触发器、事件一并导出，漏了它们恢复出来的库是「缺胳膊少腿」的；
- 备份含全量数据，权限收紧（`600`、放在专属目录），不要放进 Web 根目录。重定向 `>` 由**当前 shell** 创建文件，`sudo` 只作用于前面的 `mariadb-dump`；不先 `umask 077` 就会按调用者的 umask 生成其他用户可读的备份，且 `>` 会静默截断同名旧备份，所以用时间戳文件名。
- `--all-databases` 会连 `mysql` 系统库一起导出，恢复时覆盖用户与权限表；只备份业务库时不要用它。

恢复：

```bash
sudo mariadb app < app.sql # 先建空库，再用 root 的 unix_socket 身份导入
```

一致性验证是备份的一半：把 `app.sql` 导入到一个临时库（或临时实例），跑一次 `SELECT COUNT(*)` 与关键表校验，才算备份可用。只「生成文件」不验证，是每年都在发生的灾难模板。

物理备份（数据目录级、更快但要求停机或专用工具）用 `mariabackup`，适合大库；日常小库用 `mariadb-dump` 足够。

## 运维要点

```bash
sudo mariadb -e 'SHOW VARIABLES LIKE "character_set%"'
sudo mariadb -e 'SHOW PROCESSLIST' # 谁在连、在跑什么
sudo journalctl -u mariadb -b --no-pager | tail -30
```

两条最值得先调的参数（写在 `/etc/my.cnf.d/server.cnf` 的 `[mariadb]` 段）：`innodb_buffer_pool_size`（建议为可用内存的 50%–70%，这是影响性能最大的一个）与 `max_connections`（连接池上限，调大要配合内存）。改完 `systemctl restart mariadb`。另有一条升级纪律：**跨大版本升级后跑 `sudo mariadb-upgrade`** 重建系统表，否则新旧元数据不匹配会出各种怪错。

## 失败模式

数据库的故障大多能归到「没初始化、连错层、权限宽、备份假」四类：

| 现象 | 根因 | 处置 |
| ---------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| `Can't connect to local server through socket` | 数据目录未初始化，或 socket 路径与服务不一致 | 先 `mariadb-install-db`，再 `systemctl status mariadb` 看真实 socket |
| `sudo mariadb` 能进、`mariadb -u root -p` 不能 | 两套认证并存：`unix_socket` 与密码 | 属正常；需要密码登录就单独设密码并验证两条路径 |
| 本机能连、外部不能 | 默认 `bind-address` 未限制但防火墙未放行，或反之绑在回环 | `ss -tlnp \| grep 3306` 看监听地址，再查防火墙 |
| `Access denied for user 'app'@'…'` | 账号的 host 部分与来源不匹配 | 建 `'app'@'127.0.0.1'` 或对应网段账号，不要用 `'%'` 图省事 |
| emoji 插入报错或变问号 | 库/表用了三字节的 `utf8` | 建库即 `utf8mb4`，已有表需改列字符集 |
| 服务启动后立刻退出 | 磁盘满、InnoDB 日志损坏、数据目录属主错误 | `journalctl -u mariadb` 看最后 30 行；先备份数据目录再动 |
| 备份恢复后少存储过程/触发器 | dump 没加 `--routines`/`--triggers`/`--events` | 重做备份并实际导入验证 |
| 跨大版本升级后怪错 | 系统表未重建 | 升级后跑 `sudo mariadb-upgrade` |

最危险的一条是「备份文件生成了，但从没导入过」。`mariadb-dump` 成功只证明读取与写文件成功，不证明文件可恢复。

## 验证与回滚

安装与授权的验证各用一条命令即可闭环：

```bash
sudo mariadb -e 'SELECT VERSION(); SHOW VARIABLES LIKE "bind_address";'
ss -tlnp | grep 3306
mariadb -u app --password=app app -e 'SELECT COUNT(*) FROM app.t;'
sudo journalctl -u mariadb -b --no-pager | tail -20
```

备份的验证必须「换个库导入」而不是原地覆盖：

```bash
sudo mariadb -e 'CREATE DATABASE app_verify'
sudo mariadb app_verify < app-2026-11-04.sql
sudo mariadb -e 'SELECT COUNT(*) FROM app_verify.t'
sudo mariadb -e 'DROP DATABASE app_verify'
```

行数与关键字段一致，备份才算可用。回滚依赖「改动前先备份」：

```bash
sudo mariadb-dump --single-transaction --routines --triggers --events app > app-before-change.sql
# 配置或数据出错时
sudo mariadb app < app-before-change.sql
sudo systemctl restart mariadb
```

改 `server.cnf` 前先复制一份（`sudo cp /etc/my.cnf.d/server.cnf /etc/my.cnf.d/server.cnf.bak`）；改坏导致起不来时，恢复文件再启动，比在错误日志里猜参数快得多。

## 取舍边界

- **MariaDB vs PostgreSQL**：需要成熟生态、MySQL 兼容、简单主从 → MariaDB；需要更强的事务语义、复杂查询、JSON/扩展 → PostgreSQL（第 68 章）。
- **逻辑备份 vs 物理备份**：小库用 `mariadb-dump`，跨版本、可读、可选择性恢复；大库用 `mariabackup`，快但要求停机或专用流程。
- **绑定回环 vs 对外监听**：同机应用一律绑 `localhost`；确需远程时同时做「收窄账号来源 + 防火墙放行 + TLS」三件事，缺一不可。
- **`unix_socket` vs 密码**：本地管理保留 socket 最省事；应用账号必须用密码并限制来源，两者可以并存。
- **内存分配的取舍**：`innodb_buffer_pool_size` 调大能显著提升命中率，但会和同机 Web/容器抢内存；按整机预算分配，而不是照搬「50%–70%」。
- **自建 vs 容器化**：自建便于直接调参与备份；容器化便于版本隔离，但数据卷、备份与升级路径要单独设计（第 71 章）。

## 小结

- 安装后必须 `mariadb-install-db` 初始化数据目录，否则服务起来也连不上。
- root 默认走 `unix_socket`，`sudo mariadb` 免密是正常行为，不是配置漏洞。
- 建库用 `utf8mb4`；账号按来源限定、授权按库限定，不要 `'%'` + `*.*`。
- 连不上按「服务 → 监听 → 认证 → 库」四层查；连接串优先 `127.0.0.1`。
- 备份必加 `--single-transaction` 与 `--routines/--triggers/--events`，并实际导入验证。
- 先调 `innodb_buffer_pool_size`，再谈其他性能参数。

## 练习

1. 装并初始化：完成安装、`mariadb-install-db`、启动，用 `sudo mariadb -e 'SELECT VERSION()'` 验证；再故意跳过初始化重装一次，记录报错原文。
2. 两套认证：分别用 `sudo mariadb`、`mariadb -u root -p`、`mariadb -u root` 尝试登录，解释三次结果差异。
3. 建库建号：按正文四条原则建 `app` 库与 `app@localhost` 账号，用 `mariadb -u app -p app -e 'SELECT 1'` 验证；再试 `mariadb -u app -p -h 127.0.0.1` 观察是否可连。
4. 字符集验证：插入一条含 emoji 的记录，用 `SHOW VARIABLES LIKE 'character_set%'` 证明是 `utf8mb4`。
5. 备份恢复：造 100 行数据 → `sudo mariadb-dump` → 删除库 → 重建空库 → `sudo mariadb app < app.sql` 导入 → 校验行数与内容一致；再试一次不带 `--single-transaction` 的导出，说明差别。
6. 四层排查：停服务复现 `Connection refused`；用 `ss -tlnp` 确认当前监听地址并写出应加的 `bind-address` 配置行（不实际改）；建一个 host 不匹配的账号复现 `Access denied`，从日志里找到对应行。

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
