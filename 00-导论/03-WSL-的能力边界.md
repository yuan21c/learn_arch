# 03 WSL 的能力边界

WSL 里的 Arch 能让你把大部分日常维护练熟，但它不是一台完整的 Arch 机器。先把边界搞清楚，可以避免在学不到的地方浪费时间，也能避免把 WSL 的特例当成 Arch 的通例。

> 本章目标：理解 WSL 2 的架构，能判断一项任务在 WSL 中是否可行，并知道什么时候该转到虚拟机或真机。
> 对应 Wiki：[WSL](https://wiki.archlinux.org/title/WSL)

## WSL 2 的架构

WSL 2 不是“Windows 上的 Linux 兼容层”，而是一台轻量虚拟机：

| 组成 | 说明 |
| --- | --- |
| 轻量虚拟机 | Hyper-V 之上的实用工具虚拟机，启动快、内存按需分配 |
| 微软内核 | 由微软构建和维护的 Linux 内核，你不负责编译和升级 |
| 用户空间 | 你安装的 Arch 根文件系统，运行在这台虚拟机里 |
| interop | 允许从 Linux 调用 Windows 程序，反之亦然 |
| `/mnt/c` 等挂载 | Windows 盘符通过特定文件系统挂载到 Linux 路径下 |

```bash
# 看内核是谁的
uname -a

# 看 Windows 盘挂在哪、用什么文件系统
mount | grep -i 'drvfs\|9p'
```

`uname -a` 中出现 `microsoft-standard-WSL2` 之类的标识，说明你用的是微软内核，不是 Arch 官方内核。

## 能学与不能学

| 主题 | WSL | 虚拟机 | 真机 | 说明 |
| --- | --- | --- | --- | --- |
| pacman / AUR / makepkg | 完整 | 完整 | 完整 | 与发行版无关 |
| systemd 服务与日志 | 基本完整 | 完整 | 完整 | 需要先启用 systemd |
| 用户、权限、文件层次 | 完整 | 完整 | 完整 | 在 Linux 文件系统内有效 |
| 内核编译与模块 | 不可 | 可以 | 可以 | 内核由微软提供 |
| 引导器 / initramfs | 不可 | 可以 | 可以 | WSL 不经过引导器 |
| 分区 / LUKS / 文件系统 | 不可 | 可以 | 可以 | 根文件系统位于虚拟磁盘镜像 |
| 设备、udev、显卡驱动 | 受限 | 部分 | 完整 | 硬件不直通 |
| 桌面环境 | 不适用 | 可以 | 可以 | WSLg 是另一套机制，不是完整桌面栈 |

判断方法：一项任务如果依赖“启动过程、块设备、内核模块、真实硬件”，在 WSL 里大概率学不到；如果只依赖用户空间工具和配置文件，通常可以。

## systemd 在 WSL 中的支持与限制

较新的 WSL 2 支持把 systemd 作为 PID 1，通过 `/etc/wsl.conf` 启用。启用后：

- `systemctl`、`journalctl`、unit 文件、timer 的行为与普通 Arch 基本一致。
- 适合练习 service、timer、日志查询和依赖关系。
- 但启动相关的内容仍然不同：没有引导器、没有 initramfs、内核不是 Arch 的。

```bash
# 确认 PID 1
ps -p 1 -o comm=

# 确认 systemd 状态
systemctl is-system-running
```

如果 PID 1 是 `init` 而不是 `systemd`，说明尚未启用。启用步骤见 [首次启动与 systemd](../01-环境准备/01-首次启动与-systemd.md)。

限制主要不在 systemd 本身，而在它管理的对象：硬件、挂载、内核模块这些在 WSL 中并不完整。

## WSL 的特殊行为

| 行为 | 表现 | 影响 |
| --- | --- | --- |
| `/etc/resolv.conf` 自动生成 | WSL 可能覆盖该文件 | 手改 DNS 可能失效 |
| 时钟 | 与 Windows 共享时钟，休眠后可能漂移 | 影响签名验证与日志时间 |
| Windows PATH | 默认追加到 Linux PATH | 可能误调用 Windows 程序 |
| 跨文件系统权限 | `/mnt/c` 下权限语义不同 | 权限报错、性能下降 |
| 无引导器 | 启动不经过 GRUB/systemd-boot | 学不到引导流程 |
| 内核不可替换 | 不能通过 pacman 换内核 | 内核、模块实验受限 |

```bash
# 看 PATH 是否被 Windows 目录污染
echo "$PATH" | tr ':' '\n' | grep -i '^/mnt/c'

# 看当前 DNS 配置
cat /etc/resolv.conf
```

项目文件应放在 Linux 文件系统（如 `~/project`），不要放在 `/mnt/c`。跨文件系统不仅权限行为不同，I/O 性能也明显更差。

## 什么时候转到虚拟机或真机

出现以下需求时，WSL 已经不是合适的实验环境：

- 要学习分区、文件系统、LUKS、LVM。
- 要学习引导器、initramfs、内核参数、模块。
- 要验证显卡、无线网卡、蓝牙、指纹等硬件。
- 要安装完整桌面环境并测试登录管理器。
- 要模拟一台可以独立启动、关机的机器。

建议路径：先在 WSL 练用户空间 → 用虚拟机完整安装一次 Arch → 再考虑真机。

## 与真机 Arch 的差异总结

| 维度 | WSL 版 Arch | 真机 Arch |
| --- | --- | --- |
| 内核 | 微软内核 | Arch 内核，可自选 |
| 启动 | WSL 直接启动发行版 | 引导器 + initramfs |
| 磁盘 | 虚拟磁盘镜像 | 真实分区 |
| 硬件 | 受限或不可见 | 完整 |
| 网络 | 由 WSL 网络模式决定 | 由你配置 |
| systemd | 可启用，基本完整 | 完整 |

这些差异不是“配置没做对”，而是平台设计。排障时不要用真机教程硬套 WSL，具体问题见 [WSL 特有问题](../05-维护与排障/03-WSL-特有问题.md)。

## 小结

- WSL 2 是轻量虚拟机，内核由微软提供，用户空间是你安装的 Arch。
- 包管理、systemd、权限、打包可以练；内核、引导、分区、加密、设备学不到。
- systemd 可启用，但启动链路与真机不同。
- `/etc/resolv.conf`、时钟、PATH、跨文件系统权限是 WSL 特例。
- 需要硬件、引导或磁盘能力时，转到虚拟机或真机。

## 练习

1. 用 `uname -a` 确认内核来源，并解释为什么不能通过 pacman 替换它。
2. 用 `mount` 找出所有 Windows 挂载点，记录文件系统类型。
3. 检查 `$PATH` 中是否包含 Windows 目录，说明可能的副作用。
4. 列出你当前想学的三个主题，判断它们在 WSL 中是否可行。

## 自检

- [ ] 能解释 WSL 2 为什么是虚拟机而不是兼容层
- [ ] 能判断一项任务是否属于 WSL 的能力范围
- [ ] 知道 systemd 在 WSL 中能做什么、不能做什么
- [ ] 能说出至少三个 WSL 特殊行为
- [ ] 知道什么阶段该转向虚拟机或真机

## 参考

- [WSL](https://wiki.archlinux.org/title/WSL)
- [Installation guide](https://wiki.archlinux.org/title/Installation_guide)
- [Arch boot process](https://wiki.archlinux.org/title/Arch_boot_process)
