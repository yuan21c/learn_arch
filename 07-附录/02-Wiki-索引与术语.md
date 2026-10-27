# 02 Wiki 索引与术语

本章是全书的两份基础资料：一份按主题索引常用 Wiki 页面，一份解释后文反复出现的术语。Wiki 是 Arch 的唯一权威，本索引帮你找到入口，不替代原文。

> 本章目标：建立“遇到什么问题查哪个页面”的索引，并能用准确术语描述系统行为。
> 对应 Wiki：[Main page](https://wiki.archlinux.org/title/Main_page)｜[Arch terminology](https://wiki.archlinux.org/title/Arch_terminology)

## 2.1 Wiki 索引

| 主题     | 链接                                                                                | 用途                                  |
| -------- | ----------------------------------------------------------------------------------- | ------------------------------------- |
| 安装指南 | [Installation guide](https://wiki.archlinux.org/title/Installation_guide)           | 完整安装顺序，06 章的权威依据         |
| 通用建议 | [General recommendations](https://wiki.archlinux.org/title/General_recommendations) | 装完系统后的配置清单与方向            |
| 系统维护 | [System maintenance](https://wiki.archlinux.org/title/System_maintenance)           | 升级习惯、部分升级、配置合并          |
| Pacman   | [Pacman](https://wiki.archlinux.org/title/Pacman)                                   | 包管理全部操作与查询语法              |
| systemd  | [Systemd](https://wiki.archlinux.org/title/Systemd)                                 | unit、target、日志、定时器            |
| 启动流程 | [Arch boot process](https://wiki.archlinux.org/title/Arch_boot_process)             | 固件、引导器、initramfs 的关系        |
| Makepkg  | [Makepkg](https://wiki.archlinux.org/title/Makepkg)                                 | 构建工具参数与构建流程                |
| PKGBUILD | [PKGBUILD](https://wiki.archlinux.org/title/PKGBUILD)                               | 打包脚本的变量与函数规范              |
| AUR      | [Arch User Repository](https://wiki.archlinux.org/title/Arch_User_Repository)       | 用户仓库机制、风险与使用流程          |
| WSL      | [WSL](https://wiki.archlinux.org/title/WSL)                                         | WSL 中的 Arch 配置与限制              |
| 网络配置 | [Network configuration](https://wiki.archlinux.org/title/Network_configuration)     | NetworkManager、systemd-networkd、DNS |
| 安全     | [Security](https://wiki.archlinux.org/title/Security)                               | 权限、防火墙、服务最小化              |

### 按任务查

| 你现在的任务   | 先读                  | 再读                               |
| -------------- | --------------------- | ---------------------------------- |
| 装系统         | Installation guide    | Partitioning、EFI system partition |
| 装软件         | Pacman                | Arch User Repository（AUR 包）     |
| 写服务         | Systemd               | systemd.service、systemd.timer     |
| 自己打包       | Makepkg               | PKGBUILD、Arch package guidelines  |
| 系统升级出问题 | System maintenance    | Pacman、Arch News                  |
| 启动失败       | Arch boot process     | GRUB 或 systemd-boot、mkinitcpio   |
| 配网络         | Network configuration | NetworkManager                     |
| 加固系统       | Security              | Sudo、OpenSSH、Firewall            |

Wiki 页面顶部的警告框和「Related articles」比正文末尾更有价值：前者通常列出已知的破坏性变更，后者给出同一主题的上下游页面。

## 2.2 术语表

| 术语            | 解释                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rolling release | 滚动发行：没有固定版本号，软件持续更新。系统始终处于“最新但需自行维护”的状态，升级前应看 Arch News。                                                     |
| package         | 软件包，通常是 `.pkg.tar.zst` 归档，包含文件、元数据和安装脚本，由 pacman 安装与记录。                                                                   |
| repository      | 仓库，服务器上的包集合与索引数据库。官方仓库在 `/etc/pacman.conf` 中配置，pacman 从索引判断可安装版本。                                                  |
| AUR             | Arch User Repository，用户提交的 PKGBUILD 集合。它不提供官方二进制包，构建结果由用户自己负责。                                                           |
| PKGBUILD        | 一个 bash 脚本，描述包名、版本、来源、校验和、依赖以及构建和打包步骤，是 makepkg 的输入。                                                                |
| makepkg         | 按 PKGBUILD 下载源码、编译并打包的脚本工具。应以普通用户运行，产物再用 pacman 安装。                                                                     |
| systemd unit    | systemd 管理的基本配置单元，常见后缀有 `.service`、`.timer`、`.mount`、`.target`，由 unit 文件描述行为与依赖。                                           |
| target          | 一组 unit 的集合，用于把系统带到某个状态，例如 `multi-user.target` 对应多用户命令行环境。服务通过 `[Install]` 段的 `WantedBy=...target` 挂到 target 上。 |
| initramfs       | 启动早期加载的临时根文件系统，负责准备真实根分区所需的驱动、解锁加密卷、挂载根文件系统，然后切换到真实根。                                               |
| bootloader      | 引导器，由固件加载，负责选择并加载内核与 initramfs。GRUB 与 systemd-boot 是 UEFI 下最常见的两种。                                                        |
| dependency      | 依赖，指某个包运行或构建所需的其他包。pacman 自动解析运行依赖，构建依赖通常由 `makepkg -s` 处理。                                                        |
| orphan          | 孤立包，最初作为依赖被安装、但当前没有任何包再依赖它。用 `pacman -Qdt` 查找，确认后再删除。                                                              |
| partial upgrade | 部分升级，只升级部分包或只同步数据库不升级系统，造成库与程序版本不匹配。`pacman -Sy 包名` 是典型诱因。                                                   |
| keyring         | 密钥环，pacman 验证包签名所用的公钥集合，由 `archlinux-keyring` 包维护。密钥过期会导致签名错误。                                                         |
| hook            | 钩子。pacman 的 alpm hook 在安装前后自动执行任务；mkinitcpio 的 hook 则决定 initramfs 的生成步骤。两者同名但机制不同。                                   |
| pacnew          | 升级时若配置文件被修改过，pacman 不覆盖原文件，而是生成 `.pacnew` 供手动合并。长期忽略会导致配置与新版软件不兼容。                                       |

### 容易混淆的三组概念

| 对比                         | 区别                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| package vs repository        | 包是单个软件单元；仓库是包的集合与索引，决定 pacman 从哪里取包。                            |
| systemd unit vs target       | unit 描述一个具体服务或资源；target 是一组 unit 的集合，用来表达系统状态。                  |
| alpm hook vs mkinitcpio hook | 前者由 pacman 在包事务中触发；后者在生成 initramfs 时按顺序执行。看到 “hook” 要先判断语境。 |

## 小结

- Wiki 按任务查，不按顺序读；先看顶部警告，再看 Related articles。
- 安装、维护、打包、启动四条主线各有固定入口页面。
- 术语的准确使用能减少沟通成本，尤其是 partial upgrade、orphan、pacnew。
- `hook` 在 pacman 与 mkinitcpio 中是两个不同机制，必须结合上下文判断。
- 本索引只覆盖本书涉及的主题，更多页面从 Main page 进入。

## 练习

1. 从索引中找到 Installation guide，列出它的一级标题，并与本书 06 章的三节对应。
2. 用 System maintenance 页面解释 partial upgrade 的定义，并写出避免方法。
3. 在 Pacman 页面找到 `-Qdt` 的说明，确认它与 orphan 的对应关系。
4. 在 Arch boot process 页面画出固件、引导器、内核、initramfs、root 的顺序。
5. 找出一个本书未列出的 Wiki 页面，说明它属于哪个主题。
6. 用自己的话解释 pacnew，并说明为什么不能直接删除它。

## 自检

- [ ] 能根据任务说出该查的 Wiki 页面
- [ ] 能解释 rolling release 对维护习惯的要求
- [ ] 能区分 repository 与 AUR
- [ ] 能说明 PKGBUILD 与 makepkg 的分工
- [ ] 能解释 unit 与 target 的关系
- [ ] 能说明 initramfs 与 bootloader 各自负责什么
- [ ] 能区分两种 hook，并解释 pacnew 的处理原则

## 参考

- [Main page](https://wiki.archlinux.org/title/Main_page)
- [Arch terminology](https://wiki.archlinux.org/title/Arch_terminology)
- [Installation guide](https://wiki.archlinux.org/title/Installation_guide)
- [System maintenance](https://wiki.archlinux.org/title/System_maintenance)
- [Pacman](https://wiki.archlinux.org/title/Pacman)
- [Systemd](https://wiki.archlinux.org/title/Systemd)
- [Arch boot process](https://wiki.archlinux.org/title/Arch_boot_process)
- [Makepkg](https://wiki.archlinux.org/title/Makepkg)
- [PKGBUILD](https://wiki.archlinux.org/title/PKGBUILD)
- [Arch User Repository](https://wiki.archlinux.org/title/Arch_User_Repository)
- [WSL](https://wiki.archlinux.org/title/WSL)
- [Network configuration](https://wiki.archlinux.org/title/Network_configuration)
- [Security](https://wiki.archlinux.org/title/Security)
