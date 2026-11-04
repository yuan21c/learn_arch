# 第 36 章 pacstrap、chroot 与引导器

分区和挂载只是准备场地。真正把系统写进磁盘的是 `pacstrap`，随后 `arch-chroot` 让你以新系统 root 的身份完成配置，最后由引导器告诉固件该加载什么。本章每一步都可以在虚拟机中重来。

> 本章目标：能在 Live 环境确认 UEFI、网络与时间，完成 `pacstrap`、`genfstab`、`arch-chroot`，并分别为 GRUB 与 systemd-boot 安装引导。
> 对应 Wiki：[Installation guide](https://wiki.archlinux.org/title/Installation_guide)｜[Arch boot process](https://wiki.archlinux.org/title/Arch_boot_process)

> 本书假设你的 Arch 已经装好。本章保留完整流程作为**参考资料**：想重装、想在真机上安装，或想理解安装器到底做了什么时再读。`pacstrap`、`grub-install`、`bootctl install` 会写磁盘与 NVRAM，本章**未实测**；练习只在一次性虚拟机或 loop 镜像中做。

## Live 环境的三项检查

启动模式、键盘、网络、时间，任何一项错误都会在后续步骤中以难以理解的方式暴露。

```bash
cat /sys/firmware/efi/fw_platform_size # 期望输出 64
localectl list-keymaps | grep -i us # 非美式键盘先挑布局
loadkeys us # 按实际键盘替换，后续输入才不走样
ip link
ping -c 3 archlinux.org
timedatectl
```

UEFI 文件输出 `64` 或 `32` 才算 UEFI 启动；输出 `32` 表示 32 位 UEFI（IA32），本书不覆盖该场景（需 32 位引导器或混合模式），后续步骤以 64 位 UEFI 为准；文件不存在说明当前是 BIOS/CSM 模式，此时 `efibootmgr` 会报 EFI 变量不可用，GRUB 的 EFI 目标也会失败。处理方式是关机，在虚拟机固件设置中改用 UEFI，重新进入 Live 环境。

有线网络通常自动配置；无线用 `iwctl device list`、`iwctl station wlan0 connect "SSID"` 连接。`ip link` 中除 `lo` 外应有 `UP` 状态接口，`ping` 能解析域名。没有网络时 `pacstrap` 直接失败。

时间偏差过大会导致 TLS 与包签名错误。必要时在 Live 环境同步时间并更新密钥环。这是 Wiki 记录的密钥环更新例外：只刷新数据库并更新 `archlinux-keyring`，目的是先取得新密钥；Live 环境是临时的，不需要随后完整升级。装好系统后按 [第 43 章](43-缓存降级与密钥环.md) 的流程处理，或参考 [密钥环故障流程](53-常见故障处理.md)：

```bash
sudo timedatectl set-ntp true
sudo pacman -Sy --needed archlinux-keyring
```

## 选择镜像源（pacstrap 之前）

Live 环境先换到快镜像，否则 pacstrap 可能慢到超时：`reflector --country China --latest 20 --sort rate --save /etc/pacman.d/mirrorlist`（没有 reflector 就手编该文件），随后 `pacman -Sy` 验证索引能拉下来。装完系统再按第 39 章精调。

## pacstrap 安装基础系统

`pacstrap` 把包安装到指定挂载点，而不是当前 Live 系统：

```bash
pacstrap -K /mnt base linux linux-firmware
```

`-K` 在目标系统初始化空密钥环，避免沿用 Live 环境状态；`/mnt` 必须已挂好根分区；`base` 是最小基础元包（metapackage，依赖一串基础包而非自己含文件），带入 pacman 与 systemd；`linux` 是默认内核；`linux-firmware` 提供常见硬件固件。需要网络与编辑器时可一次装完，减少重复进 chroot：

```bash
pacstrap -K /mnt base linux linux-firmware networkmanager sudo vim man-db
```

`pacstrap` 读取的是 Live 环境的 `/etc/pacman.d/mirrorlist`；若前面已按上一节换源，这里不需要再改。安装后检查：

```bash
ls /mnt /mnt/boot
```

`/mnt` 下应出现 `etc`、`usr`、`var`；`/mnt/boot` 应有 `vmlinuz-linux` 与 `initramfs-linux.img`。**判断 ESP 是否挂上不要看目录空不空**——未挂载时 `/mnt/boot` 只是根分区上的普通目录，pacstrap 照样把内核写进去，于是「看似正常、引导器却写不进 ESP」。正确判据：`findmnt /mnt/boot` 有独立挂载记录，且 `lsblk -f` 显示该分区 `FSTYPE=vfat`；不满足先回[上一章](35-安装准备与分区.md)修正。

## 生成 fstab 并进入 chroot

```bash
genfstab -U /mnt >> /mnt/etc/fstab
```

`-U` 用 UUID 标识文件系统。检查根 `/`（ext4/btrfs）与 `/boot`（vfat）两条都在，且 UUID 与 `blkid` 一致。`>>` 是追加写入，**这条命令只能执行一次**；重复执行会产生重复条目，启动时可能进入 emergency mode。

`arch-chroot` 不只是 `chroot`：它先把 `/dev`、`/proc`、`/sys`、`/run` 绑定挂载到目标系统，准备好 `/etc/resolv.conf`，再切换根目录。这样新系统里的 `pacman`、`mkinitcpio`、`grub-install` 才能访问设备和网络。

```bash
arch-chroot -S /mnt
```

`arch-chroot -S` 以 systemd 模式运行：它通过 `systemd-run` 生成临时服务，把 namespace/chroot 管理交给 service manager，适合需要 systemd 工具在受管环境中工作的场景。它本身不保证固件变量可写：`bootctl install` 要写 NVRAM，前提是 chroot 内能看到 efivarfs——进入后先执行 `ls /sys/firmware/efi/efivars`，有输出才说明固件变量可访问；看不到时先回 Live 环境确认 efivarfs 已挂载。只想改配置、不装引导器时，`arch-chroot /mnt` 即可。

进入后 `/` 就是新系统。`systemctl enable` 可以离线创建自启链接；`systemctl start` 不会启动新系统服务，因为 PID 1 仍是 Live 环境。若 pacstrap 时按建议装了 `networkmanager`，现在设为开机自启：

```bash
systemctl enable NetworkManager
```

退出与卸载：

```bash
exit
umount -R /mnt
```

`umount -R` 递归卸载；提示 target is busy 时先确认没有进程占用。

## 选择并安装引导器

| 维度 | GRUB | systemd-boot |
| ------------ | ------------------------------- | ---------------------- |
| 配置复杂度 | 中等，自动生成菜单 | 低，手写 entry |
| 菜单生成 | `grub-mkconfig`，可探测其他系统 | 不自动探测，需手动维护 |
| 文件系统支持 | 广，可读 ext4、btrfs、xfs | 主要依赖 ESP 的 FAT32 |
| 加密根分区 | 可加密 `/boot`（由 GRUB 解密），根分区仍由 initramfs 解锁；LUKS2 需用 PBKDF2（GRUB 默认不支持 Argon2id） | 依赖 initramfs 解锁 |
| 适合 | 复杂分区、多引导项、需要救援菜单 | 单系统、简洁 UEFI |

第一次安装建议 GRUB，出错时还能进 GRUB 命令行救援。两种引导器都要求 ESP 可写；本书把 ESP 挂在 `/boot`，因此 GRUB 用 `--efi-directory=/boot`，systemd-boot 直接装到 `/boot`。若 ESP 挂 `/efi`、`/boot` 另分区，参数要随之改变，挂载点与参数不一致是引导失败的高频原因。

### GRUB

```bash
pacman -S grub efibootmgr
grub-install --target=x86_64-efi --efi-directory=/boot --bootloader-id=GRUB
grub-mkconfig -o /boot/grub/grub.cfg
```

`--target=x86_64-efi` 用于 64 位 UEFI，不能在 BIOS 模式下使用；`--efi-directory` 必须是 ESP 挂载点；`--bootloader-id` 是固件菜单显示名。`grub-mkconfig` 输出中出现 `Found linux image` 说明识别到了内核，随后用 `efibootmgr -v` 确认存在指向 `grubx64.efi` 的条目。注意 `grub-install` 与 `bootctl install` 一样会写 NVRAM 并调整启动顺序；已有其他引导项时，执行前同样先记录 `efibootmgr -v`。

### systemd-boot

systemd-boot 由 systemd 提供，无需额外包。`bootctl install` 会把 systemd-boot 与 fallback loader 写入 ESP 的 `EFI/systemd/`、`EFI/BOOT/`（覆盖 `EFI/BOOT/` 中已有的同名 fallback），并写入或调整固件 NVRAM 启动项、把 `Linux Boot Manager` 置为优先；已有其他引导项时，这会改变原有启动顺序。

进 chroot 后先检查、备份，再安装并验证（chroot 内是 root，无需 `sudo`）：

```bash
ls /boot/EFI/BOOT # 看已有 fallback 文件
cp -a /boot/EFI/BOOT /root/EFI-BOOT.bak
efibootmgr -v # 记录当前启动项与顺序
bootctl install
bootctl status # 确认 Boot Loader、ESP 与固件条目
efibootmgr -v # 确认指向 systemd-bootx64.efi 的条目与顺序
```

> **注意**：若 `EFI/BOOT` 里已有其他引导器的 fallback，`bootctl install` 会覆盖同名文件；需要保留就先备份、装完后恢复。不要为清理条目而清空整个启动顺序。

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
title Arch Linux
linux /vmlinuz-linux
initrd /initramfs-linux.img
options root=UUID=<根分区UUID> rw
```

路径相对 ESP 根目录，`<根分区UUID>` 要替换成 `blkid` 输出的实际值。微码二选一：`HOOKS` 里有 `microcode`（默认）就不要再加微码 `initrd`；只有走独立 initrd 方案时才写两行、微码在前（第 58 章）。`root=` 写错会停在 `VFS: Unable to mount root fs`。`bootctl status` 只能确认 entry 被发现，不能证明根分区可挂载；用 `blkid -s UUID -o value <根分区>` 与 entry 里的 UUID 逐字对照，再 `findmnt` 或临时挂载该分区验证。

最后在 chroot 中执行 `mkinitcpio -P`，按 `/etc/mkinitcpio.d/` 的预设重建全部 initramfs。安装内核包时通常已自动生成，但修改 `HOOKS`/`MODULES`、添加微码或发现 `/boot` 缺少 initramfs 时必须重跑。

## 常见失败

| 现象 | 原因 | 处理 |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `grub-install` 找不到 EFI 目录 | ESP 未挂载或挂载点与参数不一致 | 回 Live 环境挂载，`findmnt /mnt/boot` 确认 |
| `efibootmgr` 报 EFI 变量不支持 | Live 以 BIOS/CSM 启动 | 改 UEFI 启动后重做引导安装 |
| 启动进入 emergency mode | fstab 重复或条目错误 | Live + chroot 修正 fstab |
| 固件菜单没有 Arch 条目 | 引导器未写入 ESP 或 NVRAM 条目缺失 | 用 `arch-chroot -S /mnt` 重跑 `bootctl install`；再 `efibootmgr -v`、`bootctl status` 检查 |
| `Unable to mount root fs` | `root=UUID` 错误或 initramfs 缺失 | 核对 `blkid`，重新生成 initramfs |
| 启动停在 `file not found` | 引导器找不到内核或 initramfs | 检查 `/boot` 内容与 entry 路径 |

排障原则：先用 Live ISO 挂载根分区与 ESP，`arch-chroot` 进去修配置，不要急着重装。

## 失败模式

- **ESP 未挂载或挂载点与参数不一致**：`--efi-directory=/boot` 必须指向真正挂载的 ESP；否则 `grub-install` 报找不到 EFI 目录，或把文件写进根分区。
- **`genfstab` 执行两次**：`>>` 会追加重复条目，启动时进入 emergency mode；这条命令只能执行一次。
- **`root=UUID` 抄错或与 entry 不一致**：启动停在 `VFS: Unable to mount root fs`；UUID 必须用 `blkid` 的输出逐字对照。
- **用 BIOS/CSM 模式启动 Live**：`efibootmgr` 报 EFI 变量不可用，EFI 引导器写不进去；先改固件为 UEFI 再重做。
- **`bootctl install` 覆盖 `EFI/BOOT` 并改动 NVRAM 顺序**：已有其他引导器时，同名 fallback 被覆盖、启动顺序被调整；先备份 `EFI/BOOT`、记录 `efibootmgr -v`。
- **在 chroot 里 `systemctl start` 新系统服务**：PID 1 仍是 Live 环境，start 不会启动目标系统的服务；chroot 中只做 `enable`。

## 验证与回滚

> 本章的核心动作都会写目标磁盘或固件变量，**未实测**。安全等价路径是只读核对，或在 loop 镜像里完整演练：

```bash
findmnt /mnt /mnt/boot # 两个独立挂载点，缺一不可
ls /mnt/boot # 应见 vmlinuz-linux 与 initramfs-linux.img
cat /mnt/etc/fstab # 根与 /boot 各一条，UUID 与 blkid 一致
ls /sys/firmware/efi/efivars | head # 有输出才说明 NVRAM 可访问
efibootmgr -v # 安装前后各存一份，便于恢复启动顺序
bootctl status # 读取状态，部分文件需要 root 权限，不修改
```

镜像演练：把 `/tmp` 的 loop 镜像分区、格式化、挂载到 `/mnt`，在其中 `pacstrap`；全程不碰真实盘，结束后 `umount -R /mnt`、`losetup -d`、删除镜像。真实安装的回滚只有两条：虚拟机快照回滚，或从 Live 环境挂载后修正 fstab、重跑引导器。NVRAM 顺序改动前必须留档，必要时用 `efibootmgr -o` 恢复原顺序。

## 取舍边界

- **GRUB vs systemd-boot**：GRUB 能探测多系统、带救援命令行，适合复杂分区；systemd-boot 配置少、依赖 ESP，适合单系统简洁 UEFI。
- **`pacstrap -K` vs 沿用 Live 密钥环**：`-K` 初始化空密钥环，避免把 Live 的临时信任状态带进新系统；代价是首次更新要重新 populate。
- **`arch-chroot` vs `arch-chroot -S`**：只改配置用普通模式；需要 systemd 工具在受管环境里工作才用 `-S`，但它不保证固件变量可写。
- **手写 entry vs `grub-mkconfig`**：手写 entry 可控但需自己维护 UUID 与 initramfs 路径；`grub-mkconfig` 自动探测，但多系统时可能插入意外条目。
- **ESP 直接挂 `/boot` vs 独立 `/boot`**：前者简单，后者便于加密或快照；拆开后所有引导器参数与 entry 路径都要同步修改。

## 小结

- `pacstrap -K` 把基础包写入 `/mnt`，并初始化目标系统密钥环。
- `genfstab -U` 只能执行一次，生成后必须人工检查。
- ESP 挂载点、`root=UUID`、initramfs 任一错误都会导致无法启动。

## 练习

1. 完整执行一次 `pacstrap`，记录安装包数量与磁盘占用（需要 Live ISO 环境；预期：事务结束无 error）。
2. 分别用 GRUB 和 systemd-boot 安装，比较菜单与 entry 的差异（需要 Live ISO 环境；预期：两套菜单都能列出内核）。
3. 删 initramfs 恢复演练（需要 Live ISO 环境，**不可逆操作**）：前置三步——先给虚拟机做快照、`ls /boot` 确认还有 `initramfs-linux-fallback.img` 或可从 Live 重建、准备好 Live ISO；然后删除 `/boot/initramfs-linux.img` 重启，记录报错（预期：initramfs 缺失类报错、停在引导阶段）；用 Live ISO 挂载根并 `arch-chroot` 进去 `mkinitcpio -P` 修复后重启验证。

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
- 上一章：[第 35 章 安装准备与分区](35-安装准备与分区.md)
- 下一章：[第 37 章 首次启动与基础验收](37-首次启动与基础验收.md)
