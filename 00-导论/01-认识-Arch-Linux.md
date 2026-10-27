# 01 认识 Arch Linux

如果你用过 Ubuntu 或 Fedora，对 `apt`、`dnf`、图形安装器和默认桌面都不陌生。Arch 的起点不同：它先给你一套最小的、能启动的系统，剩下的由你亲手组装。本章先建立正确预期，再谈怎么学。

> 本章目标：说清 Arch 是什么、官方仓库与 AUR 的区别、滚动更新的代价，以及 WSL 版与真机版的边界。
> 对应 Wiki：[Arch Linux](https://wiki.archlinux.org/title/Arch_Linux)

## Arch 是什么

Arch Linux 是一个独立开发的 x86-64 Linux 发行版，不基于 Debian、Fedora 或任何其他发行版。几个关键词：

| 关键词       | 含义                                           |
| ------------ | ---------------------------------------------- |
| 滚动更新     | 没有版本号，装一次后持续升级                   |
| KISS         | Keep It Simple, Stupid，简单优先，不做过度设计 |
| 极简基础系统 | 默认只装能启动、能联网、能装包的最小集合       |
| 用户中心     | 系统怎么配由用户决定，发行版不预设立场         |
| Wiki 驱动    | 官方文档是最完整的一手资料                     |

“用户中心”不是口号。Arch 不替你选桌面，不预装办公套件，也不强制你使用 NetworkManager。它提供零件和文档，组装由你完成。

```bash
# 看当前系统显式安装了什么（WSL 中同样适用）
pacman -Qe
```

上面列出的就是“显式安装”的包，通常远少于 Ubuntu 桌面版的预装量。

## 官方仓库与 AUR

Arch 的软件来源分两层：官方二进制仓库和用户仓库 AUR。

| 名称     | 内容                                     | 维护者           | 形式              |
| -------- | ---------------------------------------- | ---------------- | ----------------- |
| core     | 启动、联网、构建、系统管理必需的包       | Arch 开发者      | 预编译二进制      |
| extra    | core 之外的大部分软件                    | Arch 打包者      | 预编译二进制      |
| multilib | 在 x86-64 上运行 32 位程序所需的库与软件 | Arch 打包者      | 预编译二进制      |
| AUR      | 用户提交的构建配方                       | 社区用户，非官方 | PKGBUILD 源码脚本 |

本质区别：

- 官方仓库由 Arch 团队构建、签名、托管，`pacman -S` 直接下载安装。
- AUR 不是官方二进制仓库，不提供预编译包，只提供 `PKGBUILD`。你要自己 `makepkg` 构建，或者用 AUR 助手代劳。
- AUR 内容未经官方审核，安全性和可用性由提交者与使用者负责。

```bash
# 搜官方仓库
pacman -Ss firefox

# 列出非官方来源的已安装包（AUR 或本地构建）
pacman -Qm
```

如果某个包在官方仓库里搜不到，才去 AUR 看。AUR 的地址是 <https://aur.archlinux.org>，与官方仓库不是一回事。

## 与 Ubuntu、Fedora 对比

| 维度     | Arch                           | Ubuntu                   | Fedora                       |
| -------- | ------------------------------ | ------------------------ | ---------------------------- |
| 发布模式 | 滚动更新，无大版本             | 固定发行 + LTS           | 固定发行，约半年一版         |
| 安装方式 | 手动或 archinstall，默认无桌面 | 图形安装器，预置较多选项 | Anaconda 图形安装器          |
| 默认软件 | 最小基础系统                   | GNOME、常用工具、Snap    | GNOME Workstation 等 Edition |
| 包管理   | pacman + AUR                   | APT/dpkg + PPA/Snap      | DNF/RPM + Copr/Flatpak       |
| 配置哲学 | 用户自己决定，发行版少干预     | 提供较完整的默认配置     | 上游优先，默认配置较完整     |
| 支持模式 | 社区支持，无商业支持           | Canonical 商业支持       | Red Hat 生态与社区支持       |

这张表只说明定位差异，不评价优劣。选 Arch 通常是因为想要控制权和较新的软件，而不是因为“更高级”。

## 滚动发行意味着什么

滚动发行不是“永远最新所以更好”，而是一种责任转移：

- 没有“Arch 2026.10”这种大版本，系统状态取决于你最后一次升级。
- 升级是持续的小步变化，而不是一年一次的大迁移。
- 官方不保证任意旧状态都能平滑升级到最新，长期不升级会积累需要手动干预的变更。
- 你需要读 [Arch News](https://archlinux.org/news/)，在升级前处理需要人工介入的变更。

```bash
# 查看可升级的包，不实际升级
pacman -Qu

# 完整升级，不要只升级单个包
sudo pacman -Syu
```

> **危险**：不要用 `pacman -Sy 包名` 只同步数据库再装单个包。这会造成部分升级，是 Arch 最常见的事故来源。详见 [pacman 模型与铁律](../02-包管理/01-pacman-模型与铁律.md)。

滚动更新把“什么时候升级、升级前做什么准备”交给了你。这就是为什么本书反复强调备份、看 News 和读输出。

## 适合谁，不适合谁

适合：

- 愿意阅读文档、自己动手配置的人。
- 想要较新软件、能接受偶尔手动干预的人。
- 想把 Linux 系统分层搞明白，而不只是会用桌面的人。

不适合：

- 希望装完就能用、不想碰配置文件的人。
- 无法接受升级后需要手动处理的人。
- 完全没有命令行基础、也不打算学的人。

常见误解：

- “Arch 就是难。” Arch 的安装和配置确实需要更多决策，但日常维护有明确流程；难的是决策量，不是命令本身。
- “AUR 是官方仓库。” AUR 是用户内容平台，官方明确不提供支持。把 AUR 当官方源会低估风险。
- “滚动更新等于不稳定。” 稳定与否更多取决于是否完整升级、是否读 News、是否乱加第三方源。

## WSL 版与真机版的差异（概述）

WSL 中的 Arch 是一个精简的用户空间：包管理、systemd、权限、文件层次都能练，但内核由微软提供，没有引导器，不能分区、不能做 LUKS，设备访问受限。

| 能力                   | WSL      | 真机           |
| ---------------------- | -------- | -------------- |
| pacman / AUR / makepkg | 完整     | 完整           |
| systemd                | 基本完整 | 完整           |
| 内核与模块             | 不可替换 | 可编译、可加载 |
| 引导器 / initramfs     | 无       | 有             |
| 分区 / LUKS            | 不可     | 可             |
| 桌面环境               | 不适用   | 可             |

结论：在 WSL 里把包管理、systemd、打包、排障练熟；安装、引导、内核、磁盘加密留到虚拟机阶段。完整边界见 [WSL 的能力边界](../00-导论/03-WSL-的能力边界.md)。

## 术语小表

| 术语     | 含义                                           |
| -------- | ---------------------------------------------- |
| 包       | 一个 `.pkg.tar.zst` 文件，含文件与元数据       |
| 仓库     | 存放包与索引的服务器目录，如 core、extra       |
| AUR      | Arch User Repository，用户提交的 PKGBUILD 集合 |
| PKGBUILD | 描述如何构建一个包的 Bash 脚本                 |
| makepkg  | 按 PKGBUILD 构建包的官方工具                   |
| systemd  | PID 1，负责服务、日志、挂载、定时器等          |
| unit     | systemd 的管理单元，如 service、timer、mount   |
| 滚动发行 | 无固定版本、持续升级的发布模式                 |

```bash
cat /etc/os-release
uname -r
```

## 小结

- Arch 是独立开发、滚动更新、极简、用户中心的发行版，Wiki 是权威资料。
- 官方仓库（core/extra/multilib）提供预编译包；AUR 只提供用户提交的构建配方。
- 滚动更新把维护责任交给用户：完整升级、读 News、先备份。
- WSL 版能练用户空间，不能替代安装、引导、内核与磁盘相关学习。

## 练习

1. 用 `pacman -Qe` 列出显式安装的包，挑三个说明用途。
2. 用 `pacman -Ss` 搜一个软件，再在浏览器中到 AUR 搜同一个名字，比较结果形式。
3. 运行 `pacman -Qu`，记录有多少个包可升级，但先不升级。
4. 打开一期 Arch News，说明它是否要求手动干预。

## 自检

- [ ] 能用自己的话解释滚动更新与固定发行版的差别
- [ ] 能说清 core、extra、multilib 与 AUR 的本质区别
- [ ] 能解释为什么不能 `pacman -Sy 包名`
- [ ] 知道 WSL 版缺失哪些能力，并知道去读哪一章
- [ ] 能说出至少两个关于 Arch 的常见误解

## 参考

- [Arch Linux](https://wiki.archlinux.org/title/Arch_Linux)
- [Frequently asked questions](https://wiki.archlinux.org/title/Frequently_asked_questions)
- [Arch compared to other distributions](https://wiki.archlinux.org/title/Arch_compared_to_other_distributions)
- [Arch User Repository](https://wiki.archlinux.org/title/Arch_User_Repository)
