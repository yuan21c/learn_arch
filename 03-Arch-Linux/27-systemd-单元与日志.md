# 第 27 章 systemd 单元与日志

systemd 是 Arch 的 PID 1，负责启动服务、挂载、定时任务和日志。它把「系统里要运行的东西」抽象成 unit，再用依赖关系组织启动顺序。学会看 unit、改 unit、查日志，就掌握了 Arch 系统管理的主干。

> 本章目标：理解 unit 类型与依赖关系，熟练管理服务生命周期，并能用 journalctl 定位一个 failed unit 的根因。
> 对应 Wiki：[systemd](https://wiki.archlinux.org/title/Systemd)、[systemd/Journal](https://wiki.archlinux.org/title/Systemd/Journal)

## systemd 是 PID 1

```bash
ps -p 1 -o comm=
# systemd
systemctl is-system-running
# running
```

systemd 启动后接管服务、socket、定时器、挂载点和日志。service 与 timer 的编写见 [service 与 timer 实战](28-service-与-timer-实战.md)。

在 WSL 中，PID 1 不是 systemd 时，先检查 `/etc/wsl.conf` 的 `[boot] systemd=true`，再在 Windows 侧执行 `wsl --shutdown` 重进系统。初始化步骤见 [首次启动与 systemd](21-首次启动与-systemd.md)。

## Unit 类型

unit 的名字后缀决定类型：

| 后缀       | 类型   | 用途                  | 例子                |
| ---------- | ------ | --------------------- | ------------------- |
| `.service` | 服务   | 启动一个进程          | `sshd.service`      |
| `.timer`   | 定时器 | 按时间激活另一个 unit | `paccache.timer`    |
| `.target`  | 目标   | 把多个 unit 编成一组  | `multi-user.target` |
| `.socket`  | 套接字 | 按连接激活服务        | `sshd.socket`       |
| `.mount`   | 挂载   | 管理挂载点            | `-.mount`           |
| `.slice`   | 资源组 | cgroup 资源划分       | `user.slice`        |

## 生命周期

| 命令                          | 作用                   |
| ----------------------------- | ---------------------- |
| `systemctl status 单元`       | 状态、主进程、最近日志 |
| `systemctl start 单元`        | 本次启动               |
| `systemctl stop 单元`         | 本次停止               |
| `systemctl restart 单元`      | 停止再启动             |
| `systemctl reload 单元`       | 让服务重读自身配置     |
| `systemctl enable 单元`       | 设置开机自启           |
| `systemctl disable 单元`      | 取消开机自启           |
| `systemctl enable --now 单元` | 启用并立即启动         |
| `systemctl mask 单元`         | 彻底禁止启动           |

`enable` 与 `start` 是两件事：`enable` 只按 `[Install]` 段创建开机自启的符号链接，不改变当前运行状态；`start` 只影响当前，不会让服务在下次开机自动运行。排查「改了配置但没生效」时，先确认服务是否真的重启过。

`disable` 只删除自启链接，手动或依赖仍能启动它。`mask` 把 unit 链到 `/dev/null`，任何方式都无法启动，适合彻底禁用一个服务。

```bash
sudo systemctl mask bluetooth.service
# Created symlink /etc/systemd/system/bluetooth.service -> /dev/null
```

## 查看与修改 unit

```bash
systemctl cat sshd.service
# # /usr/lib/systemd/system/sshd.service
# [Unit]
# Description=OpenSSH Daemon
```

```bash
sudo systemctl edit sshd.service
# 创建 /etc/systemd/system/sshd.service.d/override.conf
sudo systemctl edit --full sshd.service
# 把完整 unit 复制到 /etc/systemd/system/sshd.service
sudo systemctl daemon-reload
```

`edit` 创建 drop-in，只写要覆盖的字段；`--full` 复制整个 unit 再改，升级软件包时不会自动合并新版本，长期维护更麻烦。优先级为 `/etc` > `/run` > `/usr/lib`，drop-in 目录是 `<unit>.d/*.conf`。

修改 unit 文件后必须 `daemon-reload`，否则 systemd 仍使用内存中的旧定义。`daemon-reload` 不会重启服务，需要再 `systemctl restart` 才应用新配置。`systemd-delta` 可以列出被覆盖或扩展的 unit。

## 依赖关系

```ini
[Unit]
Description=My backup job
Wants=network-online.target
After=network-online.target
```

- `Wants=`：弱依赖。被依赖的 unit 启动失败，本 unit 仍继续。
- `Requires=`：强依赖。被依赖的 unit 启动失败且存在 `After=` 时，本 unit 不会启动；被依赖的 unit 停止时本 unit 也停止。
- `After=` / `Before=`：只控制顺序，不建立依赖。
- `BindsTo=`：比 `Requires` 更紧，被依赖的 unit 消失或停止时本 unit 也停止。

最常见的组合是 `Wants` + `After`：希望网络就绪，但网络失败也不阻止本服务尝试启动。`network-online.target` 只有在启用等待网络的组件后才有实际意义。

## journalctl

| 命令                              | 作用                     |
| --------------------------------- | ------------------------ |
| `journalctl -b`                   | 本次启动的日志           |
| `journalctl -b -1`                | 上一次启动的日志         |
| `journalctl -u 单元 -b`           | 指定服务的本次启动日志   |
| `journalctl -p err -b`            | 本次启动的错误及以上级别 |
| `journalctl --since "1 hour ago"` | 按时间过滤               |
| `journalctl -f`                   | 实时跟踪新日志           |
| `journalctl -xeu 单元`            | 带解释文本的服务日志     |
| `journalctl --disk-usage`         | 日志占用空间             |
| `journalctl --vacuum-size=200M`   | 收缩到指定大小           |

```bash
sudo journalctl -u sshd.service -b --no-pager -n 20
# 显示本次启动中 sshd 的最后 20 行
sudo journalctl -p err -b --no-pager | tail -n 5
sudo journalctl --disk-usage
# Archived and active journals take up 312.4M in the file system.
```

`-b -1` 能否看到上一次启动，取决于日志是否持久化。日志存储位置由 `/etc/systemd/journald.conf` 与 `/var/log/journal` 是否存在决定；如果只有内存日志，重启后旧启动记录会消失。

> **危险**：`journalctl --vacuum-size` 和 `--vacuum-time` 会永久删除历史日志。排障期间先确认需要的记录已导出，再收缩。

## failed unit 排障

按固定顺序走，避免东看一点西看一点：

1. `systemctl --failed` 找出失败单元。
2. `systemctl status 单元` 看退出码、主 PID 和最后几行日志。
3. `journalctl -xeu 单元 -b --no-pager` 看完整错误与解释。
4. `systemctl cat 单元` 确认实际生效的配置与 drop-in。
5. 检查 `ExecStart` 路径是否存在、是否可执行，`User` 是否有权限访问工作目录。
6. `systemd-analyze verify /etc/systemd/system/单元` 检查语法，修改后 `daemon-reload` 并 `restart`，重新看 `status`。

```bash
systemctl --failed
# UNIT              LOAD   ACTIVE SUB    DESCRIPTION
# demo.service      loaded failed failed Demo service

journalctl -u demo.service -b --no-pager -n 30
# demo.service: Main process exited, code=exited, status=203/EXEC
```

`status=203/EXEC` 通常表示可执行文件不存在或不可执行；`status=1` 表示程序自己返回了错误；`status=217/USER` 表示指定的用户不存在。先修根因，不要用 `Restart=always` 掩盖。

## 小结

- systemd 是 PID 1，unit 用后缀区分 service、timer、target、socket 等类型。
- `enable` 管开机自启，`start` 管当前运行；`mask` 比 `disable` 更彻底。
- 改 unit 后先 `daemon-reload`，再 `restart`；drop-in 放在 `<unit>.d/` 下。
- `Wants` 是弱依赖，`Requires` 是强依赖，`After`/`Before` 只管顺序。
- `journalctl -b`、`-u`、`-p err`、`--since` 是排障的四个基本过滤。
- failed unit 按 status、journal、配置、路径权限、语法的顺序排查。

## 练习

1. 用 `systemctl cat` 查看一个系统服务，指出它的 unit 文件来自哪个目录。
2. 用 `systemctl edit` 给一个测试服务加一行 `Environment=DEMO=1`，daemon-reload 后重启并验证。
3. 用 `journalctl -u` 查看该服务的日志，再用 `-p err -b` 查看系统错误。
4. 用 `systemctl mask` 禁用一个不需要的服务，重启后确认它没有运行，再 `unmask`。

## 自检

- [ ] 能说出至少五种 unit 类型及用途
- [ ] 能解释 `enable`、`start`、`mask` 的区别
- [ ] 知道 `daemon-reload` 与 `restart` 各做什么
- [ ] 能解释 `Wants`、`Requires`、`After` 的差别
- [ ] 能用 journalctl 按启动、服务、级别、时间过滤
- [ ] 能按顺序定位一个 failed unit

## 参考

- [systemd](https://wiki.archlinux.org/title/Systemd)
- [systemd/Journal](https://wiki.archlinux.org/title/Systemd/Journal)
