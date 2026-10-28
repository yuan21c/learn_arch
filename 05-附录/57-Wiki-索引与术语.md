# 第 57 章 Wiki 索引与术语

本书不是 Arch Wiki 的替代品，而是它的一条**学习路径**。这一章负责把两者接起来：告诉你每个主题该去第几章读，以及遇到陌生术语时它指的是什么。完整的逐页清单在 `docs/superpowers/specs/2026-10-27-wiki-coverage-checklist.md`，本章只给入口与常见术语。

> 本章目标：知道「深讲 / 精讲 / 索引」三级深度各是什么意思，能按主题域查到对应章节；掌握全书反复出现的术语；知道遇到清单里没有的主题时该去哪里找。
> 对应 Wiki：[Main page](https://wiki.archlinux.org/title/Main_page)、[General recommendations](https://wiki.archlinux.org/title/General_recommendations)

## 三级深度：哪些值得读，哪些只需知道

| 级别 | 判定 | 在书里的形态 |
| --- | --- | --- |
| 深讲 | 主线必经，或与开发工作强相关（Web、数据库） | 独立章节：概念 → 命令 → 练习 → 自检 |
| 精讲 | 与主线相关但低频 | 某章内的一节：概述 + 核心命令 + Wiki 链接 |
| 索引 | 边缘或高度场景化 | 只在本章与 Wiki 清单里出现，不展开 |

判定标准不是「重不重要」，而是**你有多大概率在半年内真正用到它**。用到概率高的深讲，偶尔用的精讲，可能永远不用的只留索引——这样书才能既覆盖全，又不臃肿。

阅读原则：深讲章节的练习必须做完；精讲读一遍、留个印象、用到时再回来；索引知道「它在哪一页」就够了。

## 主题域落点表

按 Arch Wiki 的分类体系组织，每个主题域给出在本书里的落点：

| Wiki 主题域 | 代表页面 | 本书落点 | 级别 |
| --- | --- | --- | --- |
| 安装 | Installation guide、Partitioning | 第 43-45 章 | 精讲（假设已完成） |
| 启动 | Arch boot process、Kernel、Mkinitcpio、GRUB、Systemd-boot | 第 41 章 | 深讲 |
| 包管理 | Pacman、Package signing、Makepkg、PKGBUILD、AUR | 第 24-26、35-37 章 | 深讲 |
| 系统维护 | System maintenance、Pacman troubleshooting、Arch News | 第 38-40 章 | 深讲 |
| systemd | Systemd、Timers、Journal、fstab | 第 32-33 章、第 46 章 | 深讲 |
| 通用概念 | General recommendations、File systems、Inodes | 第 5、16 章 | 深讲 |
| 用户与权限 | Users and groups、Sudo、ACL、PAM | 第 6-8 章、第 27 章、第 53 章 | 深讲/精讲 |
| Shell | Bash、Command line、Vim、Core utilities | 第 2-4、8-9、14 章 | 深讲 |
| 进程 | Processes、Signals、Scheduling | 第 13 章 | 深讲 |
| 存储 | LVM、Swap、Disk cloning、Dm-crypt | 第 16 章 | 深讲（LVM/加密精讲） |
| 网络 | Network configuration、OpenSSH、Nftables、DNS | 第 18 章 | 深讲/精讲 |
| 安全 | Security、Firewalls、AppArmor | 第 53 章 | 精讲 + 索引 |
| Web 与数据库 | nginx、Apache、MySQL/MariaDB、PostgreSQL | 第 47-51 章 | 深讲 |
| 容器与虚拟化 | Docker、Podman、libvirt | 第 52 章 | 深讲/精讲 |
| 图形与桌面 | Xorg、Wayland、Display manager、GPU | 第 54 章 | 精讲（VM 实践） |
| 多媒体、打印、电源 | Multimedia、CUPS、Power management、输入法 | 第 55 章 | 精讲 + 索引 |
| 其余长尾 | 浏览器、办公、音频视频、蓝牙等 | 本章的索引（不展开） | 索引 |

清单里没有的主题怎么办？两个入口：Wiki 顶部的搜索框（按关键词搜，不要按目录逐层点），以及页面底部的 `Related articles`（顺着相邻主题走）。两者都比「从头读分类树」高效。

## 术语表

| 术语 | 含义 | 详见 |
| --- | --- | --- |
| 内核 | 管理系统资源的核心程序，负责进程调度、内存、驱动、系统调用 | 第 1 章 |
| 发行版 | 内核 + 用户空间 + 包管理器 + 默认配置的组合 | 第 1 章 |
| 系统调用 | 用户程序请求内核服务的受控入口，man 第 2 节 | 第 12 章 |
| inode | 文件系统里描述一个文件（权限、时间、数据块位置）的结构 | 第 5 章 |
| 挂载 | 把某个文件系统的根接到目录树的某个节点上 | 第 16 章 |
| 硬链接 / 软链接 | 指向同一 inode 的目录项 / 指向路径的独立文件 | 第 3 章 |
| FHS | 文件系统层次标准，规定各目录该放什么 | 第 5 章 |
| SUID / SGID / Sticky | 三种特殊权限位，分别影响执行身份与删除保护 | 第 6 章 |
| ACL | 在 rwx 三组之外，给单个用户或组额外授权 | 第 6 章 |
| umask | 新建文件/目录时默认屏蔽掉的权限位 | 第 6 章 |
| PAM | 可插拔认证模块，登录、su、sudo 的认证链 | 第 8 章 |
| 进程 / PID | 程序的运行实例 / 它的编号；PID 1 是 init | 第 12-13 章 |
| 信号 | 内核投递给进程的异步通知，如 TERM、KILL | 第 13 章 |
| nice 值 | 影响 CPU 时间分配的权重，范围 -20 到 19 | 第 13 章 |
| 僵尸 / 孤儿 | 已退出未被回收 / 父进程先死的进程 | 第 13 章 |
| 块设备 | 能按块读写的设备，如硬盘、SSD、虚拟磁盘 | 第 16 章 |
| 分区表 | 描述磁盘上各分区边界的数据结构，MBR 或 GPT | 第 16 章 |
| fstab | 开机自动挂载的配置表，六个字段 | 第 16 章 |
| swap | 内存紧张时换出匿名页的磁盘空间 | 第 16 章 |
| LVM | 在磁盘与文件系统之间的三层抽象：PV/VG/LV | 第 16 章 |
| ABI | 二进制接口；程序依赖它，而不是库的名字 | 第 19 章 |
| initramfs | 启动早期的小型根文件系统，负责挂载真正的根 | 第 16、41 章 |
| ESP | EFI 系统分区，FAT32，存放引导程序 | 第 16、41 章 |
| 单元（unit） | systemd 的管理对象：service、timer、socket、target 等 | 第 17、32 章 |
| journal | systemd 的结构化日志，用 journalctl 读 | 第 17、32 章 |
| PKGBUILD | 描述如何构建一个包的 Bash 脚本 | 第 36 章 |
| makepkg | 按 PKGBUILD 构建本地包的工具 | 第 35 章 |
| AUR | 用户提交的 PKGBUILD 集合，非官方、无二进制包 | 第 37 章 |
| `.pacnew` | 升级时包里的新配置，与你的修改并存 | 第 29、38 章 |
| merged-usr | `/bin`、`/sbin`、`/lib` 并入 `/usr` 的现代布局 | 第 34 章 |
| nftables | 现代 Linux 防火墙框架，表/链/规则三层 | 第 14、53 章 |

## 遇到问题时的查找顺序

1. **先查本书**：概念与流程在对应章节，命令速查在第 56 章。
2. **再查 `man`**：`man 命令`、`man 5 配置文件`、`man 7 主题`，比任何博客都准。
3. **再查 Wiki**：按关键词搜索，注意页面顶部的警告框与「适用于」说明。
4. **最后查 Arch News 与论坛**：前者管「这次升级要不要手动干预」，后者管「别人是否遇到过同样现象」。

第 23 章讲过 Wiki 的阅读方法与错误搜索技巧，遇到具体报错时先回看那一章。

## 小结

- 三级深度：深讲（独立章）、精讲（章内一节）、索引（只留位置）；判定依据是「半年内真正用到的概率」。
- 主题域落点表把 Wiki 的 17 个主题域映射到本书章节，完整逐页清单在覆盖清单文件里。
- 术语表覆盖全书反复出现的基础词汇，每个都指回讲它的章节。
- 查找顺序：本书 → `man` → Wiki → News/论坛；Wiki 用搜索与 `Related articles`，不要逐层点分类树。

## 练习

1. 用落点表定位三个主题（容器、ACL、启动）分别在哪一章，并写出该章的一个小节名。
2. 挑术语表里你原本不认识的五个术语，去对应章节找到它的定义与一个可执行例子。
3. 打开 Arch Wiki 的 `General recommendations`，找出它提到的三个主题，判断各自属于「深讲/精讲/索引」。
4. 用 Wiki 搜索框搜一个具体报错短语，记录结果页面与它给出的第一步排查动作。
5. 打开覆盖清单文件，找出「安全」主题域下被标为索引级的三个页面，说明为什么它们只留索引。

## 自检

- [ ] 能解释三级深度的判定标准，并说明为什么它比「按目录全展开」更适合学习
- [ ] 能不看表说出五个主题域的落点章节
- [ ] 能解释 inode、挂载、initramfs、PKGBUILD、`.pacnew` 这几个高频术语
- [ ] 知道完整逐页清单在哪里，以及它和本章的分工
- [ ] 遇到陌生主题时，能按「本书 → man → Wiki → News」的顺序自查

## 参考

- [Main page](https://wiki.archlinux.org/title/Main_page)
- [General recommendations](https://wiki.archlinux.org/title/General_recommendations)
- [Arch Wiki 的搜索](https://wiki.archlinux.org/index.php?search=)
