# 第 19 章 存储进阶：LVM、btrfs 与 zram

第 18 章走完了「分区 → 格式化 → 挂载 → fstab」的主线，本章补三块进阶：LVM 空间不够时怎么扩、旧签名与 fstab 写错怎么收拾、btrfs 与 zram 这两个第 35 章会用到的现代部件。全部属于动手会丢数据的领域，每一节都带恢复路径。

> 本章目标：会用 `vgextend`/`lvextend` 完成 LVM 扩容全链；能用 `wipefs`/`partprobe` 清理旧签名并用 `findmnt --verify` 校验 fstab；理解 btrfs 子卷/NoCOW 与 swapfile 的特殊要求；能配置 zram 作为压缩内存交换。
> 对应 Wiki：[LVM](https://wiki.archlinux.org/title/LVM)、[Btrfs](https://wiki.archlinux.org/title/Btrfs)、[Zram](https://wiki.archlinux.org/title/Zram)

## LVM 扩容：从物理卷到文件系统

第 18 章的三层（PV/VG/LV）在扩容时的顺序是**自下而上补空间、自上而下扩容量**：VG 满了先给它加 PV，再扩 LV，最后扩文件系统。

```bash
# 需要第二块磁盘（新盘 /dev/vdb）；没有就只读命令与输出解释
sudo pvcreate /dev/vdb # 建物理卷
sudo vgextend vg0 /dev/vdb # 最常用：加一块新 PV；也可 pvresize、换更大 PV 或回收空间
sudo lvextend -L +10G /dev/vg0/data # 逻辑卷加 10G
sudo resize2fs /dev/vg0/data # ext4 随之扩大
# XFS 用：sudo xfs_growfs /dev/vg0/data
```

只扩 LV 不扩文件系统，`df -h` 看到的容量不会变——`resize2fs`/`xfs_growfs` 这步不能省。缩容方向相反且风险高（xfs 不支持缩），本书不鼓励；要做先备份。

> **危险**：`pvcreate`/`vgreduce`/`lvremove` 直接改 LVM 元数据，指错设备就是数据消失。执行前 `pvs`/`vgs`/`lvs` 逐一确认设备名，任何 `remove` 操作先做快照或备份。

## 旧签名与分区表：wipefs、partprobe

同一块盘装过别的系统时，旧文件系统签名会留在分区头，`mkfs` 可能认错类型或报警。先分清两种目标：**整盘重做分区**（会一并清掉分区表）与**只清某个分区的旧签名**（保留分区布局）。

```bash
# 需要第二块磁盘，且必须是空盘或确认可丢弃
lsblk -f /dev/vdb # 先看清盘上有没有分区、各分区 FSTYPE
sudo sfdisk -d /dev/vdb > vdb.layout # 备份分区表布局（重建依据）
sudo wipefs /dev/vdb # 只读：列出整盘上的签名
sudo wipefs -a /dev/vdb # 清整盘签名（含分区表），分区节点会消失
sudo partprobe /dev/vdb # 让内核重读分区表
sudo udevadm settle # 等设备节点稳定
lsblk -f /dev/vdb # 预期不再显示分区及其 FSTYPE，但不代表数据被擦除
```

只想清某个分区里的旧文件系统签名、保留分区布局时，把对象换成分区设备：

```bash
sudo wipefs /dev/vdb1 # 只读确认该分区签名
sudo wipefs -a /dev/vdb1 # 只清该分区签名，分区表不变
```

`wipefs -a` 只清签名不擦数据区（数据仍可被工具找回，但系统不再识别）。对**整盘**执行时，分区表签名一并被清：分区节点从 `lsblk` 消失、`lsblk -f` 往往显示空盘，但分区内的数据仍在，只是不可达；需按 `vdb.layout` 的原始几何重建分区后才可能重新识别。分区表改动后必须 `partprobe` + `udevadm settle`，否则 `mkfs` 可能写到旧的设备映射上。

> **危险**：`wipefs -a` 与 `mkfs` 同级危险，永远先跑不带 `-a` 的 `wipefs` 看清楚签名列表，确认设备无误再动手。整盘 `-a` 会清掉分区表：没有布局备份就只能凭记忆重建，数据虽然还在但难以定位；只在一次性 VM 或确认可丢弃的盘上演练。

## fstab 的校验与恢复闭环

第 18 章的「先备份」只是第一步，闭环是：**校验 → 重挂验证 → 出错可回退**。

```bash
# 会改写块设备：只用可丢弃的磁盘或快照，不要在数据盘上照抄
sudo findmnt --verify # 校验 /etc/fstab 全部条目（语法/设备/选项）
sudo cp /etc/fstab /etc/fstab.bak
# 改 fstab 后：先卸载再让 mount -a 全新挂一遍，才是真实验证
sudo umount /mnt/lab13
sudo mount -a
findmnt /mnt/lab13 # 预期：挂载点出现在输出中
```

`mount -a` 只处理**尚未挂载**的条目——已手工挂上的条目根本不会被读取，「手挂能通、开机挂不上」的经典事故就是这么漏掉的。进不去系统时在 emergency 模式下 `mount -o remount,rw /` 后从 `.bak` 恢复（第 30 章）。

## btrfs：子卷、NoCOW 与压缩

btrfs 把「子卷」当作可独立挂载/快照的管理单元，第 35 章的安装可选它做根文件系统：

```bash
# 会改写块设备：只用可丢弃的磁盘或快照，不要在数据盘上照抄
sudo mkfs.btrfs /dev/vdb1
sudo mount /dev/vdb1 /mnt
sudo btrfs subvolume create /mnt/@ # 根子卷
sudo btrfs subvolume create /mnt/@home # 家目录子卷
sudo umount /mnt
sudo mount -o subvol=@,compress=zstd /dev/vdb1 /mnt # 挂指定子卷
```

三个关键概念：`subvol=` 挂载选项决定用哪个子卷；`compress=zstd` 透明压缩（CPU 换空间）；**NoCOW**（`chattr +C`）关掉写时复制。swapfile 是硬性要求——btrfs 上的 swapfile 必须 NoCOW（且不能压缩、必须预分配），否则 `swapon` 会拒绝；数据库、虚拟机镜像属于性能建议：它们自己管理并发写，关掉 COW 可减少随机小写放大与碎片，代价是失去数据校验和与压缩。`chattr +C` 只能对空文件/空目录生效。

## btrfs 上的 swapfile

ext4 上 `fallocate` 一把梭的 swapfile 不能原样搬到 btrfs：`swapon` 的拒绝条件是**无洞（完全预分配）+ NODATACOW + 单一 data profile**，不是 fallocate 本身不可用。btrfs-progs ≥ 6.1 推荐直接用 `sudo btrfs filesystem mkswapfile --size 2G /swapfile`（再 `sudo swapon /swapfile`）；手工路线则是先关 COW、用非 COW 方式占空间：

```bash
# 会改写子卷与挂载表：只用可丢弃的磁盘或快照；btrfs 文件系统上
sudo btrfs filesystem mkswapfile --size 2G /swapfile # 首选：一步创建无洞、NODATACOW 的 swapfile
sudo swapon /swapfile
# 手工路线（旧版 btrfs-progs）：
sudo truncate -s 0 /swapfile
sudo chattr +C /swapfile
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 # 预分配物理空间
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

含活跃 swapfile 的子卷不可快照；`balance`/`scrub` 会跳过相关 block group。文件还不能被压缩（`compress` 会破坏 swap 语义）；休眠到 swapfile 的完整步骤（含 `resume_offset`）见第 93 章休眠小节。是否接受 0644 的 swapfile 权限因版本而异，`chmod 600` 是无争议做法。

## zram：压缩内存交换

zram 在内存里开一块压缩交换设备，速度远快于磁盘 swap、代价是占内存，适合内存紧张的桌面与虚拟机——前提是内核带 zram 模块且系统由 systemd 启动（第 37 章），不确定时先在 VM 验证：

```bash
sudo pacman -S zram-generator
# /etc/systemd/zram-generator.conf
# [zram0]
# zram-size = min(ram / 2, 4096)
sudo systemctl daemon-reload
sudo systemctl start systemd-zram-setup@zram0
swapon --show # 预期看到 /dev/zram0
```

要点：大小公式按需调（`ram/2` 是常见起点）；zram 与磁盘 swap 可共存，`zram-generator` 的配置语法随版本演进，**以 [Zram](https://wiki.archlinux.org/title/Zram) 为准**；zram 不适合做休眠目标。

## 失败模式

- **`lvextend` 忘了 `-r`**：LV 变大但文件系统没变，`df` 仍显示旧容量；要么加 `-r`，要么手动 `resize2fs`/`xfs_growfs`。
- **`vgextend` 加错 PV**：把已有文件系统的分区 `pvcreate` 进卷组，会覆盖其签名；先 `lsblk -f` 确认。
- **btrfs 挂错子卷**：`subvol=` 名字写错会挂到默认子卷（通常是顶层），表现为「文件都在但目录结构不对」；用 `btrfs subvolume list` 核对。
- **对非空文件/目录 `chattr +C`**：NoCOW 属性只对空文件或空目录生效，已有数据的文件不会追溯关闭 COW。
- **btrfs swapfile 直接 `fallocate`**：`swapon` 要求无洞、NoCOW、单一 data profile；默认 CoW 文件会被拒绝。
- **快照含活跃 swapfile**：含活跃 swapfile 的子卷不能快照；`balance`/`scrub` 也会跳过相关 block group。
- **thin pool 满**：超额分配后池满会让写入失败，甚至影响同池其他卷；监控 `lvs` 的 Data% 与 Metadata%。
- **zram 配置照抄旧版**：`zram-generator` 的配置语法随版本变化，旧示例可能不生效；以 Arch Wiki 当前版本为准。

## 验证与回滚

| 操作 | 验证 | 回滚 |
| ---------------------- | ------------------------------------------------ | ------------------------------------------ |
| LVM 扩容 | `lvs` 看 LV 大小；`df`/`findmnt` 看文件系统大小 | 缩容风险高（XFS 不支持缩），扩容前先快照 |
| btrfs 子卷 | `btrfs subvolume list /mnt`；`findmnt` 看 `subvol=` | 卸载后换 `subvol=` 重新挂载 |
| btrfs 快照 | `btrfs subvolume snapshot` 后列出快照；只读挂载检查 | 删除快照 `btrfs subvolume delete` |
| zram | `swapon --show` 看 `/dev/zram0`；`zramctl` 看压缩比 | 停止 `systemd-zram-setup@zram0`，恢复磁盘 swap |
| 压缩 | `btrfs filesystem du`/`compression` 统计；`compsize` 工具 | 关闭 `compress` 选项，已有数据不会自动解压 |

## 取舍边界

- **LVM vs btrfs 子卷**：LVM 在块层做卷管理，文件系统无关；btrfs 子卷在文件系统内做命名空间与快照，和校验和/压缩绑定。需要「任意文件系统 + 快照」用 LVM；需要「文件级校验 + 子卷」用 btrfs。
- **thin vs thick**：thin 支持超额分配与快照，代价是池满风险与元数据复杂度；thick 容量确定、行为可预测。生产环境用 thin 必须监控池使用率。
- **zram vs 磁盘 swap**：zram 延迟低、减少 SSD 写入，但占内存且不能休眠；磁盘 swap 容量大、可休眠，但慢。内存小的桌面用 zram，服务器保留磁盘 swap 兜底。
- **压缩 vs CPU**：`compress=zstd` 省空间、减少 I/O，代价是 CPU；CPU 紧张的虚拟机上可能得不偿失，按负载测。
- **CoW vs NoCOW**：CoW 带来快照与校验，适合通用数据；数据库/虚拟机镜像自己管理写入，NoCOW 减少写放大，代价是失去校验与压缩。按文件类型分目录设置，而不是全盘一刀切。

## 小结

- LVM 扩容顺序：`pvcreate`/`vgextend` 补 PV → `lvextend` 扩 LV → `resize2fs`/`xfs_growfs` 扩文件系统。
- 旧签名用 `wipefs`（先看后清）+ `partprobe` + `udevadm settle` 清理，`lsblk -f` 验证。
- fstab 验证必须「卸载 → `mount -a` → `findmnt`」，配合 `findmnt --verify`；`mount -a` 不管已挂载条目。
- btrfs 子卷按 `subvol=` 挂载；数据库/swapfile 类文件 `chattr +C` 关 COW。
- btrfs swapfile：`swapon` 要求无洞（完全预分配）+ NoCOW + 单一 data profile，不能对默认 CoW 文件直接 `fallocate`；手工路线先 `chattr +C` 再预分配，首选 `btrfs filesystem mkswapfile`；zram 是压缩内存交换，不当休眠目标。

## 练习

1. 在第二块盘上走一遍 LVM 扩容链（PV → VG → LV → 文件系统），每步后 `pvs`/`vgs`/`lvs`/`df -h` 记录变化（需要第二块磁盘；没有就只读命令与输出解释。预期：`df -h` 最终显示扩大后的容量）。
2. 用 `wipefs /dev/vdb` 观察签名列表，回答「`-a` 会清掉哪些、不会清掉什么」（会改写块设备签名：只用可丢弃的磁盘或快照；预期：能说出签名与数据区的区别）。
3. 制造一次 fstab 验证闭环：写条目 → `findmnt --verify` → `umount` → `mount -a` → `findmnt`（会改挂载表：只用可丢弃的磁盘或快照；预期：每步输出可解释）。
4. 建 btrfs 子卷 `@test` 并以 `subvol=@test,compress=zstd` 挂载，`findmnt -o OPTIONS` 确认选项（会改子卷与挂载表：只用可丢弃的磁盘或快照；预期：OPTIONS 含 subvol 与 compress）。
5. 在 btrfs 上造 swapfile 并 `swapon --show` 验证，解释 `swapon` 的拒绝条件（为什么对默认 CoW 文件不能直接 `fallocate`）（会改写 swap 配置：只用可丢弃的磁盘或快照；预期：`swapon --show` 列出该文件）。
6. 阅读题：解释 NoCOW 为什么是数据库文件与 swapfile 的前置条件。

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
