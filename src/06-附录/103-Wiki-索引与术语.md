# 第 103 章 Wiki 索引与术语

本书不是 Arch Wiki 的替代品，而是它的一条**学习路径**。这一章负责把两者接起来：告诉你每个主题该去第几章读，遇到陌生术语时它指的是什么，以及清单里那些没有单独成节的长尾页面被收在哪里。完整的逐页台账在 `docs/superpowers/specs/2026-10-27-wiki-coverage-checklist.md`（859 行，每行都有章号、节名与级别），本章是它的可读入口。

> 本章目标：能按主题或章号在 10 秒内找到对应内容；掌握全书反复出现的术语；知道「深讲 / 精讲 / 索引」三档各是什么意思；能说清长尾页面为什么只留索引。
> 对应 Wiki：[Main page](https://wiki.archlinux.org/title/Main_page)、[General recommendations](https://wiki.archlinux.org/title/General_recommendations)

## 三种查法：按主题、按章号、按术语

| 你要找 | 用哪张表 | 位置 |
| ---------------------- | ---------------------- | ------------------ |
| 一个主题在哪些章 | 主题速查 | 本章第二节 |
| 第 N 章讲什么 | 全书章节索引 | 本章第三节 |
| 某个词是什么意思 | 术语表 | 本章第四节 |
| 某个冷门页面在哪 | 长尾页面索引 | 本章第五节 |
| 一条命令怎么写 | 命令速查表 | 第 102 章 |
| 常见错误怎么避免 | 常见坑 | 第 104 章 |

查法之间的顺序是「主题 → 章 → 节 → Wiki 页面」。先定位章，再在该章的 `##` 小节里找具体段落，最后才打开 Wiki 页面看细节；反过来做容易在 Wiki 的分类树里迷路。

## 主题速查

按主题域给出主落点。一个主题跨多章时，第一段是主线，括号内是延伸。

| 主题 | 主落点 | 延伸 |
| ------------------ | ---------------------------------------- | ---------------------- |
| 发行版与 Linux 史 | 第 1 章 §发行版到底是什么 | 第 32 章 |
| 命令、文件与文本 | 第 2–4 章 | 第 11、16 章 |
| 文件系统与目录层次 | 第 5 章 | 第 18、20 章 |
| 权限、用户与提权 | 第 6–9 章 | 第 38、76–78 章 |
| Shell 配置与脚本 | 第 10、14–16 章 | 第 17 章 |
| 进程与 /proc | 第 12 章 §进程与 /proc | 第 13、57 章 |
| 磁盘、分区与挂载 | 第 18 章 | 第 20 章 |
| LVM、btrfs、zram | 第 19 章 | 第 40 章 |
| RAID | 第 21 章 | 第 18 章 |
| LUKS 与 dm-crypt | 第 22 章 | 第 35、40 章 |
| 磁盘健康与数据恢复 | 第 23 章 | 第 56 章 |
| 网络、防火墙、DNS | 第 24–28 章 | 第 25 章 nftables |
| SSH 与远程访问 | 第 26 章 | 第 79 章 |
| 软件安装通用概念 | 第 29 章 | 第 41 章 |
| 启动概念与启动深讲 | 第 30 章 | 第 58、62 章 |
| systemd 单元与日志 | 第 31 章 | 第 44–45、63 章 |
| Arch 安装 | 第 35–39 章 | 第 36 章引导器 |
| 备份、快照与迁移 | 第 40 章 | 第 56 章 |
| pacman | 第 41–43 章 | 第 52 章 |
| 打包、AUR 与自建仓库 | 第 47–51 章 | 第 43 章密钥环 |
| 升级、维护与排障 | 第 52–54 章 | 第 57 章 |
| 救援与 chroot | 第 55 章 | 第 56 章 |
| 性能观测 | 第 57 章 | 第 23 章 |
| UEFI、内核与 Secure Boot | 第 59–61 章 | 第 58、62 章 |
| Web 服务与 TLS | 第 64–66 章 | 第 70 章 |
| 数据库 | 第 67–69 章 | 第 70 章 |
| 容器与编排 | 第 71–73 章 | 第 75 章 |
| 虚拟化与沙箱 | 第 74–75 章 | 第 71 章 |
| 安全加固与密码学 | 第 76–80 章 | 第 26、61 章 |
| 图形栈与显卡驱动 | 第 81–82 章 | 第 58 章内核参数 |
| Xorg 与输入 | 第 83 章 | 第 87 章 |
| Wayland 与合成器 | 第 84 章 | 第 86 章 |
| 桌面环境与显示管理器 | 第 85–86 章 | 第 87 章 |
| 主题、字体与缩放 | 第 87 章 | 第 101 章 |
| 音频与专业音频 | 第 88–89 章 | 第 90 章 |
| 视频、图像与截图 | 第 90–91 章 | 第 95 章 |
| 打印与扫描 | 第 92 章 | 第 88 章 |
| 电源管理 | 第 93 章 | 第 60 章内核参数 |
| 输入法 | 第 94 章 | 第 101 章 |
| 媒体服务器与语音 | 第 95 章 | 第 90 章 |
| 浏览器、办公、科学计算 | 第 96–98 章 | 第 17 章 |
| 游戏、兼容层与创作 | 第 99 章 | 第 82 章 |
| 文件管理、搜索与启动器 | 第 100 章 | 第 87 章 |
| 无障碍与本地化 | 第 101 章 | 第 87 章 |

## 全书章节索引

按章号排列，三章一行。需要具体小节时，打开该章看 `##` 标题，或在覆盖清单里按章号检索。

| 章 | 主题 | 章 | 主题 | 章 | 主题 |
| --- | --- | --- | --- | --- | --- |
| 1 | 认识 Linux 与发行版 | 36 | pacstrap、chroot 与引导器 | 71 | 容器基础 |
| 2 | Shell 与命令行基础 | 37 | 首次启动与基础验收 | 72 | 容器运行时与镜像构建 |
| 3 | 文件与目录操作进阶 | 38 | 用户、sudo 与默认 shell | 73 | 容器编排与集群 |
| 4 | 文本处理与编辑器 | 39 | 安装后配置与镜像源备份 | 74 | 虚拟化：QEMU、KVM 与 libvirt |
| 5 | 文件系统与目录层次 | 40 | 备份、快照与迁移 | 75 | 虚拟化平台与沙箱 |
| 6 | 权限管理 | 41 | pacman 的模型与铁律 | 76 | 安全加固基础 |
| 7 | 权限深入：UID、ACL 与文件能力 | 42 | 安装、卸载与查询 | 77 | 威胁模型与最小权限 |
| 8 | 用户与用户组 | 43 | 缓存、降级与密钥环 | 78 | MAC 与完整性 |
| 9 | sudo 与提权安全 | 44 | systemd 单元与日志 | 79 | 审计、入侵检测与响应 |
| 10 | 环境变量与 Shell 配置 | 45 | service 与 timer 实战 | 80 | 密码学、隐私与密钥管理 |
| 11 | 管道、重定向与权限综合实验 | 46 | 文件层次与包所有权 | 81 | 图形栈与显示服务器 |
| 12 | 通向进阶：进程、系统调用与 /proc | 47 | makepkg 工作流 | 82 | 显卡驱动与硬件加速 |
| 13 | 进程管理 | 48 | PKGBUILD 逐行详解 | 83 | Xorg 配置与输入 |
| 14 | Shell 脚本编程 | 49 | AUR 机制与助手 | 84 | Wayland 与合成器 |
| 15 | Shell 脚本进阶 | 50 | 自定义仓库与发布 | 85 | 桌面环境 |
| 16 | Shell 工程化、文本处理与正则 | 51 | 构建进阶、多版本与数据库修复 | 86 | 显示管理器与会话 |
| 17 | 终端、编辑器与开发环境 | 52 | 升级流程与 Arch News | 87 | 桌面集成、主题与辅助 |
| 18 | 磁盘与存储 | 53 | 常见故障处理 | 88 | 桌面日常总览 |
| 19 | 存储进阶：LVM、btrfs 与 zram | 54 | 维护与排障总则 | 89 | 专业音频与 MIDI |
| 20 | 分区、文件系统与挂载进阶 | 55 | 救援与 chroot | 90 | 视频与编解码 |
| 21 | RAID 与存储虚拟化 | 56 | 文件恢复与恢复后处理 | 91 | 图像、色彩与截图 |
| 22 | 加密存储：LUKS 与 dm-crypt | 57 | 性能分析与系统观测 | 92 | 打印与扫描 |
| 23 | 磁盘健康、修复与数据恢复 | 58 | 启动深讲：内核、initramfs 与引导器 | 93 | 电源管理 |
| 24 | 网络基础 | 59 | UEFI 与固件 | 94 | 输入法 |
| 25 | 防火墙与路由 | 60 | 内核、模块与 initramfs | 95 | 媒体服务器、语音与其他 |
| 26 | SSH 与远程访问 | 61 | Secure Boot：签名、shim 与 MOK | 96 | 浏览器与网络应用 |
| 27 | DNS 与域名解析 | 62 | 启动故障诊断 | 97 | 办公、文档与笔记 |
| 28 | 网络排障与服务 | 63 | 用 systemd 托管你的应用 | 98 | 科学、开发与仿真 |
| 29 | 软件安装的通用概念 | 64 | Web 服务：nginx | 99 | 游戏、兼容层与多媒体制作 |
| 30 | 系统启动概念 | 65 | TLS 与 HTTPS | 100 | 桌面工具、文件管理与搜索 |
| 31 | 系统服务概念与日志 | 66 | Web 服务：Apache 与 Caddy | 101 | 无障碍、本地化与输入 |
| 32 | Linux 体系结构与开源生态 | 67 | 数据库：MySQL/MariaDB | 102 | 命令速查表 |
| 33 | 认识 Arch Linux | 68 | 数据库：PostgreSQL | 103 | Wiki 索引与术语 |
| 34 | 学习地图与 Wiki 方法 | 69 | 数据库进阶与选型 | 104 | 常见坑与里程碑 |
| 35 | 安装准备与分区 | 70 | Web 可观测性与部署 |  |  |

## 术语表

只收全书反复出现、且后文默认你已经懂的词。每个词指回讲它的章；定义只给一句话，展开在对应章。

| 术语 | 一句话定义 | 详见 |
| -------------------- | ---------------------------------------------------------- | ------------ |
| 内核 | 管理系统资源的核心程序，负责调度、内存、驱动与系统调用 | 第 1 章 |
| 发行版 | 内核 + 用户空间 + 包管理器 + 默认策略的组合 | 第 1 章 |
| 系统调用 | 用户程序请求内核服务的受控入口，见 man 第 2 节 | 第 12 章 |
| inode | 描述文件元数据（权限、时间、数据块位置）的结构，不含文件名 | 第 5 章 |
| 挂载 | 把某个文件系统的根接到目录树的某个节点上 | 第 18、20 章 |
| 硬链接 / 软链接 | 指向同一 inode 的目录项 / 指向路径的独立文件 | 第 3 章 |
| FHS | 文件系统层次标准，规定各目录该放什么 | 第 5 章 |
| SUID / SGID / Sticky | 三种特殊权限位，分别影响执行身份、继承组与删除保护 | 第 6–7 章 |
| ACL | 在 rwx 三组之外，给单个用户或组额外授权 | 第 7 章 |
| umask | 新建文件/目录时默认屏蔽掉的权限位 | 第 6 章 |
| PAM | 可插拔认证模块，登录、su、sudo 共用的认证链 | 第 8 章 |
| 进程 / PID | 程序的运行实例 / 它的编号；PID 1 是 init | 第 12–13 章 |
| 信号 | 内核投递给进程的异步通知，如 TERM、KILL | 第 13 章 |
| nice 值 | 影响 CPU 时间分配的权重，范围 -20 到 19 | 第 13 章 |
| 僵尸 / 孤儿 | 已退出未被回收 / 父进程先死的进程 | 第 13 章 |
| 块设备 | 能按块读写的设备，如硬盘、SSD、虚拟磁盘 | 第 18 章 |
| 分区表 | 描述分区边界的数据结构；现代机器用 GPT | 第 18、20 章 |
| fstab | 开机自动挂载的配置表，六个字段 | 第 18、20 章 |
| swap | 内存紧张时换出匿名页的空间，可以是分区、文件或 zram | 第 19–20 章 |
| LVM | 在磁盘与文件系统之间的三层抽象：PV/VG/LV | 第 19 章 |
| RAID | 多块盘组合出冗余或性能，级别决定账怎么算 | 第 21 章 |
| LUKS | 块设备加密的标准格式，dm-crypt 负责加解密 | 第 22 章 |
| SMART | 磁盘自监控指标，用于提前发现坏盘 | 第 23 章 |
| ABI | 二进制接口；程序依赖它，而不是库的名字 | 第 29 章 |
| initramfs | 启动早期的小型根文件系统，负责挂载真正的根 | 第 58、60 章 |
| ESP | EFI 系统分区，FAT32，存放引导程序与固件驱动 | 第 59 章 |
| 单元（unit） | systemd 的管理对象：service、timer、socket、target 等 | 第 44 章 |
| journal | systemd 的结构化日志，用 journalctl 读 | 第 44 章 |
| target | 一组单元的集合，相当于「运行级别」 | 第 44 章 |
| PKGBUILD | 描述如何构建一个包的 Bash 脚本 | 第 48 章 |
| makepkg | 按 PKGBUILD 构建本地包的工具 | 第 47 章 |
| AUR | 用户提交的 PKGBUILD 集合，非官方、不提供二进制包 | 第 49 章 |
| `.pacnew` | 升级时包里的新配置，与你的修改并存，需人工合并 | 第 52 章 |
| merged-usr | `/bin`、`/sbin`、`/lib` 并入 `/usr` 的现代布局 | 第 46 章 |
| nftables | 现代防火墙框架，按表/链/规则三层组织 | 第 25 章 |
| SSH | 加密远程登录与隧道协议，信任建立在主机密钥上 | 第 26 章 |
| sudo | 按 `/etc/sudoers` 条目代理执行的提权工具 | 第 9 章 |
| 威胁模型 | 先问「保护什么、怕谁、怎么进来、代价多少」 | 第 77 章 |
| AppArmor / SELinux | 按路径 / 按标签限制程序的强制访问控制 | 第 78 章 |
| 审计 | 记录「谁在什么时候做了什么」，与日志分工不同 | 第 79 章 |
| 容器 / 命名空间 | 共享内核的隔离进程；隔离靠 namespace 与 cgroup | 第 71 章 |
| 镜像 / 层 | 容器文件系统的只读模板，按层叠加并可缓存 | 第 72 章 |
| hypervisor | 运行虚拟机的软件层；KVM 是内核模块，QEMU 是模拟器 | 第 74 章 |
| X11 / Wayland | 两代显示服务器协议：客户端绘制与服务端合成 | 第 81、84 章 |
| 显示管理器 | 提供登录界面并启动图形会话的程序 | 第 86 章 |
| PipeWire | 当前桌面常用的音频服务栈，兼容 PulseAudio/JACK 客户端 | 第 88–89 章 |
| CUPS | 打印服务，负责队列、过滤与后端 | 第 92 章 |
| UKI | 把内核、initramfs 与 cmdline 打包成单个 PE 文件 | 第 58、61 章 |
| Secure Boot | 固件按签名链决定是否允许加载引导程序 | 第 61 章 |
| 输入法框架 | 接管按键、维护候选窗口并与应用通信的中间层 | 第 94 章 |

## 长尾页面索引

下表收录「正文按主题簇讲解、但没有逐页展开」的 Wiki 页面，按章归组。它们是**索引级**：知道在哪一章、遇到时去 Wiki 看细节即可，不必背下来。共 353 页。

| 章 | 主题 | 仅索引收录的页面 |
| --- | --- | --- |
| 第 5 章 | 文件系统与目录层次 | Extended attributes |
| 第 8 章 | 用户与用户组 | Category:Universal 2nd Factor |
| 第 16 章 | Shell 工程化、文本处理与正则 | Archiving and compression、Texinfo/Info、Category:Terminal emulators |
| 第 17 章 | 终端、编辑器与开发环境 | Helix、Kakoune、Kate、Micro、Microsoft Edit、Spacemacs、Textadept、Visual Studio Code、Zettlr、Category:Commands |
| 第 18 章 | 磁盘与存储 | Category:Storage、Floppy disks、Media Transfer Protocol、USB storage devices |
| 第 19 章 | 存储进阶：LVM、btrfs 与 zram | Bcache、SnapRAID、Yabsnap、ZFS、ZFS/Virtual disks |
| 第 20 章 | 分区、文件系统与挂载进阶 | Advanced Format、Self-encrypting drives、Solid state drive、Solid state drive/Memory cell clearing、Solid state drive/NVMe、Category:Optical disc |
| 第 21 章 | RAID 与存储虚拟化 | ISCSI、ISCSI/LIO、Open-iSCSI、USB/IP、Category:Storage virtualization、Dynamic disks、Resizing LVM-on-LUKS |
| 第 22 章 | 加密存储：LUKS 与 dm-crypt | ECryptfs、EncFS、Fscrypt、Gocryptfs、Removing system encryption、Tcplay、Tomb、VeraCrypt |
| 第 23 章 | 磁盘健康、修复与数据恢复 | Category:File systems、Hdparm、Identify damaged files、NFS、NTFS、Partclone、Sparse file、Tmpfs、Category:Clustered file systems、Category:FUSE、Category:Pseudo file systems、Category:Stackable file systems、S.M.A.R.T. |
| 第 24 章 | 网络基础 | Iwd、Wpa supplicant、Category:Network managers、Bridge with netctl、ConnMan、Netctl |
| 第 25 章 | 防火墙与路由 | Category:Firewalls、FireHOL、Firewalld、High Performance Firewall、Ipset、Iptables、PeerGuardian Linux、Router、Simple stateful firewall、Uncomplicated Firewall |
| 第 26 章 | SSH 与远程访问 | Dropbear、Fail2ban、Mosh、One Time PassWord、PuTTY、SFTP chroot、Sftpman、SSHFS、Sshguard、VPN over SSH |
| 第 27 章 | DNS 与域名解析 | Cloudflared、CoreDNS、DANE、Dnscrypt-proxy、Dynamic DNS、Openresolv、Pdnsd、Pi-hole、PowerDNS、Rescached、Stubby、Category:Multicast DNS |
| 第 28 章 | 网络排障与服务 | Category:Network configuration、Category:Networking、Category:Wireless networking |
| 第 39 章 | 安装后配置与镜像源备份 | Ghostmirror、Mirrors、Official repositories、Pacserve、Unofficial mirrors、Unofficial user repositories |
| 第 42 章 | 安装、卸载与查询 | Pkgfile、Pkgstats |
| 第 45 章 | service 与 timer 实战 | Autostarting |
| 第 47 章 | makepkg 工作流 | Patching packages、Ccache、Clang、Distcc |
| 第 48 章 | PKGBUILD 逐行详解 | Desktop entries |
| 第 49 章 | AUR 机制与助手 | Aurweb RPC interface、AUR Cleanup Day、Bug Day |
| 第 50 章 | 自定义仓库与发布 | Reproducible builds、Reproducible builds/Status、Category:Package development、Abuild、Perl Policy |
| 第 51 章 | 构建进阶、多版本与数据库修复 | Bisecting bugs with Git、Rebuilderd、Guix、Nix、Pkgsrc、DeveloperWiki:Building in a clean chroot、Debugging/Getting traces、Debuginfod |
| 第 57 章 | 性能分析与系统观测 | Debugging、Category:Monitoring |
| 第 58 章 | 启动深讲：内核、initramfs 与引导器 | Activating numlock on bootup |
| 第 59 章 | UEFI 与固件 | Category:Bootsplash |
| 第 60 章 | 内核、模块与 initramfs | Booster、Dracut、Kbuilder、Machine-check exception、Modalias、Modprobed-db、SystemTap |
| 第 63 章 | 用 systemd 托管你的应用 | Category:Init、BusyBox、ConsoleKit、Init、OpenRC、Runit |
| 第 64 章 | Web 服务：nginx | Hiawatha、Lighttpd、Miniserve、UWSGI、XAMPP |
| 第 67 章 | 数据库：MySQL/MariaDB | Galera |
| 第 68 章 | 数据库：PostgreSQL | PostGIS |
| 第 69 章 | 数据库进阶与选型 | Category:Database management systems、Open Database Connectivity、Oracle Database client、Category:Relational DBMSs、H2 |
| 第 70 章 | Web 可观测性与部署 | Category:System monitors、Fbpanel |
| 第 71 章 | 容器基础 | Category:Virtualization、Category:Sandboxing、Bubblejail |
| 第 74 章 | 虚拟化：QEMU、KVM 与 libvirt | Category:Hypervisors |
| 第 75 章 | 虚拟化平台与沙箱 | Citrix |
| 第 76 章 | 安全加固基础 | Category:Security |
| 第 78 章 | MAC 与完整性 | Core dump、Trusted Platform Module、Trusted Platform Module/1.2、Category:Intrusion detection、Category:Security testing、Category:Surveillance |
| 第 79 章 | 审计、入侵检测与响应 | Category:Logging |
| 第 80 章 | 密码学、隐私与密钥管理 | Oo7、Parental control、Category:Anonymity networks、Category:Cryptography、Category:Proxy servers、Category:Virtual Private Network |
| 第 81 章 | 图形栈与显示服务器 | Category:Desktop environments、Category:Display managers、Category:Graphics、Category:Displays、Category:Window managers |
| 第 82 章 | 显卡驱动与硬件加速 | ATI、Bumblebee、External GPU、Via Technologies、Graphics processing unit |
| 第 83 章 | Xorg 配置与输入 | Cursor themes、Extreme Multihead、IMWheel、Mouse acceleration、Mouse buttons、Multi-pointer X、Multihead、Multiseat、Xbindkeys、Xcompmgr、Xcursorgen、Xhost、Xsettingsd |
| 第 84 章 | Wayland 与合成器 | Gammastep、Hyprlock、Kanshi、Waybar、Cagebreak、Dwl、Gamescope、MangoWM、Niri、River、River-classic、Weston |
| 第 85 章 | 桌面环境 | Budgie、COSMIC、Cutefish、Enlightenment、Pantheon、SonicDE、Sugar、Trinity、Category:LXDE |
| 第 86 章 | 显示管理器与会话 | Atrium、CDM、Console TDM、LXDM、Ly、SLiM、XDM |
| 第 87 章 | 桌面集成、主题与辅助 | Clipboard、Display Power Management Signaling、Dunst、Greenclip、Idesk、RecordMyDesktop、Redshift、Slock、Sxhkd、Unclutter、Variable refresh rate、Volnoti、XDMCP、Xephyr、XLibre、Xlivebg、Xpra、XScreenSaver |
| 第 88 章 | 音频栈 | Category:Sound、Open Sound System、Pacat、Sound system |
| 第 90 章 | 视频与编解码 | Blu-ray、Codecs and containers、Dvdbackup、MEncoder、Optical disc drive、Screen capture、DaVinci Resolve、Flowblade、MPlayer、Open Broadcaster Software、V4l2loopback |
| 第 91 章 | 图像、色彩与截图 | ICC profiles |
| 第 92 章 | 打印与扫描 | Category:Printers、Canon CAPT、Canon cnrdrvcups-lb Driver、Lexmark、LPRng、Packaging Brother printer drivers、PrusaSlicer、RepRap |
| 第 93 章 | 电源管理 | Acpid、APC UPS、CyberPower UPS、Network UPS Tools、Powertop、Undervolting CPU、Wake-on-LAN |
| 第 94 章 | 输入法 | Gcin、Mozc、Nimf、Uim |
| 第 95 章 | 媒体服务器、语音与其他 | Category:Multimedia、Blender、Festival、Hypnotix、MPRIS、PeerTube、RHVoice、Sheepit、Speech dispatcher、Envy24control、FiiO-BTR3 DAC、HyperX Cloud Alpha Wireless、SoundBlasterX G6、TerraTec Aureon 7.1、Category:Video、Paramano、Category:Television |
| 第 96 章 | 浏览器与网络应用 | Category:Web browser、Badwolf、Blisk Browser、Browser extensions、Dillo、ELinks、GNOME/Web、Luakit、Nyxt、Qutebrowser、Surf、Vivaldi、W3m、Category:Internet applications、Category:Web applications |
| 第 97 章 | 办公、文档与笔记 | Anki、Groff、Mailnag、Mnemosyne、Remind、AbiWord、Apache OpenOffice、GNOME/Document viewer、Gobby、InvoicePlane、Ledger、Llpp、Lout、MuPDF、Odoo、Category:Dictionaries、Category:TeX |
| 第 98 章 | 科学、开发与仿真 | Graphviz、Language checking、Splunk、Category:Application launchers、Category:Console applications、Category:Data compression and archiving、Category:File managers、Category:Science、Category:Search、Category:Simulation |
| 第 99 章 | 游戏、兼容层与多媒体制作 | Category:Emulation、Category:Gaming |
| 第 100 章 | 桌面工具、文件管理与搜索 | Category:Applications、Fluxer、List of applications、List of applications/Documents、List of applications/Other、List of applications/Utilities、Oblogout、Bluetooth |
| 第 101 章 | 无障碍、本地化与输入 | Category:Accessibility |

## 遇到问题时的查找顺序

1. **先查本书**：概念与流程在对应章节，命令速查在第 102 章，坑在第 104 章。
2. **再查 `man`**：`man 命令`、`man 5 配置文件`、`man 7 主题`，比任何博客都准。
3. **再查 Wiki**：按关键词搜索，注意页面顶部的警告框与「适用于」说明；不要从分类树顶层逐层点。
4. **最后查 Arch News 与论坛**：前者管「这次升级要不要手动干预」，后者管「别人是否遇到过同样现象」。

第 34 章讲过 Wiki 的阅读方法与错误搜索技巧，遇到具体报错时先回看那一章。

## 失败模式

| 现象 | 根因 | 处置 |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------- |
| 按主题查到章，却在章里找不到关键词 | 主题被拆成「概念 + 实操」两节，关键词在另一节 | 先读该章 `##` 标题，再用章内搜索；覆盖清单给出的是节级落点 |
| 以为「索引级」等于「不重要」 | 把覆盖深度当成价值判断 | 索引级只是「半年内用不到」，需要时按表跳转即可 |
| 跟着旧博客的章号找内容 | 本书章号在 2026-11 结构重整后变过 | 以本章章节索引与 SUMMARY 为准，旧编号只在覆盖清单的历史注记里出现 |
| 把术语表的定义当成完整解释 | 一句话定义只够建立坐标系 | 定义后面标的章才是正文，例子与边界都在那里 |
| 在 Wiki 分类树里越走越远 | 分类页是「归档」而不是「教程」 | 用搜索框 + `Related articles`，或直接按本章落点表跳转 |

## 验证与回滚

这一章是查阅型内容，验证方式是「能否在限定时间内找到」：

```bash
# 1) 章数是否与 SUMMARY 一致（应为 104）
grep -c '^- \[第' src/SUMMARY.md
# 2) 章内是否真有小节（任选三章抽查）
grep -n '^## ' src/02-Linux-进阶/22-加密存储-LUKS-与-dm-crypt.md
# 3) 台账行数与「无索引残留」自检
grep -c '^| \[' docs/superpowers/specs/2026-10-27-wiki-coverage-checklist.md
grep -c '| 索引 |' docs/superpowers/specs/2026-10-27-wiki-coverage-checklist.md
```

预期：第 1 条为 104；第 2 条给出该章的 6–8 个小节；第 3 条为 859；第 4 条为 0。若第 4 条非 0，说明清单又被写回了「索引」空落点，按本章第五节补章号与节名。

回滚：本章与台账都是文档，改坏了用 `git diff` 查看并 `git checkout -- <文件>` 即可；不要用脚本批量覆盖台账，先备份再合并。

## 取舍边界

- **本章 vs 覆盖清单**：本章给人读（主题、章号、术语），清单给审计用（859 行逐页、节级落点）。两者不一致时以清单的落点为事实，以本章的表述为入口。
- **索引 vs 精讲**：长尾页面留在索引，是因为单独成节会让书变成软件目录；主题簇有精讲节，具体页面按需跳 Wiki。
- **全 vs 薄**：本书选择「主线深、支线薄」。如果某个支线你半年内会用三次以上，它就不再是支线，应按第 104 章的「完成本书之后」继续深入。
- **章号稳定 vs 结构最优**：104 章编号已经冻结；后续修订只改内容，不再重排章号，避免所有交叉引用失效。

## 小结

- 三种查法：主题速查、章节索引、术语表；命令与坑分别在第 102、104 章。
- 全书 6 篇 104 章，章节索引按章号两列排布，可直接定位。
- 术语表只收高频词，每个词都指回正文；一句话定义不等于完整解释。
- 长尾页面按章归组收在第五节，索引级不等于不重要。
- 台账（覆盖清单）是审计事实，本章是它的可读入口；两者以台账落点为准。

## 练习

1. 只用本章的「主题速查」，找出 LUKS、nftables、PipeWire 三个主题的主落点章，并写出该章的一个小节名。
2. 用「全书章节索引」找出第 45、61、92 章的主题；再打开其中一章，确认它的 `##` 小节与索引描述一致。
3. 从术语表挑五个你原本不认识的词，去对应章找到定义与一个可执行例子。
4. 在「长尾页面索引」里找三个页面，说明它们为什么只留索引而不是单独成节。
5. 用第 102 章查出一条你需要的命令，再用本章确认它属于哪一章的知识点。
6. 打开覆盖清单，随机抽 10 行，核对「落点」的章号与节名是否真存在于正文（用 `grep '^## '`）。

## 自检

- [ ] 能在 10 秒内把任意主题定位到章，并说出该章一个小节
- [ ] 能解释深讲、精讲、索引三档的判定标准
- [ ] 能说出至少 10 个高频术语的一句话定义与出处
- [ ] 知道长尾页面收在本章第五节，且知道为什么这样处理
- [ ] 知道台账文件在哪里，以及它和本章的分工
- [ ] 遇到陌生主题时，能按「本书 → man → Wiki → News」的顺序自查

## 参考

- [Main page](https://wiki.archlinux.org/title/Main_page)
- [General recommendations](https://wiki.archlinux.org/title/General_recommendations)
- [Arch Wiki 搜索](https://wiki.archlinux.org/index.php?search=)
- 上一章：[第 102 章 命令速查表](102-命令速查表.md)
- 下一章：[第 104 章 常见坑与里程碑](104-常见坑与里程碑.md)
