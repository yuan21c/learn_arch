# 第 9 章 sudo 与提权安全

第 8 章用两行授权模板让 `sudo` 跑起来，本章把它讲透：`/etc/sudoers` 每一段是什么、怎么把授权拆进 drop-in 文件、`Defaults` 与别名能精细到什么程度，以及免密授权到底打开了什么风险。会配 `sudo` 是日常，配得**收得回、查得到**才是提权安全。

> 本章目标：能读懂并编写 sudoers 授权行；会用 `/etc/sudoers.d/` drop-in 与 `visudo -f` 安全修改；掌握 `Defaults`、`Cmnd_Alias` 与 `sudo -u/-i/-l/-k/-v`；知道 `NOPASSWD` 的风险边界与审计入口。
> 对应 Wiki：[Sudo](https://wiki.archlinux.org/title/Sudo)

## sudoers 语法四段

一条授权行的骨架是「**谁 在哪台机器 =（以谁的身份）标签: 命令**」：

```text
# /etc/sudoers 片段
root    ALL=(ALL:ALL)   ALL
%wheel  ALL=(ALL:ALL)   ALL
```

| 段        | 含义                            | 取值示例                           |
| --------- | ------------------------------- | ---------------------------------- |
| who       | 用户或 `%组`                    | `alice`、`%wheel`                  |
| where     | 从哪些主机生效（单机恒 `ALL`）  | `ALL`                              |
| =（whom） | 可伪装的用户:组，省略即 root    | `(ALL:ALL)`、`(postgres:postgres)` |
| 标签      | 可选，`NOPASSWD:`、`SETENV:` 等 | `NOPASSWD:`                        |
| commands  | 允许的命令路径，可带参数白名单  | `/usr/bin/systemctl`               |

发行版默认**只启用需密码那一行**（`%wheel ALL=(ALL:ALL) ALL`）；`NOPASSWD` 版本保持注释。Debian/Ubuntu 没有 `%wheel`，对应的是 `%sudo`——跨发行版迁移 sudoers 时先核对组名。

> **危险**：`NOPASSWD: ALL` 等于把「偷到这个用户的会话」升级成「拿到 root」。免密只给按命令、按机器拆好的窄授权，永远不要给 `ALL`。

## drop-in：把授权拆进 /etc/sudoers.d

主文件保持出厂状态，自定义授权放 `/etc/sudoers.d/`，一服务一文件、可单独回滚：

```bash
# 环境：WSL，需 sudo
sudo visudo -f /etc/sudoers.d/lab-deploy      # 语法检查版的编辑入口
sudo chown root:root /etc/sudoers.d/lab-deploy
sudo chmod 0440 /etc/sudoers.d/lab-deploy
sudo visudo -c                                 # 预期：parsed OK
sudo -l                                        # 验证当前用户看到的授权
```

三个硬规则：属主必须是 root、权限 0440；文件名不要带 `.`、不要以 `~` 结尾（sudo 会跳过这类文件）；`visudo -f` 是否自动设置权限随版本而定，**改完显式 `chown`/`chmod` 再用 `sudo -l` 验证**最稳。`visudo` 的保护是：语法错误不会落盘，并进入 `What now?` 询问——选 `e` 回去重编辑，不要选 `Q` 丢弃后盲改。

## Defaults 与别名

`Defaults` 调整行为，别名把授权打包复用：

```text
Defaults timestamp_timeout=2        # 免密缓存 2 分钟（默认 5）
Defaults secure_path="/usr/local/sbin:/usr/local/bin:/usr/bin"
Cmnd_Alias SERVICES = /usr/bin/systemctl start nginx, /usr/bin/systemctl stop nginx
Cmnd_Alias DB_DUMP  = /usr/bin/mariadb-dump, /usr/bin/pg_dump
%deploy ALL=(root) NOPASSWD: SERVICES
```

`secure_path` 解释了「sudo 里找不到刚装的命令」：sudo 按固定 PATH 找命令，你 shell 里的 `~/.local/bin` 不在其中——把工具装进 `/usr/local/bin`，不要让 root 去执行用户可写的目录里的程序。`User_Alias`/`Host_Alias` 同理，把多用户、多机器的授权写成一行。

## 日常动词：-u、-i、-l、-k、-v、-e

| 命令                    | 作用                                                    |
| ----------------------- | ------------------------------------------------------- |
| `sudo -u postgres psql` | 以指定用户身份执行（不一定是 root）                     |
| `sudo -i`               | 开目标用户的登录 shell（环境整个切换）                  |
| `sudo -l`               | 列出自己被允许的命令；root 可 `sudo -l -U alice` 查别人 |
| `sudo -k`               | 作废免密缓存，下次重新要密码                            |
| `sudo -v`               | 提前续上免密计时（脚本开头常用）                        |
| `sudo -e file`          | 用自己熟悉的编辑器改文件，落盘走 sudo                   |

`sudo 命令` 与 `sudo -i` 的差别在环境：前者保留大部分调用者环境变量（配合 `secure_path`），后者重置为目标用户的完整登录环境。脚本里跑 `sudo` 优先写绝对路径命令，绕开 PATH 与别名歧义；`sudo -v` 建议放在脚本开头，避免中途弹密码打断无人值守流程。

## 审计：谁在什么时候以谁的身份做了什么

sudo 的每次调用都进日志，比 shell 历史可靠得多：

```bash
# 环境：WSL
journalctl -t sudo -n 10        # 会话开通/关闭记录
journalctl _COMM=sudo -o cat | tail
```

审计三件套建议常开：`journalctl -t sudo` 查会话、`sudo -l` 定期导出授权清单、drop-in 文件纳入版本管理。出了安全事故，这三样能回答「谁能提权、当时执行了什么」。另注意 `sudo` 默认不记录按键、只记录命令行；对高敏机器可配 `Defaults log_input,log_output` 留存完整会话（以 Wiki 为准）。

> **危险**：改 sudoers 的标准流程——保留一个已登录会话不退出 → `visudo`/`visudo -f` 修改 → `visudo -c` 校验 → 新会话 `sudo -l` 验证 → 收工。直接 `vim /etc/sudoers` 改坏一个字，所有 `sudo` 立刻失灵；这时靠已登录的 root 会话或 `su -` 兜底，而不是重装系统。

## 与第 27 章的分工

第 27 章（Arch 的用户、sudo 与默认 shell）讲 Arch 上怎么把用户加进 `wheel`、怎么落 drop-in 让它生效，是动手路径；本章是 sudoers 的语法与安全模型。两边的实验互相独立，授权条目不要照抄——先想清楚「这个用户需要哪条命令」，再写最小授权。

## 小结

- sudoers 行 = 谁 在哪 =（以谁）标签: 命令；默认只启用需密码的 `%wheel`，Ubuntu/Debian 用 `%sudo`。
- 自定义授权进 `/etc/sudoers.d/`：root 属主、0440、文件名不带 `.`，`visudo -c` + `sudo -l` 双验证。
- `Defaults` 管缓存与 PATH（`secure_path`），`Cmnd_Alias` 把命令打包成最小授权。
- `NOPASSWD: ALL` 是提权安全的反面教材；免密只配窄命令。
- 审计靠 `journalctl -t sudo`、`sudo -l` 清单与 drop-in 版本管理三件套。
- 提权不等于变 root：`sudo -u` 指定的最小身份，往往才是服务命令真正需要的。

## 练习

1. 读懂练习：给出行 `%backup ALL=(postgres) NOPASSWD: /usr/bin/pg_dump`，逐段解释含义（环境：阅读题）。
2. 建 drop-in `/etc/sudoers.d/lab-deploy`，授权自己免密执行 `Cmnd_Alias` 中的两条 `systemctl` 命令，按标准流程验证（环境：WSL，需 sudo；预期：`sudo -l` 显示该别名，`visudo -c` 输出 parsed OK）。
3. 对比 `sudo env | grep -E '^(HOME|USER|PATH)'` 与 `sudo -i env | grep -E '^(HOME|USER|PATH)'` 的输出差异并解释（环境：WSL；预期：HOME/USER 或 PATH 至少一处不同）。
4. 用 `journalctl -t sudo -n 5` 找出自己最近一次提权记录，指出 real/effective 身份各是谁（环境：WSL；预期：日志含 uid 信息）。
5. 阅读题：解释为什么 `NOPASSWD: ALL` 比共享 root 密码好不了多少（环境：阅读题）。

## 自检

- [ ] 能独立读懂任意 sudoers 授权行的五段
- [ ] 会用 drop-in + `visudo -f` 安全修改授权并验证
- [ ] 知道 `secure_path` 与「sudo 找不到命令」的关系
- [ ] 能用 `Cmnd_Alias` 写出最小授权
- [ ] 能说出免密授权的风险边界与审计三件套
- [ ] 知道 `sudo -v`/`sudo -k` 对免密缓存的作用

## 参考

- [Sudo](https://wiki.archlinux.org/title/Sudo)
- [Polkit](https://wiki.archlinux.org/title/Polkit)
- [File permissions and attributes](https://wiki.archlinux.org/title/File_permissions_and_attributes)
