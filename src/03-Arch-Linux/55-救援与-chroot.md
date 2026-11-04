# 第 55 章 救援与 chroot

系统起不来时，最有效的工具不是重装，而是从外部环境挂载原系统、进入它的命名空间修复。chroot 让你在「目标系统的根」里运行 pacman、重建 initramfs、重装引导器，同时使用 Live 环境的内核与工具。它的前提是：分区还在、数据还在、你挂对了根。

> 本章目标：能在 Live 环境中识别并挂载普通分区、LUKS、LVM、RAID 与 btrfs 子卷；用 `arch-chroot` 进入目标系统并确认身份；完成 fstab、initramfs、引导器、包数据库与密码的常见修复；按正确顺序退出与卸载，避免数据未落盘。
> 对应 Wiki：[Install Arch Linux from existing Linux](https://wiki.archlinux.org/title/Install_Arch_Linux_from_existing_Linux)、[Chroot](https://wiki.archlinux.org/title/Chroot)、[GRUB#Repair](https://wiki.archlinux.org/title/GRUB#Repair)

## 什么时候需要救援

以下症状通常值得进 Live 环境，而不是在故障系统里反复尝试：

- 固件能找到启动项，但引导器报错或直接回到固件界面。
- 内核启动后停在 `VFS: Unable to mount root fs`、`Waiting for root device`、LUKS 解锁失败。
- 进入 emergency mode，root 只读，pacman 无法运行。
- 本地包数据库损坏、密钥环不可用，系统内已没有可用的包管理。
- `/etc/fstab` 改错导致根分区无法挂载。

如果系统还能启动到多用户、能联网、能进 shell，优先在系统内做只读诊断；chroot 是「系统内工具已不可用」时的手段。

## 第一步：认清磁盘与分层

Live 环境里第一件事是认盘，不是挂载：

```bash
lsblk -f # 分区、文件系统、UUID、挂载点
blkid # UUID 与分区类型
findmnt # 当前已挂载的内容
cat /proc/mdstat # 软件 RAID 状态
```

`lsblk -f` 同时给出 `FSTYPE` 与 `UUID`，是后面写 fstab 与 `root=` 的依据。看到 `crypto_LUKS` 说明还要解锁；看到 `LVM2_member` 说明卷组还没激活；看到 `linux_raid_member` 说明要先组装阵列。

## 第二步：按层挂载

**普通分区**：先挂根，再挂 ESP 与其他独立分区。

```bash
sudo mount /dev/vda2 /mnt
sudo mount --mkdir /dev/vda1 /mnt/boot
```

**LUKS**：先解锁，得到映射设备后再挂载。

```bash
sudo cryptsetup open /dev/vda2 cryptroot
sudo mount /dev/mapper/cryptroot /mnt
```

**LVM**：激活卷组后使用逻辑卷路径。

```bash
sudo vgchange -ay
sudo mount /dev/vg0/root /mnt
```

**RAID**：先组装，再按普通分区处理。

```bash
sudo mdadm --assemble --scan
sudo mount /dev/md0 /mnt
```

**btrfs 子卷**：挂载时要指定子卷；只挂顶层会看到快照目录而不是真正的根。

```bash
sudo mount -o subvol=@ /dev/vda2 /mnt
sudo mount --mkdir /dev/vda1 /mnt/boot
```

挂完后必须用 `findmnt /mnt`、`findmnt /mnt/boot` 复核：根与 ESP 是两个独立挂载点，且来源设备正确。挂错根却继续 chroot，后面的修复会写到错误的分区。

## 第三步：进入目标系统

```bash
sudo arch-chroot /mnt
```

`arch-chroot` 会挂载 `/proc`、`/sys`、`/dev` 等必要文件系统，并切换根目录。若使用其他发行版的 Live 环境，需要手工 bind mount：

```bash
sudo mount --bind /dev /mnt/dev
sudo mount --bind /proc /mnt/proc
sudo mount --bind /sys /mnt/sys
sudo chroot /mnt
```

进入后先确认身份，不要急着改文件：

```bash
cat /etc/os-release
pacman -Q 内核包名
mount | head
```

`/etc/os-release` 与包数据库能读到，说明挂的是目标系统；`pacman -Q` 能运行，说明包管理可用。若提示「数据库被锁」，先看是否有残留 pacman 进程，而不是直接删锁。

## 常见修复

**fstab**：用 `blkid` 的新 UUID 对照 `/etc/fstab`，改错时先备份。

```bash
cp /etc/fstab /etc/fstab.bak
blkid
findmnt -R /mnt
```

**initramfs**：改了 `HOOKS`、加密、文件系统或微码后重建。

```bash
mkinitcpio -P
```

**引导器**：GRUB 重装到 ESP，systemd-boot 重装并核对 entry。

```bash
grub-install --target=x86_64-efi --efi-directory=/boot --bootloader-id=GRUB
grub-mkconfig -o /boot/grub/grub.cfg
bootctl install
```

**包数据库**：先只读诊断，再重装单个包；整库损坏从备份恢复（第 40、51 章）。

```bash
pacman -Dk
pacman -Qkk bash
```

**密码与用户**：`passwd 用户名` 在 chroot 内直接改目标系统的密码；不要用 Live 环境的 `passwd` 改错对象。

> 本章的挂载、chroot、`mkinitcpio -P`、`grub-install`、`bootctl install` 与密码修改均**未实测**；只读的 `lsblk`、`blkid`、`findmnt`、`pacman -Dk` 可安全复现。

## 退出与卸载

顺序与挂载相反，且要先确保没有进程占用：

```bash
exit
sudo umount -R /mnt
sudo cryptsetup close cryptroot # 若用过 LUKS
sudo vgchange -an # 若用过 LVM
```

`umount -R` 递归卸载，避免遗漏 bind mount；提示 `target is busy` 时用 `fuser -vm /mnt` 找到占用进程，先退出再卸载。数据未落盘就断电或直接重启，可能留下不一致的文件系统；必要时在 Live 环境对根分区做只读 `fsck`。

## 失败模式

- **挂错根分区**：把数据盘或另一个系统当目标，修复写到错误位置；挂载后用 `findmnt` 与 `/etc/os-release` 双重确认。
- **忘记挂 ESP**：`/mnt/boot` 只是根分区上的空目录，引导器文件写进去后固件找不到。
- **LUKS 没解锁就挂载**：`mount` 报未知文件系统；先 `cryptsetup open`。
- **LVM 未激活**：`/dev/vg0/root` 不存在；先 `vgchange -ay`。
- **btrfs 没指定子卷**：挂到顶层子卷，看到的是快照目录，`/etc` 不在预期位置。
- **RAID 未组装**：单个成员盘看起来像普通分区，挂载后数据不完整；先 `mdadm --assemble --scan`。
- **chroot 内没有网络却要装包**：Live 环境的 DNS 配置没带进去；复制 `/etc/resolv.conf` 或手工配置。
- **修完直接重启不卸载**：缓存未落盘、挂载残留；先 `exit`，再 `umount -R`。

## 验证与回滚

救援过程本身要留下证据与退路：

```bash
lsblk -f
findmnt /mnt /mnt/boot
blkid
sudo arch-chroot /mnt pacman -Q 内核包名 # 非交互确认目标系统
sudo arch-chroot /mnt cat /etc/fstab
```

`arch-chroot /mnt 命令` 可以在不进入交互 shell 的情况下确认目标系统身份；`findmnt` 确认挂载层级；`blkid` 为 fstab 与 `root=` 提供准确 UUID。回滚：改任何文件前 `cp` 备份；引导器改动前记录 `efibootmgr -v` 与 `/boot` 文件清单；整机无法修复时回到快照或重装（**未实测**）。演练可在一次性虚拟机中故意改错 fstab，再按本章流程修复，全程有快照兜底。

## 取舍边界

- **chroot 修复 vs 重装**：分区与数据完好、问题在配置或包层，优先 chroot；分区损坏或大面积数据丢失才重装。
- **Live ISO vs 已装双系统**：Live ISO 干净、工具齐全；已有第二个 Linux 可省下载，但工具版本可能不匹配。
- **修 GRUB vs 换 systemd-boot**：原引导器只是配置错，修它最快；反复出问题且系统简单，可趁机换更少配置的引导器。
- **只读 fsck vs 自动修复**：先只读检查，确认错误类型再决定是否写入修复；自动修复可能扩大损坏。
- **保留现场 vs 快速恢复**：生产环境先恢复，但把故障盘镜像或日志留存，否则无法分析根因。

## 小结

- 救援的前提是挂对根：`lsblk -f` 认盘，按 LUKS/LVM/RAID/btrfs 层逐级挂载，`findmnt` 复核。
- ESP 必须单独挂到 `/boot`，否则引导器写入位置错误。
- `arch-chroot` 进入目标系统后，先确认 `/etc/os-release` 与包数据库，再动手修。
- 常见修复是 fstab、initramfs、引导器、包数据库与密码；每步都要先备份。
- 退出顺序是 `exit` → `umount -R` → 关闭 LUKS/LVM；`target is busy` 先找占用进程。
- 本章破坏性步骤未实测；只读检查与一次性虚拟机演练是安全等价路径。

## 练习

1. 在 Live 环境执行 `lsblk -f`、`blkid`、`findmnt`，画出你机器的「磁盘 → 分区 → 文件系统 → 挂载点」四层关系（只读）。
2. 说明 LUKS、LVM、RAID、btrfs 子卷各自需要在 `mount` 之前多做哪一步，并写出对应命令。
3. 在一次性虚拟机中改错 `/etc/fstab` 的 UUID，重启进入 emergency，按本章流程用 Live 环境修复（需快照）。
4. 写出「挂载 → chroot → 修复 initramfs → 退出 → 卸载」的完整命令序列，标出每步的验证命令。
5. 解释 `umount -R` 与普通 `umount` 的差别，以及 `target is busy` 时的排查顺序。
6. 列出三种「应该重装而不是 chroot」的情形，并说明判据。

## 自检

- [ ] 能用 `lsblk -f`/`blkid` 识别根、ESP 与加密/卷组/阵列层
- [ ] 能按正确顺序挂载普通、LUKS、LVM、RAID、btrfs 根
- [ ] 知道 chroot 前必须复核 `/mnt` 与 `/mnt/boot`
- [ ] 能在 chroot 内完成 fstab、initramfs、引导器、包数据库的基本修复
- [ ] 能按 `exit` → `umount -R` → 关闭映射的顺序安全退出
- [ ] 明确本章哪些步骤未实测，并知道对应的安全演练方式

## 参考

- [Chroot](https://wiki.archlinux.org/title/Chroot)
- [Install Arch Linux from existing Linux](https://wiki.archlinux.org/title/Install_Arch_Linux_from_existing_Linux)
- [GRUB#Repair](https://wiki.archlinux.org/title/GRUB#Repair)
- [dm-crypt/System configuration](https://wiki.archlinux.org/title/Dm-crypt/System_configuration)
- 上一章：[第 54 章 维护与排障总则](54-维护与排障总则.md)
- 下一章：[第 56 章 文件恢复与恢复后处理](56-文件恢复与恢复后处理.md)
