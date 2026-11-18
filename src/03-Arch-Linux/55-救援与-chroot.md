# 第 55 章 救援与 chroot

系统起不来时，最有效的工具不是重装，而是从外部环境挂载原系统、进入它的命名空间修复。chroot 让你在「目标系统的根」里运行 pacman、重建 initramfs、重装引导器，同时使用 Live 环境的内核与工具。它的前提是：分区还在、数据还在、你挂对了根。

> 本章目标：能在 Live 环境中识别并挂载普通分区、LUKS、LVM、RAID 与 btrfs 子卷；用 `arch-chroot` 进入目标系统并确认身份；完成 fstab、initramfs、引导器、包数据库与密码的常见修复；按正确顺序退出与卸载，避免数据未落盘。
> 对应 Wiki：[Install Arch Linux from existing Linux](https://wiki.archlinux.org/title/Install_Arch_Linux_from_existing_Linux)、[Chroot](https://wiki.archlinux.org/title/Chroot)、[GRUB#Repair](https://wiki.archlinux.org/title/GRUB#Repair)

> **命令来源（本章涉及的命令）**
> 
> | 命令 | 是什么简写 | 由什么命令/机制发展而来 | 参数/选项来源 | 如何记忆 |
> |------|------------|------------------------|---------------|----------|
> | `arch-chroot` | **arch** **chroot**（Arch 改根）| Arch Linux 专用，封装了挂载 API 文件系统与 chroot | 跟目标根目录，如 `arch-chroot /mnt` | arch-chroot = Arch 专用的 chroot，改根到目标系统 |
> | `chroot` | **ch**ange **root**（改根）| Unix 第 7 版（1979），改变根目录 | 直接跟目标根和要运行的命令 | chroot = change root，改“根”目录 |
> | `cryptsetup` | **crypto** **setup**（加密设置）| LUKS 磁盘加密管理工具 | `open` 解锁、`close` 关闭映射 | cryptsetup = crypto setup，设置“加密”设备 |
> | `vgchange` | **vg** **change**（卷组变更）| LVM 工具，激活/停用卷组 | `-ay` 激活所有、`-an` 停用所有 | vgchange = change volume group，改“卷组”状态 |
> | `mdadm` | **md** **adm**in（多磁盘管理）| Linux 软件 RAID 管理工具 | `--assemble --scan` 组装阵列 | mdadm = md admin，管理“多磁盘”阵列 |
> | `mkinitcpio` | **mk** **initramfs** **cpio**（制作 initramfs）| Arch 专用，生成 initramfs 镜像 | `-P` 为所有内核重建 | mkinitcpio = make initramfs cpio，“制作”initramfs |
> | `grub-install` | **grub** **install**（安装 GRUB）| GNU GRUB 引导器安装工具 | `--target` 目标平台、`--efi-directory` ESP 目录、`--bootloader-id` 标识符 | grub-install = 安装 GRUB 引导器 |
> | `bootctl` | **boot** **ctl**（引导控制）| systemd-boot 的控制工具 | `install` 安装引导器 | bootctl = boot control，控制引导 |
> | `efibootmgr` | **efi** **boot** **mgr**（EFI 引导管理）| UEFI 引导项管理工具 | `-v` 详细显示 | efibootmgr = EFI boot manager，管理 UEFI 引导项 |
> | `fuser` | **f**ile **user**（文件用户）| 显示占用文件的进程 | `-vm /mnt` 显示占用挂载点的进程 | fuser = file user，看“文件”被哪个用户/进程占用 |
> | `e2fsck` | **e2** **fsck**（ext2/3/4 检查）| ext 文件系统检查工具 | `-f` 强制检查、`-n` 只读模式 | e2fsck = ext2 fsck，检查 ext 文件系统 |
> | `xfs_repair` | **xfs** **repair**（XFS 修复）| XFS 文件系统修复工具 | `-n` 只读检查 | xfs_repair = xfs repair，修复 XFS 文件系统 |
> | `lsblk` | **ls bl**ock（块设备列表）| 见第 5 章，util-linux 包 | `-f` 显示文件系统类型 | 见第 5 章 |
> | `blkid` | **blk** **id**（块设备标识）| 见第 18 章，util-linux 包 | 直接跟设备名 | 见第 18 章 |
> | `findmnt` | **find mount**（查找挂载）| 见第 5 章，util-linux 包 | `-T` 目标路径、`-R` 递归显示 | 见第 5 章 |
> | `mkfs` | **mk** **fs**（make file system）| 见第 18 章，格式化文件系统 | 直接跟设备名 | 见第 18 章 |
> | `mount` | 英文 mount（挂载）| 见第 18 章，util-linux 包 | `--mkdir` 自动创建挂载点、`--bind` 绑定挂载 | 见第 18 章 |
> | `umount` | 英文 umount（卸载）| 见第 18 章，util-linux 包 | `-R` 递归卸载 | 见第 18 章 |
> | `passwd` | 英文 passwd（口令）| 见第 8 章，shadow 包 | 直接跟用户名，改目标系统密码 | 见第 8 章 |
> | `pacman` | **pack** **man**ager（包管理器）| 见第 41 章 | `-Q` 查询、`-Dk` 数据库校验 | 见第 41 章 |

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

挂完后分别运行 `findmnt /mnt` 与 `findmnt /mnt/boot` 复核：根与 ESP 是两个独立挂载点，且来源设备正确。若目标系统把 ESP 挂载到 `/efi` 等其他位置，应改为检查对应目标。挂错根却继续 chroot，后面的修复会写到错误的分区。

## 第三步：进入目标系统

```bash
sudo arch-chroot /mnt
```

`arch-chroot` 会挂载目标系统所需的临时 API 文件系统并切换根目录。若使用其他发行版的 Live 环境，优先使用该环境提供的同类工具；确实要手工 `chroot` 时，至少准备 `/proc`、`/sys`、`/dev`，并按需准备 `/run`：

```bash
sudo mount -t proc proc /mnt/proc
sudo mount -t sysfs sys /mnt/sys
sudo mount --rbind /dev /mnt/dev
sudo mount --rbind /run /mnt/run
sudo chroot /mnt /bin/bash
```

若要在 chroot 内写入 UEFI NVRAM，还须确认 Live 环境以 UEFI 启动且 `efivarfs` 已挂载；仅挂载 `/sys` 不会自动带入其下单独挂载的 `efivarfs`。手工挂载命令要按当前 Live 环境和实际挂载点核对。

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

**引导器**：先确认目标系统正在使用的引导器及 ESP 挂载点，再选择对应的一条修复路径；不要把下面两种引导器命令连续当作一套流程执行。示例均假设 UEFI 下 ESP 挂载在 `/boot`，其他布局要相应调整。

GRUB：
```bash
grub-install --target=x86_64-efi --efi-directory=/boot --bootloader-id=GRUB
grub-mkconfig -o /boot/grub/grub.cfg
```

systemd-boot：
```bash
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
sudo vgchange -an # 若 LVM 位于已解锁的 LUKS 容器内，先停用卷组
sudo cryptsetup close cryptroot # 再关闭承载该卷组的 LUKS 映射
```

`umount -R` 递归卸载，避免遗漏 bind mount；提示 `target is busy` 时用 `fuser -vm /mnt` 找到占用进程，先退出再卸载。上面的停用顺序适用于常见的「LUKS 映射上承载 LVM」布局；若层次相反，应按实际依赖关系先停用上层设备。数据未落盘就断电或直接重启，可能留下不一致的文件系统。只读检查要按文件系统选择工具，例如对未挂载的 ext2/3/4 使用 `e2fsck -fn`，对未挂载的 XFS 使用 `xfs_repair -n`；不要把通用 `fsck -n` 当成所有文件系统都具有相同语义的保证。

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
findmnt /mnt
findmnt /mnt/boot
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
- 退出顺序是 `exit` → `umount -R` → 按设备依赖关系停用 LVM/LUKS；常见 LUKS→LVM 布局先停用卷组再关闭映射。
- 只读文件系统检查使用对应工具和选项；ext 文件系统可用 `e2fsck -fn`，XFS 可用 `xfs_repair -n`，均应先卸载。
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
