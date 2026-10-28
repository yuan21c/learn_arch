# 第 33 章 service 与 timer 实战

service 描述「运行什么」，timer 描述「什么时候运行」。把两者配成一对，就能用 systemd 替代 cron 做定期维护。本章以一个真实任务——每周清理 pacman 缓存——走完编写、启用、验证和排错的完整流程。

> 本章目标：能独立编写 service 与 timer，正确启用定时任务，并用 systemd 自带工具验证时间表达式与执行结果。
> 对应 Wiki：[systemd/Timers](https://wiki.archlinux.org/title/Systemd/Timers)、[systemd.service](https://wiki.archlinux.org/title/Systemd.service)、[systemd.timer](https://wiki.archlinux.org/title/Systemd.timer)

## Unit 文件结构

一个 service 通常分三段：

| 段          | 作用         | 常见字段                               |
| ----------- | ------------ | -------------------------------------- |
| `[Unit]`    | 描述与依赖   | `Description`、`Wants`、`After`        |
| `[Service]` | 进程如何运行 | `Type`、`ExecStart`、`User`、`Restart` |
| `[Install]` | 如何开机启用 | `WantedBy`                             |

unit 文件放在三个位置：`/usr/lib/systemd/system/` 由软件包提供，`/etc/systemd/system/` 给管理员覆盖，`/run/systemd/system/` 是运行时临时单元。自己写的服务放 `/etc/systemd/system/`。

## Service 关键字段

| 字段               | 含义           | 常用值                                   |
| ------------------ | -------------- | ---------------------------------------- |
| `Type`             | 进程模型       | `simple`、`oneshot`、`notify`、`forking` |
| `ExecStart`        | 启动命令       | 绝对路径加参数                           |
| `User` / `Group`   | 运行身份       | 默认 root                                |
| `WorkingDirectory` | 工作目录       | 绝对路径                                 |
| `Restart`          | 退出后是否重启 | `no`、`on-failure`、`always`             |
| `Environment`      | 环境变量       | `KEY=value` 可写多行                     |

`Type` 的选择：

- `simple`：默认值。进程一启动就算服务已就绪，进程必须留在前台。
- `oneshot`：进程执行完就退出，适合一次性任务；常用于配合 timer。
- `notify`：进程通过 `sd_notify` 报告就绪，适合启动慢但需要精确就绪状态的服务。

`ExecStart` 必须是绝对路径，且不经过 shell：管道、重定向、通配符都不会展开。需要 shell 语法时显式调用 `/bin/bash -c '...'`。只有 `Type=oneshot` 允许多个 `ExecStart`，它们按顺序执行。

```ini
[Service]
Type=simple
User=nobody
WorkingDirectory=/srv/demo
ExecStart=/usr/bin/python -m http.server 8000
Restart=on-failure
Environment=PYTHONUNBUFFERED=1
```

`[Install]` 只在 `enable` 时被读取，决定创建什么自启链接；运行时 systemd 不看这一段。

## Timer 关键字段

| 字段                            | 含义                                  |
| ------------------------------- | ------------------------------------- |
| `OnCalendar`                    | 日历时间表达式                        |
| `OnBootSec` / `OnUnitActiveSec` | 相对启动或上次运行的时间              |
| `Persistent`                    | 错过触发时间后，下次开机补跑          |
| `Unit`                          | 要激活的 service，默认同名 `.service` |
| `AccuracySec`                   | 允许的时间误差，默认 1 分钟           |

`OnCalendar` 用 `systemd-analyze calendar` 验证，不要凭感觉写：

| 写法             | 含义         |
| ---------------- | ------------ |
| `daily`          | 每天 00:00   |
| `weekly`         | 每周一 00:00 |
| `Mon..Fri 09:00` | 工作日 09:00 |
| `*-*-* 03:30:00` | 每天 03:30   |
| `*:0/15`         | 每 15 分钟   |

被 timer 触发的 oneshot service **不需要 `[Install]`**、也不单独 enable；常驻服务才需要。timer 的 `[Install]` 段写 `WantedBy=timers.target`，到点后启动同名 service（`Unit=` 可省略）。service 本身不需要 `[Install]`，也不应该单独 `enable`；启用 timer 即可。

## 完整示例：每周清理缓存

`/etc/systemd/system/paccache-clean.service`：

```ini
[Unit]
Description=Clean pacman cache

[Service]
Type=oneshot
ExecStart=/usr/bin/paccache -rk2    # 保留 2 个最新版本，其余旧包缓存被删除
```

`/etc/systemd/system/paccache-clean.timer`：

```ini
[Unit]
Description=Weekly pacman cache cleanup

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now paccache-clean.timer
systemctl list-timers paccache-clean.timer
# NEXT                        LEFT     LAST                        PASSED  UNIT
# Mon 2026-11-02 00:00:00 CST 6 days   Mon 2026-10-26 00:00:00 CST 1 day   paccache-clean.timer
```

注意：`pacman-contrib` 自带 `paccache.service` 与 `paccache.timer`，放在 `/usr/lib/systemd/system/`，默认未启用。示例改用 `paccache-clean.*`，是为了避免在 `/etc` 下创建同名单元覆盖软件包文件。如果只需要默认的清理策略，直接 `sudo systemctl enable --now paccache.timer` 即可。

启用后手动触发一次，确认服务本身能跑：

```bash
sudo systemctl start paccache-clean.service
sudo journalctl -u paccache-clean.service -b --no-pager -n 20
```

## 验证工具

```bash
systemd-analyze calendar weekly
#   Original form: weekly
# Normalized form: Mon *-*-* 00:00:00
#     Next elapse: Mon 2026-11-02 00:00:00 CST

systemctl list-timers
# 列出所有 timer 的 NEXT、LEFT、LAST、PASSED 与激活的 unit
```

`systemd-analyze calendar` 会同时给出规范化形式与下一次触发时间，写错表达式时会直接报错。`list-timers` 为空通常意味着 timer 没有 enable，或 unit 文件名拼错。

## 常见错误

| 现象                   | 原因                           | 处理                           |
| ---------------------- | ------------------------------ | ------------------------------ |
| 改了 unit 但行为没变   | 忘记 `daemon-reload`           | 重载后再 `restart`             |
| `list-timers` 没有条目 | timer 未 enable                | `enable --now`                 |
| `status=203/EXEC`      | `ExecStart` 路径错或不可执行   | `command -v` 确认真实路径      |
| 服务从未触发           | `Unit=` 指向了不存在的 service | 检查 timer 的 `Unit=` 与文件名 |
| 开机后错过一次执行     | 未设 `Persistent=true`         | 补上并重载                     |

系统级与用户级是两条并行的路：系统 unit 放 `/etc/systemd/system/`（本章默认，`systemctl` 管理）；用户 unit 放 `~/.config/systemd/user/`（`systemctl --user` 管理），且要 `sudo loginctl enable-linger` 才能在没有登录会话时保持运行——第 46 章会用它托管应用。

## 小结

- service 三段式：`[Unit]` 描述依赖，`[Service]` 定义进程，`[Install]` 决定自启。
- `Type=oneshot` 适合一次性任务，`simple` 适合常驻进程，`notify` 用于精确就绪。
- `ExecStart` 必须用绝对路径且不经过 shell。
- timer 用 `OnCalendar` 定时，`Persistent=true` 补跑错过的任务。
- 启用 timer 而不是 service；service 不必写 `[Install]`。
- 验证顺序：`systemd-analyze calendar`、`daemon-reload`、`enable --now`、`list-timers`、`journalctl`。

## 练习

1. 写一个 oneshot service，把当前时间追加到 `/var/log/demo-time.log`，手动启动并查看日志。（环境：WSL）
2. 给它配一个每 15 分钟触发一次的 timer，用 `systemd-analyze calendar '*:0/15'` 验证。（环境：WSL）
3. 启用 timer，用 `list-timers` 记录 NEXT 时间；等待触发后用 journalctl 确认执行。（环境：WSL）
4. 故意把 `ExecStart` 写成不存在的路径，观察 `status` 与 journalctl 的报错，再修复。（环境：WSL）

## 自检

- [ ] 能写出包含三段的最小 service
- [ ] 能解释 `simple`、`oneshot`、`notify` 的差别
- [ ] 知道 `ExecStart` 为什么不支持 shell 管道
- [ ] 能写出 timer 并用 `systemd-analyze calendar` 验证
- [ ] 知道启用 timer 后 service 如何被触发
- [ ] 能用手册和日志定位 timer 不触发的原因

## 参考

- [systemd/Timers](https://wiki.archlinux.org/title/Systemd/Timers)
- [systemd.service](https://wiki.archlinux.org/title/Systemd.service)
