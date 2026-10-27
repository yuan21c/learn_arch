# 第 44 章 数据库：PostgreSQL

MariaDB 与 PostgreSQL 的安装流程形状相同，但**认证模型、权限模型、备份方式**三处差别很大，照搬 MariaDB 的命令一定踩坑。本章按同样的六步走一遍，并在每一步点出与第 43 章的差异。

> 本章目标：能初始化 PostgreSQL 集群并交给 systemd 托管；理解 `initdb` 与服务用户 `postgres` 的关系；会建角色与库、理解 `pg_hba.conf` 的认证规则；能用 `pg_dump -Fc` 备份、`pg_restore` 恢复到新库并验证；能区分「连不上」与「权限不足」两类错误并从日志定位。
> 对应 Wiki：[PostgreSQL](https://wiki.archlinux.org/title/PostgreSQL)

## 安装与初始化

（环境：WSL）

```bash
sudo pacman -S postgresql
sudo -u postgres initdb -D /var/lib/postgres/data
sudo systemctl enable --now postgresql
systemctl status postgresql
```

三处与 MariaDB 不同：

- **初始化由服务用户执行**：`postgres` 用户在装包时创建，`initdb` 必须以它身份运行（root 执行会被拒绝）。数据目录是 `/var/lib/postgres/data`。
- **没有「安全初始化」脚本**：PostgreSQL 的初始配置本来就是收紧的（只监听本机、认证规则明确），不需要 `xxx-secure-installation`。
- **一个实例 = 一个数据目录（cluster）**：要跑多个版本或多个实例，就得建多个目录并在 `postgresql.service` 之外用 `postgresql@.service` 或独立 unit 托管。

`initdb` 时若 locale 报错，是因为系统 locale 与环境不一致；用 `--locale=C.UTF-8` 或先配好 locale 再初始化。这一步只做一次，重做会清空数据。

## 角色、库与权限

PostgreSQL 把「用户」叫**角色（role）**，角色可以登录（`LOGIN`）、可以有超级权限（`SUPERUSER`）：

```bash
sudo -u postgres psql
```

```sql
CREATE ROLE app LOGIN PASSWORD '强密码放这里';
CREATE DATABASE app OWNER app;
\q
```

与 MariaDB 的关键差异：

| 概念 | MariaDB | PostgreSQL |
| --- | --- | --- |
| 用户 | `'app'@'host'`（用户名 + 来源） | `app`（角色），来源由 `pg_hba.conf` 决定 |
| 权限授予 | `GRANT ... ON db.*` | `GRANT ... ON 对象`（表、序列、schema），库级只有 `CONNECT` |
| 默认权限 | 新库对应用户可见 | 新库属主才有完整权限，其他人默认只能连不能读 |
| 超级用户 | `root@localhost` | `postgres` |

这意味着「建了库、建了角色，应用还是读不到表」是正常现象：表属于谁、`search_path` 指向哪个 schema、有没有 `USAGE` 权限，三件事都要给。生产实践是**让应用角色拥有自己的 schema**，或把表的属主设为应用角色。

## 认证：pg_hba.conf 决定谁能连

PostgreSQL 的每条连接都要过 `pg_hba.conf`（在数据目录下），规则自上而下匹配：

```text
# TYPE  DATABASE  USER  ADDRESS       METHOD
local   all       all                 peer
host    all       all   127.0.0.1/32  scram-sha-256
host    all       all   ::1/128       scram-sha-256
```

- `local` 是 Unix socket 连接，`peer` 表示「操作系统用户名必须等于数据库角色名」——所以 `sudo -u postgres psql` 能免密，而 `psql -U app` 不行。
- `host` 是 TCP 连接，现代 `initdb` 默认用 `scram-sha-256`（密码挑战应答，比 `md5` 安全）。
- **改完要 `systemctl reload postgresql`**，不是 restart。

监听地址由 `postgresql.conf` 的 `listen_addresses` 控制，默认 `'localhost'`。开远程访问同样要三件套：改 `listen_addresses`、在 `pg_hba.conf` 加带网段的 `host` 规则、放行防火墙。

## 备份与恢复

PostgreSQL 的备份逻辑更简单也更可靠：`pg_dump` 默认在**单个事务里**取一致性快照，不需要额外开关：

```bash
pg_dump -Fc -f app.dump app              # 自定义格式，支持并行恢复与选择性恢复
pg_dump -Fp -f app.sql app               # 纯 SQL，便于人读与跨版本查看
pg_dumpall --globals-only -f roles.sql   # 角色与权限单独备份
```

恢复：

```bash
createdb -O app app2
pg_restore -d app2 app.dump
```

三个容易踩的点：

- **`pg_dump` 不导出角色**，只导出对象；换实例恢复时要先 `roles.sql`，否则对象属主不存在。
- **版本兼容是单向的**：低版本 `pg_dump` 不能导入高版本实例；升级大版本要用 `pg_upgrade` 或「导出 → 新集群 → 导入」。
- **验证同样不可省**：把 dump 恢复到 `app2`，跑关键表的 `COUNT(*)` 与一条业务查询，才算备份可用。

物理级备份（`pg_basebackup`）与 WAL 归档属于生产级方案，学习阶段用 `pg_dump` 足够。

## 运维要点

```bash
sudo -u postgres psql -c '\l'                     # 列出库
sudo -u postgres psql -c '\du'                    # 列出角色
sudo -u postgres psql -c 'SELECT * FROM pg_stat_activity;'
sudo journalctl -u postgresql -b --no-pager | tail -30
```

`pg_stat_activity` 是 PostgreSQL 最好用的排障入口：谁连着、在跑什么 SQL、等了多久、状态是 `active` 还是 `idle in transaction`。**长时间 `idle in transaction`** 是连接池配置不当的典型症状，会拖住 vacuum。

两个基础参数（`postgresql.conf`）：`shared_buffers`（内存的约 25%）与 `max_connections`（配合连接池）。PostgreSQL 的默认值相当保守，是为了能装在任何机器上，不是为生产调好的。

## 小结

- `initdb` 必须以 `postgres` 用户执行，只做一次；数据目录即一个集群。
- 没有安全初始化脚本，因为默认配置已经收紧；角色可登录，库要显式授权。
- 连接能否成功由 `pg_hba.conf` 决定（`peer` vs `scram-sha-256`），改完 `reload`。
- `pg_dump -Fc` 默认一致性快照；备份要连角色一起（`pg_dumpall --globals-only`），并实际恢复验证。
- `pg_stat_activity` 是排障首选；先调 `shared_buffers` 与 `max_connections`。

## 练习

1. 初始化（环境：WSL）：完成安装与 `initdb`，用 `sudo -u postgres psql -c 'SELECT version()'` 验证；再以 root 身份直接跑一次 `initdb`，记录拒绝信息。
2. 三种登录（环境：WSL）：分别用 `sudo -u postgres psql`、`psql -U app -h 127.0.0.1`、`psql -U app`（socket）尝试，对照 `pg_hba.conf` 解释结果。
3. 建角色建库（环境：WSL）：建 `app` 角色与 `app` 库，建一张表并插入数据；再换一个只能连不能读的角色，验证「连上但查不到表」。
4. 权限细节（环境：WSL）：把表属主改为 `app`，或给 `app` 授 `USAGE ON SCHEMA public` + `SELECT ON ALL TABLES`，验证读权限恢复。
5. 备份恢复（环境：WSL）：`pg_dump -Fc` → `createdb app2` → `pg_restore -d app2` → 校验行数；再用 `pg_dumpall --globals-only` 导出角色，说明为什么换实例必须先恢复它。
6. 活动会话（环境：WSL）：开两个 `psql` 会话，一个执行 `BEGIN; SELECT 1;` 后挂起，用 `pg_stat_activity` 找出 `idle in transaction` 的连接与停留时间。

## 自检

- [ ] 能说出 `initdb` 必须由谁执行、只做几次、数据目录在哪
- [ ] 能解释为什么 PostgreSQL 不需要「安全初始化」脚本
- [ ] 能说清角色、库、schema、表属主四者的权限关系
- [ ] 能读懂 `pg_hba.conf` 的 `peer` 与 `scram-sha-256`，并知道改完要 `reload`
- [ ] 能写出 `pg_dump -Fc` 与 `pg_restore` 的完整备份恢复流程，并说明角色为什么要单独备份
- [ ] 会用 `pg_stat_activity` 找出长事务与连接堆积

## 参考

- [PostgreSQL](https://wiki.archlinux.org/title/PostgreSQL)
- [PostgreSQL 官方文档](https://www.postgresql.org/docs/)
- [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)
