# 第 44 章 pacstrap、chroot 与引导器

分区和挂载只是准备场地。真正把系统写进磁盘的是 `pacstrap`，随后 `arch-chroot` 让你以新系统 root 的身份完成配置，最后由引导器告诉固件该加载什么。本章每一步都可以在虚拟机中重来。

> 本章目标：能在 Live 环境确认 UEFI、网络与时间，完成 `pacstrap`、`genfstab`、`arch-chroot`，并分别为 GRUB 与 systemd-boot 安装引导。
> 对应 Wiki：[Installation guide](https://wiki.archlinux.org/title/Installation_guide)｜[Arch boot process](https://wiki.archlinux.org/title/Arch_boot_process)

> 本书假设你的 Arch 已经装好。本章保留完整流程作为**参考资料**：想重装、想在真机上安装，或想理解安装器到底做了什么时再读。

## Live 环境的三项检查

启动模式、网络、时间，任何一项错误都会在后续步骤中以难以理解的方式暴露。

```bash
cat /sys/firmware/efi/fw_platform_size   # 期望输出 64
ip link
ping -c 3 archlinux.org
timedatectl
```

UEFI 文件输出 `64` 或 `32` 才算 UEFI 启动；文件不存在说明当前是 BIOS/CSM 模式，此时 `efibootmgr` 会报 EFI 变量不可用，GRUB 的 EFI 目标也会失败。处理方式是关机，在虚拟机固件设置中改用 UEFI，重新进入 Live 环境。

有线网络通常自动配置；无线用 `iwctl device list`、`iwctl station wlan0 connect "SSID"` 连接。`ip link` 中除 `lo` 外应有 `UP` 状态接口，`ping` 能解析域名。没有网络时 `pacstrap` 直接失败。

时间偏差过大会导致 TLS 与包签名错误。必要时在 Live 环境同步时间并更新密钥环。这是 Wiki 记录的密钥环更新例外：只刷新数据库并更新 `archlinux-keyring`，目的是先取得新密钥；Live 环境是临时的，不需要随后完整升级。装好系统后请改用 `sudo pacman -Syu archlinux-keyring`，或按 [密钥环故障流程](39-常见故障处理.md) 处理：

```bash
sudo timedatectl set-ntp true
sudo pacman -Sy --needed archlinux-keyring
```

## pacstrap 安装基础系统

`pacstrap` 把包安装到指定挂载点，而不是当前 Live 系统：

## 选择镜像源（pacstrap 之前）

Live 环境先换到快镜像，否则 pacstrap 可能慢到超时：`reflector --country China --latest 20 --sort rate --save /etc/pacman.d/mirrorlist`（没有 reflector 就手编该文件），随后 `pacman -Sy` 验证索引能拉下来。装完系统再按第 28 章精调。

```bash
pacstrap -K /mnt base linux linux-firmware
```

`-K` 在目标系统初始化空密钥环，避免沿用 Live 环境状态；`/mnt` 必须已挂好根分区；`base` 是最小基础元包（metapackage，依赖一串基础包而非自己含文件），带入 pacman 与 systemd；`linux` 是默认内核；`linux-firmware` 提供常见硬件固件。需要网络与编辑器时可一次装完，减少重复进 chroot：

```bash
pacstrap -K /mnt base linux linux-firmware networkmanager sudo vim man-db
```

`pacstrap` 读取的是 Live 环境的 `/etc/pacman.d/mirrorlist`，下载慢时先用 `reflector` 换源。安装后检查：

```bash
ls /mnt /mnt/boot
```

`/mnt` 下应出现 `etc`、`usr`、`var`；`/mnt/boot` 应有 `vmlinuz-linux` 与 `initramfs-linux.img`。**判断 ESP 是否挂上不要看目录空不空**——未挂载时 `/mnt/boot` 只是根分区上的普通目录，pacstrap 照样把内核写进去，于是「看似正常、引导器却写不进 ESP」。正确判据：`findmnt /mnt/boot` 有独立挂载记录，且 `lsblk -f` 显示该分区 `FSTYPE=vfat`；不满足先回[上一章](43-安装准备与分区.md)修正。

## 生成 fstab 并进入 chroot

```bash
genfstab -U /mnt >> /mnt/etc/fstab
```

`-U` 用 UUID 标识文件系统。检查根 `/`（ext4/btrfs）与 `/boot`（vfat）两条都在，且 UUID 与 `blkid` 一致。`>>` 是追加写入，**这条命令只能执行一次**；重复执行会产生重复条目，启动时可能进入 emergency mode。

`arch-chroot` 不只是 `chroot`：它先把 `/dev`、`/proc`、`/sys`、`/run` 绑定挂载到目标系统，准备好 `/etc/resolv.conf`，再切换根目录。这样新系统里的 `pacman`、`mkinitcpio`、`grub-install` 才能访问设备和网络。

```bash
arch-chroot /mnt
```

进入后 `/` 就是新系统。`systemctl enable` 可以离线创建自启链接；`systemctl start` 不会启动新系统服务，因为 PID 1 仍是 Live 环境。退出与卸载：

```bash
exit
umount -R /mnt
```

`umount -R` 递归卸载；提示 target is busy 时先确认没有进程占用。

## 选择并安装引导器

| 维度         | GRUB                            | systemd-boot           |
| ------------ | ------------------------------- | ---------------------- |
| 配置复杂度   | 中等，自动生成菜单              | 低，手写 entry         |
| 菜单生成     | `grub-mkconfig`，可探测其他系统 | 不自动探测，需手动维护 |
| 文件系统支持 | 广，可读 ext4、btrfs、xfs       | 主要依赖 ESP 的 FAT32  |
| 加密根分区   | 支持 LUKS，LUKS2 默认参数受限   | 依赖 initramfs 解锁    |
| 适合         | 双系统、复杂分区、需要救援菜单  | 单系统、简洁 UEFI      |

第一次安装建议 GRUB，出错时还能进 GRUB 命令行救援。两种引导器都要求 ESP 可写；本书把 ESP 挂在 `/boot`，因此 GRUB 用 `--efi-directory=/boot`，systemd-boot 直接装到 `/boot`。若 ESP 挂 `/efi`、`/boot` 另分区，参数要随之改变，挂载点与参数不一致是引导失败的高频原因。

### GRUB

```bash
pacman -S grub efibootmgr
grub-install --target=x86_64-efi --efi-directory=/boot --bootloader-id=GRUB
grub-mkconfig -o /boot/grub/grub.cfg
```

`--target=x86_64-efi` 用于 64 位 UEFI，不能在 BIOS 模式下使用；`--efi-directory` 必须是 ESP 挂载点；`--bootloader-id` 是固件菜单显示名。`grub-mkconfig` 输出中出现 `Found linux image` 说明识别到了内核，随后用 `efibootmgr -v` 确认存在指向 `grubx64.efi` 的条目。

### systemd-boot

systemd-boot 由 systemd 提供，无需额外包。在 chroot 中安装：

```bash
bootctl install
```

写 `/boot/loader/loader.conf`：

```text
default arch.conf
timeout 3
```

取根分区 UUID，再写 `/boot/loader/entries/arch.conf`：

```bash
blkid -s UUID -o value /dev/vda2
```

```text
title   Arch Linux
linux   /vmlinuz-linux
initrd  /initramfs-linux.img
options root=UUID=<根分区UUID> rw
```

路径相对 ESP 根目录，`<根分区UUID>` 要替换成 `blkid` 输出的实际值。微码二选一：`HOOKS` 里有 `microcode`（默认）就不要再加微码 `initrd`；只有走独立 initrd 方案时才写两行、微码在前（第 41 章）。`root=` 写错会停在 `VFS: Unable to mount root fs`，可用 `bootctl status` 验证。

最后在 chroot 中执行 `mkinitcpio -P`，按 `/etc/mkinitcpio.d/` 的预设重建全部 initramfs。安装内核包时通常已自动生成，但修改 `HOOKS`/`MODULES`、添加微码或发现 `/boot` 缺少 initramfs 时必须重跑。

## 常见失败

| 现象                           | 原因                               | 处理                                         |
| ------------------------------ | ---------------------------------- | -------------------------------------------- |
| `grub-install` 找不到 EFI 目录 | ESP 未挂载或挂载点与参数不一致     | 回 Live 环境挂载，`findmnt /mnt/boot` 确认   |
| `efibootmgr` 报 EFI 变量不支持 | Live 以 BIOS/CSM 启动              | 改 UEFI 启动后重做引导安装                   |
| 启动进入 emergency mode        | fstab 重复或条目错误               | Live + chroot 修正 fstab                     |
| 固件菜单没有 Arch 条目         | 引导器未写入 ESP 或 NVRAM 条目缺失 | `efibootmgr -v`、`bootctl status` 检查后重装 |
| `Unable to mount root fs`      | `root=UUID` 错误或 initramfs 缺失  | 核对 `blkid`，重新生成 initramfs             |
| 启动停在 `file not found`      | 引导器找不到内核或 initramfs       | 检查 `/boot` 内容与 entry 路径               |

排障原则：先用 Live ISO 挂载根分区与 ESP，`arch-chroot` 进去修配置，不要急着重装。

## 小结

- `pacstrap -K` 把基础包写入 `/mnt`，并初始化目标系统密钥环。
- `genfstab -U` 只能执行一次，生成后必须人工检查。
- ESP 挂载点、`root=UUID`、initramfs 任一错误都会导致无法启动。

## 练习

1. 完整执行一次 `pacstrap`，记录安装包数量与磁盘占用（环境：Live ISO（VM）；预期：事务结束无 error）。
2. 分别用 GRUB 和 systemd-boot 安装，比较菜单与 entry 的差异（环境：VM；预期：两套菜单都能列出内核）。
3. 删 initramfs 恢复演练（环境：VM，**不可逆操作**）：前置三步——先给虚拟机做快照、`ls /boot` 确认还有 `initramfs-linux-fallback.img` 或可从 Live 重建、准备好 Live ISO；然后删除 `/boot/initramfs-linux.img` 重启，记录报错（预期：initramfs 缺失类报错、停在引导阶段）；用 Live ISO 挂载根并 `arch-chroot` 进去 `mkinitcpio -P` 修复后重启验证。

## 自检

- [ ] 能解释 UEFI 与 BIOS 模式对引导安装的影响
- [ ] 能说清 `pacstrap -K` 中 `-K` 的作用
- [ ] 能解释 `genfstab` 为什么只能用一次
- [ ] 能说明 `arch-chroot` 与普通 `chroot` 的区别
- [ ] 能写出 GRUB 与 systemd-boot 的完整安装命令
- [ ] 能根据启动报错定位 fstab、initramfs 或引导项问题

## 参考

- [Installation guide](https://wiki.archlinux.org/title/Installation_guide)
- [Arch boot process](https://wiki.archlinux.org/title/Arch_boot_process)
- [GRUB](https://wiki.archlinux.org/title/GRUB)
- [systemd-boot](https://wiki.archlinux.org/title/Systemd-boot)
- 上一章：[第 43 章 安装准备与分区](43-安装准备与分区.md)
- 下一章：[第 45 章 安装后配置与进阶](45-安装后配置与进阶.md)
