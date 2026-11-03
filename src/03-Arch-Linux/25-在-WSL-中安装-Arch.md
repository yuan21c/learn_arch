# 第 25 章 在 WSL 中安装 Arch

前一章划清了 WSL 的能力边界，这一章解决最实际的问题：怎样在 Windows 上拿到一个属于自己的 Arch 实例。没有这一步，第 26 章起的主线命令无处可跑。本章给两条路线——官方自动安装，以及官方 `.wsl` 镜像手动安装——并完成进入系统后的环境验证；默认用户、systemd 与首次更新统一放到第 26 章。

> 本章目标：能在 Windows 上安装并进入 Arch WSL 实例；能用 `uname -r`、`/etc/os-release` 与 `whoami` 验证环境；知道两条官方路线的差别，以及实例的备份与删除边界。
> 对应 Wiki：[WSL](https://wiki.archlinux.org/title/WSL)、[Install Arch Linux on WSL](https://wiki.archlinux.org/title/Install_Arch_Linux_on_WSL)

## 前置条件

| 条件         | 要求                                      | 检查方式                                   |
| ------------ | ----------------------------------------- | ------------------------------------------ |
| Windows 版本 | Windows 10 22H2+ 或 Windows 11            | `winver`（环境：Windows PowerShell）       |
| WSL 平台     | WSL 2，Store 版（systemd 支持随版本变化） | `wsl --version`；不支持时先 `wsl --update` |
| 虚拟化       | 固件中已启用虚拟化                        | `systeminfo` 中「Hyper-V 要求」为「是」    |

先把 WSL 本身更新到当前版本——systemd 支持随版本变化，官方也建议用 Store 版：

```powershell
wsl --update      # 环境：Windows PowerShell
wsl --version     # 确认 WSL 版本与内核版本
```

若 `wsl` 命令不存在，先在管理员 PowerShell 执行 `wsl --install` 装好 WSL 平台，重启后再继续。

WSL 2 是硬前提：WSL 1 既不支持 systemd，也无法运行第 26 章之后的 `systemctl` 内容。

## 路线 A：官方自动安装（最简）

```powershell
wsl --install archlinux        # 环境：Windows PowerShell；官方发行版名是 archlinux
wsl -l -v                      # 确认实例存在且 VERSION 为 2
wsl -d archlinux               # 进入；也可从开始菜单的 archlinux 应用进入
```

`archlinux` 是官方 WSL 镜像的发行版名，不是商店里的第三方条目。安装完成后**默认用户是 root**，没有「首启向导创建用户」这一步；普通用户与 `[user] default=` 在第 26 章配置。若命令报找不到发行版，先 `wsl --list --online` 查看当前可安装列表，以列表中的名称为准。

## 路线 B：官方 .wsl 镜像手动安装（可控）

官方每月构建 `.wsl` 镜像，适合想自己指定实例名、落盘目录或离线安装的场景。先打开 <https://fastly.mirror.pkgbuild.com/wsl/latest/> 看当前文件名（带日期，会随构建变化），再执行：

```powershell
# 环境：Windows PowerShell
# 假设已下载到 Downloads，文件名以镜像目录中的实际值为准
wsl --install --from-file $env:USERPROFILE\Downloads\archlinux-2025.04.01.121271.wsl --name Arch
wsl -l -v
wsl -d Arch
```

要点：

- `--from-file` 是官方手动安装路线；省略 `--name` 时实例名默认为 `archlinux`。与已有实例同名时，`wsl --install` 的处理方式随版本变化，**以当前 Wiki 与命令提示为准**。
- 实例的虚拟磁盘（`ext4.vhdx`）由 WSL 管理，默认位于 `%LOCALAPPDATA%\Packages\<发行版包名>\LocalState\`；用 `wsl -l -v` 看实例版本，具体实例路径可在注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss\{GUID}` 的 `BasePath` 下核对。需要固定盘符时可在安装前设置默认安装目录。
- 进入后默认是 root，systemd 与默认用户仍在第 26 章配置。
- 旧的 bootstrap 压缩包（`archlinux-bootstrap-x86_64.tar.zst`）内容位于顶层 `root.x86_64/` 目录，不是可直接导入的根布局，需要解压、重打包后才可用；本书不采用这条路线，需要时以 Wiki 为准。

> **危险**：`wsl --unregister <名称>` 会删除该实例的整个虚拟磁盘，不可逆。执行前先 `wsl -l -v` 核对名称，并用 `wsl --export <名称> backup.tar` 备份；恢复用 `wsl --import` 导回备份文件。

## 首次进入与验证

```bash
# 环境：WSL
uname -r            # 期望含 microsoft-standard-WSL2，说明内核是微软的
cat /etc/os-release # 期望 NAME="Arch Linux"
whoami              # 两条路线默认都是 root
```

两个判断标准：内核标识带 `microsoft`（原因见第 24 章），发行版标识是 Arch。密钥环通常已由官方镜像初始化；若 `pacman -Syu` 报签名错误，处理办法见第 26 章与第 31 章。

## 安装失败：四个判据

| 现象                            | 判据                                             | 处理                                                                                  |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 下载或安装命令报错、404         | 镜像目录只保留当前文件名                         | 打开 <https://fastly.mirror.pkgbuild.com/wsl/latest/>，复制实际文件名，不照抄示例日期 |
| `wsl -d <名>` 报没有该发行版    | 实例名与 `wsl -l -v` 不一致                      | 改用 `wsl -l -v` 显示的名称；安装时也可用 `--name` 指定                               |
| `whoami` 不是预期用户           | 默认用户尚未配置，或 `default=` 指向不存在的用户 | 第 26 章建用户并写 `[user] default=`；指向不存在用户时 WSL 会静默回退 root            |
| `systemctl` 报未以 systemd 启动 | `[boot] systemd=true` 未生效                     | 第 26 章启用后 `wsl --shutdown` 重进验证                                              |

## 下一步：第 26 章

本章只负责「装上、能进、能验证」。默认用户、`/etc/wsl.conf`、systemd 与首次系统更新都在第 26 章按顺序完成，不要在这里提前重复配置。

## 常见坑

| 坑               | 表现                                     | 处理                                                        |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------- |
| 默认 root        | 直接以 root 敲命令，后续权限练习全部失效 | 第 26 章用 `[user] default=` 指定普通用户                   |
| 账号锁定         | 建用户后 `su`/`sudo` 认证失败            | 补 `passwd <用户>`（不设密码时账号处于锁定状态）            |
| 在 `/mnt/c` 构建 | makepkg 报错或极慢                       | 项目与构建放 `~/`，见第 35 章                               |
| 密钥环未初始化   | `pacman -Syu` 签名错误                   | 见第 26 章与第 31 章，不要反复执行 `--init`                 |
| systemd 不生效   | `systemctl` 报未以 systemd 启动          | 第 26 章启用 `[boot] systemd=true`，`wsl --shutdown` 后重进 |

## 小结

- 两条路线：官方自动安装最简（`wsl --install archlinux`）；`.wsl` 镜像手动安装可指定实例名与落盘位置。
- 两条路线进入后默认都是 root；普通用户、systemd 与首次更新在第 26 章完成。
- 验证三件事：`uname -r` 内核标识、`/etc/os-release` 发行版、`whoami` 当前身份。
- `wsl --unregister` 删除整个虚拟磁盘，不可逆；改动前先 `wsl --export` 备份。
- `/mnt/c` 只适合交换文件，不要放项目与构建目录。

## 练习

1. 用 `wsl -l -v` 记录当前实例的名称与 WSL 版本（环境：Windows PowerShell；预期：输出含 NAME/STATE/VERSION 三列）。
2. 执行 `uname -r`、`cat /etc/os-release` 与 `whoami`，解释三个输出各自证明了什么（环境：WSL；预期：内核含 microsoft、os-release 含 Arch、whoami 为 root）。
3. 用 `--from-file` 与 `--name` 把官方 `.wsl` 镜像安装成自定义名称的实例，再用 `wsl -l -v` 与 `wsl -d <名>` 验证（环境：Windows PowerShell；预期：新实例出现在列表中且能进入）。
4. 打开 <https://fastly.mirror.pkgbuild.com/wsl/latest/> 记录当前文件名与日期，说明为什么书中的示例文件名不能照抄（环境：阅读题）。
5. 阅读题：解释 `wsl --unregister` 删除的是哪个文件，为什么它不可逆，备份与恢复各用什么命令（环境：阅读题）。

## 自检

- [ ] 能说出两条安装路线的差别与各自适用场景
- [ ] 能完成安装并用 `uname -r`、`/etc/os-release`、`whoami` 验证环境
- [ ] 知道 `wsl --unregister` 的破坏范围与备份方法
- [ ] 安装失败时能按文件名、实例名、默认用户、systemd 四项判据定位
- [ ] 知道为什么项目不能放在 `/mnt/c`

## 参考

- [WSL](https://wiki.archlinux.org/title/WSL)
- [Install Arch Linux on WSL](https://wiki.archlinux.org/title/Install_Arch_Linux_on_WSL)
- [Installation guide](https://wiki.archlinux.org/title/Installation_guide)
- [Pacman/Package signing](https://wiki.archlinux.org/title/Pacman/Package_signing)
