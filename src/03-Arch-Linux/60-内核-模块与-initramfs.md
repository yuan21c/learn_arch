# 第 60 章 内核、模块与 initramfs

内核不是一块不可拆的整体：启动涉及内核镜像、可加载模块、固件与 initramfs。Arch 内核包安装或升级时通常会由 pacman hook 按 preset 重建 initramfs；正在运行的内核与模块要等重启才切换，DKMS 模块也须为新内核构建。自定义 preset、hook 失败或构建错误仍可能留下不匹配的镜像，升级后应检查 hook 与生成结果。

> 本章目标：能区分内核包、模块目录、initramfs 与 DKMS 的职责；会用 `lsmod`、`modinfo`、`modprobe` 与 `/etc/modprobe.d` 管理模块；理解 `mkinitcpio` 的 `HOOKS`、`MODULES`、`FILES` 与 `COMPRESSION`；能读懂 `/proc/cmdline` 与 `sysctl` 的不同层级；知道哪些改动必须重建 initramfs 或重启。
> 对应 Wiki：[Kernel](https://wiki.archlinux.org/title/Kernel)、[Kernel modules](https://wiki.archlinux.org/title/Kernel_module)、[Mkinitcpio](https://wiki.archlinux.org/title/Mkinitcpio)、[Dynamic Kernel Module Support](https://wiki.archlinux.org/title/Dynamic_Kernel_Module_Support)

## 四个组成部分

| 组成 | 位置 | 何时变化 | 谁负责 |
| ------------ | ------------------------------ | -------------------------- | ------------------------------ |
| 内核镜像 | `/boot/vmlinuz-linux` | 升级内核包 | pacman |
| 模块 | `/usr/lib/modules/$(uname -r)/` | 升级内核包或 DKMS 重建 | pacman / DKMS |
| initramfs | `/boot/initramfs-linux.img` | `mkinitcpio -P` | 你（或包钩子） |
| 启动参数 | `/proc/cmdline` | 改引导器配置并重启 | GRUB/systemd-boot |

升级内核包会替换镜像和模块目录，Arch 的 pacman hook 通常会按 preset 重建对应的 initramfs；若 hook 失败、自定义 preset 未覆盖目标镜像，或生成过程报错，就需要先修复再继续启动。改过 `HOOKS` 或使用自定义 preset 时应核对具体生成结果。

## 模块：加载、查询与参数

```bash
uname -r
lsmod | head -n 10
modinfo ext4
modinfo -p 模块名 # 列出可配置参数
sudo modprobe 模块名
sudo modprobe -r 模块名 # 仅当没有被使用时
```

`lsmod` 显示当前加载的模块与引用计数；`modinfo` 读取模块元数据与参数；`modprobe` 按依赖关系加载。`modprobe -r` 在模块被占用时会失败，先查 `lsmod` 的 Used by 列。

永久配置分两类：

- **加载/黑名单**：`/etc/modules-load.d/*.conf` 写「启动时加载」，`/etc/modprobe.d/*.conf` 写 `blacklist 模块名` 或 `install 模块名 /bin/false`。
- **参数**：`/etc/modprobe.d/*.conf` 写 `options 模块名 参数=值`；部分参数只能在加载时设置，运行时改 `/sys/module/.../parameters/` 不一定生效。

`blacklist` 只阻止自动加载，不阻止显式 `modprobe`；要彻底阻止用 `install ... /bin/false`。黑名单写错模块名（用文件名而不是模块名）不会生效。

## 内核包与 DKMS

Arch 的 kernel 包提供镜像、模块与配套的头文件包（如 `linux-headers`）。安装第三方模块时：

- **树内模块**：随内核包提供，升级内核即更新。
- **树外模块**：需要 DKMS 或针对每个内核版本单独构建。`dkms status` 查看状态，内核升级后由 DKMS 自动重建，前提是头文件包已安装。

```bash
dkms status
pacman -Q linux linux-headers
```

DKMS 构建失败通常缺头文件、缺编译器或源码不兼容新内核；先看 `/var/lib/dkms/模块名/` 下的 `build/make.log`。

## initramfs：启动时的小系统

initramfs 是内核启动后、真正根文件系统挂载前运行的最小环境，负责加载存储驱动、解锁 LUKS、组装 RAID/LVM、挂载根。它由 `mkinitcpio` 按配置生成：

```bash
grep -E '^(HOOKS|MODULES|FILES|COMPRESSION)=' /etc/mkinitcpio.conf
ls /etc/mkinitcpio.d/
```

- `HOOKS`：描述 initramfs 的构建与早期启动步骤，顺序影响行为。systemd 早期用户空间使用 `systemd`/`sd-encrypt`；BusyBox 早期用户空间使用 `udev`/`encrypt`，不要把两套加密 hook 混用。具体顺序以当前 mkinitcpio 文档和实际设备拓扑为准。
- `autodetect`：在**构建 initramfs 时**按构建环境的硬件筛选模块，不是启动时对任意目标硬件重新探测；若镜像要在不同硬件上启动，应评估其模块是否被裁掉。
- `MODULES`：强制加入的模块，例如存储控制器或文件系统驱动。
- `FILES`：把额外文件打进 initramfs，例如固件或密钥。
- `COMPRESSION`：压缩算法，影响体积与解压时间。

systemd initramfs 可在支持该参数的 systemd 版本（258 及以上）中，用一次性内核参数 `rd.systemd.break=pre-mount` 或 `rd.systemd.break=pre-switch-root` 暂停启动并进入调试 shell；退出 shell 后启动会继续。当前 mkinitcpio 官方内置 hook 列表没有名为 `break` 的 hook，不要把它直接加入 `HOOKS`。临时调试结束后不要把参数留在持久化启动项中；其他版本或 BusyBox initramfs 应先查对应版本的官方调试方式。

改了 `HOOKS`、`MODULES`、加密、根文件系统或微码后必须重建：

```bash
sudo mkinitcpio -P
```

`-P` 按 `/etc/mkinitcpio.d/` 的 preset 生成所有内核的 initramfs；只改一个内核时可用 `-p linux`。重建后检查文件时间与大小，必要时用 `lsinitcpio` 核对内容。

## 启动参数与 sysctl 不是一回事

- **内核启动参数**：写在 GRUB 的 `GRUB_CMDLINE_LINUX_DEFAULT` 或 systemd-boot 的 entry 里，经 `/proc/cmdline` 读取，只在启动时生效，例如 `root=`、`rw`、`nomodeset`、`loglevel=7`。
- **sysctl**：运行时内核参数，写在 `/etc/sysctl.d/*.conf`，由 `systemd-sysctl` 在启动时加载；要立即重载整套配置可用 `sudo sysctl --system`，例如 `net.ipv4.ip_forward`、`vm.swappiness`。`sysctl -p` 默认读 `/etc/sysctl.conf`，不会自动遍历 `/etc/sysctl.d/`。
- **模块参数**：`/etc/modprobe.d/*.conf` 的 `options`，在模块加载时生效。

三者层级不同：启动参数最早、模块参数随加载、sysctl 在用户空间可改。把 `vm.swappiness` 写进内核命令行不会生效；把 `root=` 写进 sysctl 更不可能。

## 失败模式

- **把内核升级当成自动回退保障**：常规升级不保证保留旧内核镜像和可用菜单项；需要回退时，预先安装并验证独立内核及其 initramfs/引导项。
- **升级内核不重启就判断模块正常**：`uname -r` 仍是旧内核，新模块目录未被使用；要重启后再验证。
- **改 `HOOKS` 不重建 initramfs**：新 hook 没进镜像，启动时缺驱动或缺少解锁步骤。
- **黑名单写成文件名**：`blacklist iwlwifi.ko` 不会生效，应写模块名 `iwlwifi`。
- **`modprobe -r` 卸载正在使用的模块**：失败或导致设备消失；先看 `lsmod` 的引用计数。
- **DKMS 缺头文件**：内核升级后模块无法重建，无线/显卡失效；确认 `linux-headers` 与当前内核版本匹配。
- **把模块参数写进 sysctl**：层级错误，参数不生效；应在 `/etc/modprobe.d` 配 `options`。
- **initramfs 塞入过多模块**：启动变慢、体积变大，还可能掩盖 autodetect 的问题；只加必要项。
- **多内核只重建一个**：另一个内核的 initramfs 仍是旧配置；用 `-P` 或明确指定 preset。

## 验证与回滚

```bash
uname -r
ls /usr/lib/modules
lsinitcpio /boot/initramfs-linux.img | head -n 15
cat /proc/cmdline
sysctl vm.swappiness
dkms status
modinfo -p 模块名 | head
```

`lsinitcpio` 列出 initramfs 内容，确认新 hook/模块是否真的进去；`/proc/cmdline` 是本次启动的真实参数，不以配置文件为准；`dkms status` 显示每个内核版本的构建结果。回滚：只有预先保留且配置、验证过的备用内核/引导项才能直接从菜单选择；否则用 Live 环境修复。initramfs 改坏时可从 Live 环境挂载后恢复 `.bak` 或按原配置重建（**未实测**）；模块参数改错先注释掉对应行并重启。本章的 `mkinitcpio -P`、`modprobe` 写操作、DKMS 重建与重启均**未实测**；只读命令可安全复现。

## 取舍边界

- **树内模块 vs DKMS**：能用树内模块就不要引入 DKMS；DKMS 灵活但增加每次内核升级的失败面。
- **`autodetect` vs 固定 `MODULES`**：autodetect 按构建时硬件精简 initramfs，换硬件可能缺驱动；固定模块更稳但体积大。
- **主内核 vs LTS**：主线新特性多，LTS 更保守；关键机器可同时安装，引导菜单留退路。
- **独立 initramfs vs UKI**：独立文件便于替换与排查；UKI 集成度高，适合 Secure Boot 统一签名。
- **压缩算法 vs 启动速度**：更高压缩比省空间但解压更慢；嵌入式或小 ESP 才需要极致压缩。
- **`sysctl` 调优 vs 默认值**：默认值通常足够；没有测量与基线就不要批量改内核参数。

## 小结

- 内核由镜像、模块目录、initramfs 与启动参数组成，升级后要重启才真正切换。
- `lsmod`/`modinfo`/`modprobe` 管模块；`/etc/modprobe.d` 管黑名单与参数，`modules-load.d` 管启动加载。
- 树外模块优先用 DKMS，但必须装匹配的头文件并检查 `dkms status`。
- `mkinitcpio` 按 `HOOKS`、`MODULES`、`FILES` 生成 initramfs；改这些或改加密/文件系统后必须重建。
- 启动参数、模块参数、sysctl 分属三个层级，写错位置不会生效。
- 本章的重建、加载与重启未实测；`lsinitcpio`、`/proc/cmdline`、`dkms status` 是安全验证。

## 练习

1. 执行 `uname -r` 与 `ls /usr/lib/modules`，确认当前内核版本与模块目录一一对应（只读）。
2. 用 `modinfo ext4` 与 `modinfo -p 模块名` 查看一个模块的元数据与参数，记录哪些参数只读。
3. 读 `/etc/mkinitcpio.conf` 的 `HOOKS` 行，按执行顺序解释其中四个 hook 的作用。
4. 用 `lsinitcpio` 查看当前 initramfs，确认是否包含你关心的存储或加密模块（只读）。
5. 对比 `/proc/cmdline`、`/etc/sysctl.d/*.conf` 与 `/etc/modprobe.d/*.conf`，各举一个只能写在该层的参数。
6. 写出「内核升级后无线失效」的排查顺序：`uname -r` → 模块目录 → `dkms status` → `lsinitcpio` → 日志。

## 自检

- [ ] 能区分内核镜像、模块目录、initramfs 与启动参数
- [ ] 会用 `lsmod`/`modinfo`/`modprobe` 并知道 `-r` 的限制
- [ ] 能正确写黑名单与模块参数，知道 `blacklist` 不阻止显式加载
- [ ] 理解 DKMS 与头文件包的依赖关系
- [ ] 知道改哪些配置后必须 `mkinitcpio -P`
- [ ] 能区分启动参数、模块参数与 sysctl 的层级

## 参考

- [Kernel](https://wiki.archlinux.org/title/Kernel)
- [Kernel modules](https://wiki.archlinux.org/title/Kernel_module)
- [Mkinitcpio](https://wiki.archlinux.org/title/Mkinitcpio)
- [systemd-debug-generator(8)](https://man.archlinux.org/man/systemd-debug-generator.8.en)
- [Dynamic Kernel Module Support](https://wiki.archlinux.org/title/Dynamic_Kernel_Module_Support)
- 上一章：[第 59 章 UEFI 与固件](59-UEFI-与固件.md)
- 下一章：[第 61 章 Secure Boot、签名、shim 与 MOK](61-Secure-Boot-签名-shim-与-MOK.md)
