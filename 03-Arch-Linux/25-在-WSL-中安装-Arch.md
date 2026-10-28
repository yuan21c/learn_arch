# 第 25 章 在 WSL 中安装 Arch

前一章划清了 WSL 的能力边界，这一章解决最实际的问题：怎样在 Windows 上拿到一个属于自己的 Arch 实例。没有这一步，第 26 章起的主线命令无处可跑。本章给两条路线——商店发行版与官方 bootstrap 导入——以及进入系统后的验证与初始化。

> 本章目标：能在 Windows 上安装并进入 Arch WSL 实例；能用 `uname -r` 与 `/etc/os-release` 验证环境；会用 `/etc/wsl.conf` 配置默认用户与 systemd，并知道 `/mnt/c` 的边界。
> 对应 Wiki：[WSL](https://wiki.archlinux.org/title/WSL)

## 前置条件

| 条件 | 要求 | 检查方式 |
| --- | --- | --- |
| Windows 版本 | Windows 10 22H2+ 或 Windows 11 | `winver`（环境：Windows PowerShell） |
| WSL 平台 | WSL 2，版本较新（支持 systemd） | `wsl --version`（环境：Windows PowerShell） |
| 虚拟化 | 固件中已启用虚拟化 | `systeminfo` 中「Hyper-V 要求」为「是」 |

先把 WSL 本身更新到当前版本，旧版 WSL 不支持 systemd：

```powershell
wsl --update      # 环境：Windows PowerShell
wsl --version     # 确认 WSL 版本与内核版本
```

若 `wsl` 命令不存在，先在管理员 PowerShell 执行 `wsl --install` 装好 WSL 平台，重启后再继续。

## 路线 A：安装商店发行版（最简）

```powershell
wsl --install -d Arch Linux   # 环境：Windows PowerShell，发行版名以商店为准
wsl -l -v                     # 列出已安装实例与各自的 WSL 版本
```

安装完成后从开始菜单或 `wsl -d Arch Linux` 进入；首次进入会引导创建普通用户并设密码。这条路最省事，但发行版名称、默认配置以商店与 Wiki 的当前状态为准。

## 路线 B：官方 bootstrap 导入（可控）

从 Arch 官方镜像下载 bootstrap 压缩包，在 Windows 侧注册成一个 WSL 实例：

```powershell
# 环境：Windows PowerShell
Invoke-WebRequest -Uri https://geo.mirror.pkgbuild.com/iso/latest/archlinux-bootstrap-x86_64.tar.gz -OutFile $env:USERPROFILE\Downloads\archlinux-bootstrap.tar.gz
New-Item -ItemType Directory -Force C:\WSL\Arch
wsl --import Arch C:\WSL\Arch $env:USERPROFILE\Downloads\archlinux-bootstrap.tar.gz
wsl --set-default Arch
wsl -d Arch
```

要点：

- `wsl --import` 第一个参数是实例名；与已有实例同名时报错还是覆盖，行为随版本变化，**以 Wiki 为准**。
- `C:\WSL\Arch` 存放该实例的虚拟磁盘（`ext4.vhdx`），注意预留空间与备份。
- 导入后的实例默认以 root 进入，需要自行创建普通用户（见下文）。

> **危险**：`wsl --unregister <名称>` 会删除该实例的整个虚拟磁盘，不可逆。执行前先 `wsl -l -v` 核对名称，并用 `wsl --export <名称> backup.tar` 备份；恢复用 `wsl --import` 导回备份文件。

## 首次进入与验证

```bash
# 环境：WSL
uname -r            # 期望含 microsoft-standard-WSL2，说明内核是微软的
cat /etc/os-release # 期望 NAME="Arch Linux"
whoami              # 路线 B 的实例默认是 root
```

两个判断标准：内核标识带 `microsoft`（原因见第 24 章），发行版标识是 Arch。bootstrap 实例还要初始化 pacman 密钥环，否则 `pacman -Syu` 会报签名错误：

```bash
# 环境：WSL，仅路线 B 需要
pacman-key --init
pacman-key --populate archlinux-keyring
pacman -Syu
```

## /etc/wsl.conf：默认用户与 systemd

`/etc/wsl.conf` 是 WSL 专属的实例配置，改完必须 `wsl --shutdown` 才生效：

```ini
[user]
default=arch

[boot]
systemd=true
```

`[user] default=` 指定默认登录用户，**该用户必须已存在且已设密码**；`[boot] systemd=true` 让 systemd 成为 PID 1，这是第 26 章之后 `systemctl`、`journalctl` 命令的前提。

```bash
# 环境：WSL
id arch || useradd -m -G wheel -s /bin/bash arch
passwd arch                  # 不设密码则账号锁定，无法登录
ps -p 1 -o comm=             # 重进后期望输出 systemd
```

配置改完后在 PowerShell 执行 `wsl --shutdown`，再 `wsl -d Arch` 进入验证。`default=` 指向不存在的用户时，WSL 会静默回退到 root——这是「配置没生效」类困惑的头号原因。

## 常见坑

| 坑 | 表现 | 处理 |
| --- | --- | --- |
| 默认 root | 直接以 root 敲命令，后续权限练习全部失效 | 用 `[user] default=` 指定普通用户 |
| 账号锁定 | `useradd` 后登录失败 | 补 `passwd <用户>` |
| 在 `/mnt/c` 构建 | makepkg 报错或极慢 | 项目与构建放 `~/`，见第 35 章 |
| 密钥环未初始化 | `pacman -Syu` 签名错误 | `pacman-key --init && pacman-key --populate archlinux-keyring` |
| WSL 版本过旧 | 无 systemd 支持 | `wsl --update` 后 `wsl --shutdown` |

## 小结

- 两条路线：商店发行版最简；bootstrap 导入让你看清根文件系统的来源。
- `wsl --import` 以实例名为键；`wsl --unregister` 删除整个虚拟磁盘，不可逆。
- 验证三件事：`uname -r` 内核标识、`/etc/os-release` 发行版、`ps -p 1 -o comm=` 是否 systemd。
- `/etc/wsl.conf` 管默认用户与 systemd，改完 `wsl --shutdown` 才生效。
- `/mnt/c` 只适合交换文件，不要放项目与构建目录。

## 练习

1. 用 `wsl -l -v` 记录当前实例的名称与 WSL 版本（环境：Windows PowerShell；预期：输出含 NAME/STATE/VERSION 三列）。
2. 执行 `uname -r` 与 `cat /etc/os-release`，解释两个输出各自证明了什么（环境：WSL；预期：内核含 microsoft、os-release 含 Arch）。
3. 创建用户 `arch` 并设密码，写入 `[user] default=arch`，`wsl --shutdown` 后重进验证（环境：Windows PowerShell + WSL；预期：`whoami` 输出 arch）。
4. 打开 `[boot] systemd=true`，重进后用 `ps -p 1 -o comm=` 与 `systemctl is-system-running` 验证（环境：WSL；预期：输出 `systemd` 与 `running` 或 `degraded`）。
5. 阅读题：解释 `wsl --unregister` 删除的是哪个文件，为什么它不可逆（环境：阅读题）。

## 自检

- [ ] 能说出两条安装路线的取舍
- [ ] 能独立完成 bootstrap 导入并验证环境
- [ ] 知道 `wsl --unregister` 的破坏范围与备份方法
- [ ] 会配置 `/etc/wsl.conf` 的默认用户与 systemd
- [ ] 知道为什么项目不能放在 `/mnt/c`

## 参考

- [WSL](https://wiki.archlinux.org/title/WSL)
- [Installation guide](https://wiki.archlinux.org/title/Installation_guide)
- [Pacman/Package signing](https://wiki.archlinux.org/title/Pacman/Package_signing)
