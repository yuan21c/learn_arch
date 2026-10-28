# 第 46 章 用 systemd 托管你的应用

篇二第 21 章讲过「为什么 `nohup app &` 不算部署」，第 32-33 章讲了单元文件的结构与 service/timer 的写法。这一章把两者接上：**把你自己的程序变成一个真正的服务**——开机自启、崩溃重启、日志进 journal、权限最小化。这是第四篇所有应用（Web、数据库、容器）共用的地基。

> 本章目标：能把一个前台程序写成 service 单元并让它稳定运行；分清 `Type=simple/forking/oneshot/notify` 的适用场景；会用 `EnvironmentFile` 管理配置与密钥；会用 `User=`、`WorkingDirectory=` 与基础加固指令限制影响面；能用 `systemctl cat/edit`、`journalctl -u`、`systemd-analyze verify` 排查单元问题；知道用户级服务与 `linger` 的用途。
> 对应 Wiki：[Systemd](https://wiki.archlinux.org/title/Systemd)、[Systemd/User](https://wiki.archlinux.org/title/Systemd/User)

## 从 nohup 到 unit：差别在哪

| 维度 | `nohup app &` | systemd 单元 |
| --- | --- | --- |
| 开机自启 | 不能 | `enable` 后自动 |
| 崩溃重启 | 不能 | `Restart=on-failure` |
| 日志 | 自己写到文件，容易丢 | 自动进 journal，`journalctl -u` 可查 |
| 运行身份 | 当前用户 | `User=` 显式指定 |
| 依赖顺序 | 无 | `After=`/`Wants=` 声明 |
| 状态查询 | `ps` 里找 PID | `systemctl status` 给出结果与退出码 |

后五项才是「部署」与「临时跑一下」的真正分界线。

## 一个最小可用的 service

假设应用是 `/opt/demo/app.py`，用 `/opt/demo/venv/bin/python` 运行、监听 8000（环境：WSL，需 root）。先造出 unit 里引用的运行身份与目录——`User=demo` 不存在时 `enable --now` 会报 `status=217/USER`，练习直接卡死：

```bash
sudo useradd --system --user-group --home-dir /opt/demo --shell /usr/sbin/nologin demo
sudo install -d -o demo -g demo /opt/demo
id demo            # 预期：uid=…(demo) gid=…(demo)
ls -ld /opt/demo   # 预期：属主属组均为 demo
```

```ini
# /etc/systemd/system/demo.service
[Unit]
Description=Demo web app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=demo
Group=demo
WorkingDirectory=/opt/demo
EnvironmentFile=/etc/demo/env
ExecStart=/opt/demo/venv/bin/python /opt/demo/app.py
Restart=on-failure
RestartSec=3s

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload        # 新建/修改单元后必须执行
sudo systemctl enable --now demo    # 开机自启并立即启动
systemctl status demo
journalctl -u demo -b --no-pager | tail -20
```

三段的分工：`[Unit]` 描述「它是什么、和谁有依赖」，`[Service]` 描述「怎么跑」，`[Install]` 描述「enable 时挂到哪个目标下」。`After=` 只保证顺序，不保证对方成功；要强依赖用 `Requires=`（第 32 章）。

## 四种启动类型

`Type=` 写错是「服务启动了但 systemd 认为失败/还在启动」的常见原因：

| 类型 | 含义 | 适用 |
| --- | --- | --- |
| `simple` | `ExecStart` 的进程一直前台运行（默认） | 绝大多数现代应用 |
| `forking` | 进程自己 `fork` 到后台，父进程退出 | 传统守护进程 |
| `oneshot` | 跑完就退出，退出即成功 | 初始化、迁移脚本 |
| `notify` | 程序通过 `sd_notify` 告诉 systemd「我准备好了」 | 支持 systemd 通知的服务 |
| `exec` | 像 `simple`，但等 `exec()` 成功后才算启动 | 需要精确判断启动失败 |

判断方法：程序**是否自己后台化**。现代框架（Gunicorn 的 `--daemon` 除外、Node、Go、Spring Boot）默认前台运行，用 `simple`；老式服务用 `forking` 并配 `PIDFile=`。不确定时先在前台手工跑一次，看它是否立刻返回。

## 配置与密钥：EnvironmentFile

不要把数据库密码写进 unit 文件——unit 在 `/etc/systemd/system` 下，任何能读它的人都能看到，而且容易随版本管理泄漏。

```bash
sudo install -d -m 700 /etc/demo
sudo install -m 600 /dev/null /etc/demo/env
sudo tee /etc/demo/env >/dev/null <<'EOF'
APP_PORT=8000
DATABASE_URL=postgresql://app@localhost/app
EOF
```

`EnvironmentFile` 的格式是 `KEY=value`，**不要加 `export`**，不要用引号包整个值（除非值里真有空格）；systemd 会做变量展开。少数场景需要 `Environment="KEY=value"` 直接写在 unit 里（非敏感、固定值）。

改完环境文件后 `systemctl restart demo` 生效——`daemon-reload` 只重读 unit，不重读环境文件。

## 运行身份与工作目录

三条原则：

- **`User=`/`Group=` 必须显式给**，否则以 root 运行——这是「一个 Web 漏洞变成整机失守」的起点。
- **`WorkingDirectory=` 用绝对路径**，不要依赖默认值。
- **目录权限要对齐**：`User=demo` 时，`/opt/demo` 与数据目录必须让 `demo` 可读可写，否则报 `Permission denied`（日志里很清楚，但容易被当成代码 bug）。

需要「用完即弃」的系统用户时，可用 `DynamicUser=yes`：systemd 在启动时动态分配 UID/GID，停止后回收；配合 `StateDirectory=`/`CacheDirectory=` 会自动创建并赋权的 `/var/lib/私有名`、`/var/cache/私有名`。

## 日志与排障

```bash
systemctl cat demo              # 看最终生效的单元（含 drop-in）
sudo systemctl edit demo         # 只写覆盖片段，生成 /etc/systemd/system/demo.service.d/override.conf
systemd-analyze verify /etc/systemd/system/demo.service   # 静态检查语法与可执行文件
journalctl -u demo -b -p err    # 本次启动的错误
```

排障顺序与第 21 章一致，但多了两个 systemd 特有的坑：

- **改了 unit 没 `daemon-reload`**：`systemctl restart` 用的还是旧定义；
- **`ExecStart` 路径不存在**：状态显示 `status=203/EXEC`，日志里只有一行，很容易误判成程序崩溃。

## 最小加固：四条指令

服务以普通用户跑只是第一层。再加四条就能挡住很大一类提权路径（环境：WSL，写在 `[Service]` 段）：

```ini
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/demo
```

含义：禁止通过 setuid 提权；给服务一个独立的 `/tmp`；把 `/usr`、`/boot`、`/etc` 挂成只读；只把真正需要写的数据目录放开。`ProtectHome=yes` 会隐藏 `/home`、`/root`，对纯服务端应用通常可以直接开。第 53 章会把它们放进完整的安全加固清单。

## 用户级服务

不想用 root 管理自己的开发服务时，用**用户级 systemd**（`systemctl --user`）：

```bash
mkdir -p ~/.config/systemd/user
# 写 ~/.config/systemd/user/dev.service，[Install] 段用 default.target
systemctl --user daemon-reload
systemctl --user enable --now dev
journalctl --user -u dev
```

默认情况下用户级服务在你**登录期间**运行，退出登录就停。要让它在没登录时也跑：

```bash
loginctl enable-linger "$USER"
```

用户级服务适合个人开发环境；面向他人提供的服务仍应放在系统级，由 root 管理、绑定专用用户。

## 小结

- 部署 = 开机自启 + 失败重启 + 日志进 journal + 显式运行身份 + 依赖声明；`nohup` 只做到「进程还在」。
- 单元三段：`[Unit]` 依赖、`[Service]` 怎么跑、`[Install]` 挂到哪个 target。
- `Type=` 按「程序是否自己后台化」选：现代应用多为 `simple`，传统守护进程 `forking`。
- 密钥放 `EnvironmentFile`（`0600`、`0700` 目录），改完要 `restart` 而不是只 `daemon-reload`。
- `User=` 必须显式；`DynamicUser=` + `StateDirectory=` 可做无状态服务。
- 四条加固：`NoNewPrivileges`、`PrivateTmp`、`ProtectSystem=strict`、`ReadWritePaths`。

## 练习

1. 最小服务（环境：WSL）：写一个每 5 秒往日志打印一行时间的脚本，做成 `demo.service`，`enable --now` 后用 `journalctl -u demo -f` 观察；再 `kill -9` 主进程，验证 `Restart=on-failure` 把你救回来。
2. Type 选择（环境：WSL）：分别用 `Type=simple` 与 `Type=oneshot` 跑同一个「执行完就退出」的脚本，观察 `systemctl status` 的差异，解释为什么 oneshot 适合初始化脚本。
3. 环境文件（环境：WSL）：把端口从 `Environment=` 挪到 `/etc/demo/env`，验证 `systemctl restart` 后端口真的变了；再只做 `daemon-reload`，确认端口不变。
4. 身份与权限（环境：WSL）：用 `User=nobody` 运行一个需要写 `/opt/demo/data` 的服务，故意不给写权限，从日志里找出 `Permission denied` 并修正。
5. 加固对比（环境：WSL）：给服务加 `ProtectSystem=strict` 但不加 `ReadWritePaths`，观察写入失败；再补上 `ReadWritePaths`，确认恢复。
6. 用户级服务（环境：WSL）：在 `~/.config/systemd/user` 写一个服务，`systemctl --user enable --now` 并 `loginctl enable-linger`，退出重进后验证它仍在运行。

## 自检

- [ ] 能说出部署与 `nohup` 的五项差别
- [ ] 能默写一个 service 的三段结构，并解释 `After=` 与 `Requires=` 的区别
- [ ] 能按「程序是否自己后台化」选对 `Type=`
- [ ] 能解释为什么密钥要放 `EnvironmentFile`，以及改完为什么要 `restart`
- [ ] 能说出 `User=` 省略的后果，以及 `DynamicUser` 的适用场景
- [ ] 能列出四条基础加固指令并说明各自挡住什么
- [ ] 知道用户级服务的生命周期与 `enable-linger` 的作用

## 参考

- [Systemd](https://wiki.archlinux.org/title/Systemd)
- [Systemd/User](https://wiki.archlinux.org/title/Systemd/User)
- [Systemd.exec](https://www.freedesktop.org/software/systemd/man/systemd.exec.html)
