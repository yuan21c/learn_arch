# 01 首次启动与 systemd

第一次进入 Arch WSL，先不要急着装软件。先确认你面对的到底是什么：发行版、内核、PID 1、WSL 版本。环境不对，后面的命令都会变形。

> 本章目标：完成首次环境自检，启用 systemd，更新系统并装好基础工具。
> 对应 Wiki：[WSL](https://wiki.archlinux.org/title/WSL)

## 环境自检

在 Arch 终端执行：

```bash
cat /etc/os-release
uname -r
ps -p 1 -o comm=
systemctl is-system-running
```

在 Windows PowerShell 执行：

```powershell
wsl --version
wsl -l -v
```

| 命令 | 期望 | 异常含义 |
| --- | --- | --- |
| `cat /etc/os-release` | 显示 Arch Linux | 装错发行版 |
| `uname -r` | 含 `microsoft-standard-WSL2` | 使用了其他内核 |
| `ps -p 1 -o comm=` | `systemd` | 未启用 systemd |
| `systemctl is-system-running` | `running` 或 `degraded` | 服务异常或未启用 |
| `wsl --version` | 正常输出版本 | WSL 版本过旧 |

`degraded` 表示 systemd 正在运行但有单元失败，用 `systemctl --failed` 查看。

## 配置 /etc/wsl.conf

用 root 或 sudo 编辑 `/etc/wsl.conf`：

```ini
[boot]
systemd=true

[automount]
enabled=true

[interop]
enabled=true
appendWindowsPath=false

[user]
default=arch
```

各项作用：

| 配置 | 作用 |
| --- | --- |
| `boot.systemd` | 让 WSL 以 systemd 作为 PID 1 |
| `automount.enabled` | 自动挂载 Windows 盘 |
| `interop.enabled` | 允许调用 Windows 程序 |
| `interop.appendWindowsPath` | 是否把 Windows PATH 追加到 Linux PATH |
| `user.default` | 登录时的默认用户 |

`appendWindowsPath=false` 可以避免 Windows 程序污染 Linux 命令环境；需要调用 Windows 程序时用完整路径（如 `/mnt/c/Windows/System32/notepad.exe`）。`user.default=arch` 依赖该用户已经存在，创建用户见 [用户权限与 sudo](../01-环境准备/02-用户权限与-sudo.md)。

修改后必须在 Windows 侧关闭 WSL 再重新进入：

```powershell
wsl --shutdown
```

重新打开 Arch 后验证：

```bash
ps -p 1 -o comm=
systemctl is-system-running
systemctl --failed
```

## 首次更新

```bash
sudo pacman -Syu
```

第一次更新要完整读输出，尤其是 `:: Proceed with installation?` 之前的包列表和提示。

密钥环通常已由官方镜像初始化。若遇到签名错误，再执行：

```bash
sudo pacman-key --init
sudo pacman-key --populate archlinux
sudo pacman -S archlinux-keyring
```

不要在没有签名错误时反复执行 `--init`，它只在初始化阶段有意义。

## 安装基础工具

```bash
sudo pacman -S --needed base-devel git sudo reflector pacman-contrib
```

| 包 | 用途 |
| --- | --- |
| `base-devel` | 构建 AUR 包所需的编译工具组 |
| `git` | 拉取 AUR 仓库与源码 |
| `sudo` | 提权执行 |
| `reflector` | 生成镜像列表 |
| `pacman-contrib` | 提供 `checkupdates`、`paccache` 等工具 |

`--needed` 表示已安装的包跳过，不会重复安装。

## 常见启动失败

| 现象 | 可能原因 | 排查方向 |
| --- | --- | --- |
| `systemctl` 报 “System has not been booted with systemd” | 未启用 systemd | 检查 `/etc/wsl.conf` 的 `boot.systemd`，然后 `wsl --shutdown` |
| 提示 `db.lck` 已存在 | pacman 上次异常退出 | 确认没有 pacman 进程后删除锁文件 |
| `pacman -Syu` 大量 404 或超时 | 镜像源不可用 | 更换镜像源，见 [镜像源配置与备份](../01-环境准备/03-镜像源-配置与备份.md) |
| 进入后没有网络 | WSL 网络异常 | 在 Windows 侧重启 WSL，检查 DNS |

`db.lck` 的处理要谨慎，先确认进程：

```bash
ps aux | grep '[p]acman'
```

> **危险**：只有在确认没有 pacman 进程运行时，才可以删除 `/var/lib/pacman/db.lck`。误删正在使用的锁会导致数据库损坏。

## 小结

- 首次进入先做五项自检，确认发行版、内核、PID 1、systemd 状态和 WSL 版本。
- 用 `/etc/wsl.conf` 启用 systemd，并在 Windows 侧 `wsl --shutdown` 后验证。
- 首次更新用 `pacman -Syu`，密钥环只在报错时初始化。
- 装好 `base-devel`、`git`、`sudo`、`reflector`、`pacman-contrib`。
- 启动失败先看 PID 1、锁文件、镜像源和网络。

## 练习

1. 完成五项自检，把输出记录到笔记。
2. 写一份 `/etc/wsl.conf`，逐行解释作用。
3. 关闭并重新进入 WSL，确认 PID 1 变为 systemd。
4. 执行一次 `pacman -Syu`，记录升级了多少个包。
5. 用 `systemctl --failed` 查看是否有失败单元，并说明原因。

## 自检

- [ ] 能独立完成环境自检并解释每项输出
- [ ] 能写出并解释 `/etc/wsl.conf` 的四组配置
- [ ] 知道修改 wsl.conf 后为什么要 `wsl --shutdown`
- [ ] 能完成首次更新并处理密钥环问题
- [ ] 遇到 db.lck 时知道先确认进程再处理

## 参考

- [WSL](https://wiki.archlinux.org/title/WSL)
- [systemd](https://wiki.archlinux.org/title/Systemd)
- [Pacman](https://wiki.archlinux.org/title/Pacman)
- [Arch User Repository](https://wiki.archlinux.org/title/Arch_User_Repository)
