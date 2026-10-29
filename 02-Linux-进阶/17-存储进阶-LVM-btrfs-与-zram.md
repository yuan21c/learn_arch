# 第 17 章 存储进阶：LVM、btrfs 与 zram

第 16 章走完了「分区 → 格式化 → 挂载 → fstab」的主线，本章补三块进阶：LVM 空间不够时怎么扩、旧签名与 fstab 写错怎么收拾、btrfs 与 zram 这两个第 43 章会用到的现代部件。全部属于动手会丢数据的领域，每一节都带恢复路径。

> 本章目标：会用 `vgextend`/`lvextend` 完成 LVM 扩容全链；能用 `wipefs`/`partprobe` 清理旧签名并用 `findmnt --verify` 校验 fstab；理解 btrfs 子卷/NoCOW 与 swapfile 的特殊要求；能配置 zram 作为压缩内存交换。
> 对应 Wiki：[LVM](https://wiki.archlinux.org/title/LVM)、[Btrfs](https://wiki.archlinux.org/title/Btrfs)、[Zram](https://wiki.archlinux.org/title/Zram)

## LVM 扩容：从物理卷到文件系统

第 16 章的三层（PV/VG/LV）在扩容时的顺序是**自下而上补空间、自上而下扩容量**：VG 满了先给它加 PV，再扩 LV，最后扩文件系统。

```bash
# 环境：VM，新磁盘 /dev/vdb
sudo pvcreate /dev/vdb                    # 建物理卷
sudo vgextend vg0 /dev/vdb                # 最常用：加一块新 PV；也可 pvresize、换更大 PV 或回收空间
sudo lvextend -L +10G /dev/vg0/data       # 逻辑卷加 10G
sudo resize2fs /dev/vg0/data              # ext4 随之扩大
# XFS 用：sudo xfs_growfs /dev/vg0/data
```

只扩 LV 不扩文件系统，`df -h` 看到的容量不会变——`resize2fs`/`xfs_growfs` 这步不能省。缩容方向相反且风险高（xfs 不支持缩），本书不鼓励；要做先备份。

> **危险**：`pvcreate`/`vgreduce`/`lvremove` 直接改 LVM 元数据，指错设备就是数据消失。执行前 `pvs`/`vgs`/`lvs` 逐一确认设备名，任何 `remove` 操作先做快照或备份。

## 旧签名与分区表：wipefs、partprobe

同一块盘装过别的系统时，旧文件系统签名会留在分区头，`mkfs` 可能认错类型或报警。清理工具链：

```bash
# 环境：VM
sudo wipefs /dev/vdb           # 先看有什么签名（只读）
sudo wipefs -a /dev/vdb        # 再清掉全部签名
sudo partprobe /dev/vdb        # 让内核重读分区表
sudo udevadm settle            # 等设备节点稳定
lsblk -f /dev/vdb              # 预期 FSTYPE 列为空
```

`wipefs -a` 只清签名不擦数据区（数据仍可被工具找回，但系统不再识别）；分区表改动后必须 `partprobe` + `udevadm settle`，否则 `mkfs` 可能写到旧的设备映射上。

> **危险**：`wipefs -a` 与 `mkfs` 同级危险，永远先跑不带 `-a` 的 `wipefs` 看清楚签名列表，确认设备无误再动手。

## fstab 的校验与恢复闭环

第 16 章的「先备份」只是第一步，闭环是：**校验 → 重挂验证 → 出错可回退**。

```bash
# 环境：VM
sudo findmnt --verify            # 校验 /etc/fstab 全部条目（语法/设备/选项）
sudo cp /etc/fstab /etc/fstab.bak
# 改 fstab 后：先卸载再让 mount -a 全新挂一遍，才是真实验证
sudo umount /mnt/lab13
sudo mount -a
findmnt /mnt/lab13               # 预期：挂载点出现在输出中
```

`mount -a` 只处理**尚未挂载**的条目——已手工挂上的条目根本不会被读取，「手挂能通、开机挂不上」的经典事故就是这么漏掉的。进不去系统时在 emergency 模式下 `mount -o remount,rw /` 后从 `.bak` 恢复（第 20 章）。

## btrfs：子卷、NoCOW 与压缩

btrfs 把「子卷」当作可独立挂载/快照的管理单元，第 43 章的安装可选它做根文件系统：

```bash
# 环境：VM
sudo mkfs.btrfs /dev/vdb1
sudo mount /dev/vdb1 /mnt
sudo btrfs subvolume create /mnt/@          # 根子卷
sudo btrfs subvolume create /mnt/@home      # 家目录子卷
sudo umount /mnt
sudo mount -o subvol=@,compress=zstd /dev/vdb1 /mnt   # 挂指定子卷
```

三个关键概念：`subvol=` 挂载选项决定用哪个子卷；`compress=zstd` 透明压缩（CPU 换空间）；**NoCOW**（`chattr +C`）关掉写时复制——数据库、虚拟机镜像、swapfile 这类自己管理并发写的文件必须关，否则随机小写会放大成碎片。`chattr +C` 只能对空文件/空目录生效；NoCOW 同时关闭数据校验和与压缩，是安全换性能的取舍。

## btrfs 上的 swapfile

ext4 上 `fallocate` 一把梭的 swapfile 不能原样搬到 btrfs：`swapon` 的拒绝条件是**无洞（完全预分配）+ NODATACOW + 单一 data profile**，不是 fallocate 本身不可用。btrfs-progs ≥ 6.1 推荐直接用 `sudo btrfs filesystem mkswapfile --size 2G /swapfile`（再 `sudo swapon /swapfile`）；手工路线则是先关 COW、用非 COW 方式占空间：

```bash
# 环境：VM，btrfs 文件系统上
sudo btrfs filesystem mkswapfile --size 2G /swapfile   # 首选：一步创建无洞、NODATACOW 的 swapfile
sudo swapon /swapfile
# 手工路线（旧版 btrfs-progs）：
sudo truncate -s 0 /swapfile
sudo chattr +C /swapfile
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048   # 预分配物理空间
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

含活跃 swapfile 的子卷不可快照；`balance`/`scrub` 会跳过相关 block group。文件还不能被压缩（`compress` 会破坏 swap 语义）；休眠到 swapfile 的完整步骤（含 `resume_offset`）见第 55 章休眠小节。是否接受 0644 的 swapfile 权限因版本而异，`chmod 600` 是无争议做法。

## zram：压缩内存交换

zram 在内存里开一块压缩交换设备，速度远快于磁盘 swap、代价是占内存，适合内存紧张的桌面与 WSL——但 WSL 需内核带 zram 模块且已启用 systemd（第 26 章），不确定时用 VM 验证：

```bash
# 环境：VM 或 WSL
sudo pacman -S zram-generator
# /etc/systemd/zram-generator.conf
# [zram0]
# zram-size = min(ram / 2, 4096)
sudo systemctl daemon-reload
sudo systemctl start systemd-zram-setup@zram0
swapon --show                     # 预期看到 /dev/zram0
```

要点：大小公式按需调（`ram/2` 是常见起点）；zram 与磁盘 swap 可共存，`zram-generator` 的配置语法随版本演进，**以 [Zram](https://wiki.archlinux.org/title/Zram) 为准**；zram 不适合做休眠目标。

## 小结

- LVM 扩容顺序：`pvcreate`/`vgextend` 补 PV → `lvextend` 扩 LV → `resize2fs`/`xfs_growfs` 扩文件系统。
- 旧签名用 `wipefs`（先看后清）+ `partprobe` + `udevadm settle` 清理，`lsblk -f` 验证。
- fstab 验证必须「卸载 → `mount -a` → `findmnt`」，配合 `findmnt --verify`；`mount -a` 不管已挂载条目。
- btrfs 子卷按 `subvol=` 挂载；数据库/swapfile 类文件 `chattr +C` 关 COW。
- btrfs swapfile：`swapon` 要求无洞（完全预分配）+ NoCOW + 单一 data profile，不能对默认 CoW 文件直接 `fallocate`；手工路线先 `chattr +C` 再预分配，首选 `btrfs filesystem mkswapfile`；zram 是压缩内存交换，不当休眠目标。

## 练习

1. 在 VM 的第二块盘上走一遍 LVM 扩容链（PV → VG → LV → 文件系统），每步后 `pvs`/`vgs`/`lvs`/`df -h` 记录变化（环境：VM；预期：`df -h` 最终显示扩大后的容量）。
2. 用 `wipefs /dev/vdb` 观察签名列表，回答「`-a` 会清掉哪些、不会清掉什么」（环境：VM；预期：能说出签名与数据区的区别）。
3. 制造一次 fstab 验证闭环：写条目 → `findmnt --verify` → `umount` → `mount -a` → `findmnt`（环境：VM；预期：每步输出可解释）。
4. 建 btrfs 子卷 `@test` 并以 `subvol=@test,compress=zstd` 挂载，`findmnt -o OPTIONS` 确认选项（环境：VM；预期：OPTIONS 含 subvol 与 compress）。
5. 在 btrfs 上造 swapfile 并 `swapon --show` 验证，解释 `swapon` 的拒绝条件（为什么对默认 CoW 文件不能直接 `fallocate`）（环境：VM；预期：`swapon --show` 列出该文件）。
6. 阅读题：解释 NoCOW 为什么是数据库文件与 swapfile 的前置条件（环境：阅读题）。

## 自检

- [ ] 能默写 LVM 扩容的完整命令链与顺序
- [ ] 知道 `wipefs` 先看后清、`partprobe` 之后才算分区表生效
- [ ] 能解释 `mount -a` 的盲区与正确验证顺序
- [ ] 会建 btrfs 子卷并设置 NoCOW
- [ ] 知道 btrfs swapfile 与 zram 各自的适用与禁忌

## 参考

- [LVM](https://wiki.archlinux.org/title/LVM)
- [Btrfs](https://wiki.archlinux.org/title/Btrfs)
- [Swap](https://wiki.archlinux.org/title/Swap)
- [Zram](https://wiki.archlinux.org/title/Zram)
