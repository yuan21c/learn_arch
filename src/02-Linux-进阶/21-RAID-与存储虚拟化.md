# 第 21 章 RAID 与存储虚拟化

一块盘会坏，这是硬件事实；RAID 用多块盘把「坏一块就停机」变成「坏一块还能跑」。但 RAID 只解决**可用性**，不解决**误删、勒索、火灾**——它把同一份数据放在多块盘上，删掉的文件在每块盘上都没了。这一章讲清 RAID 各级别的代价、软 RAID 的创建与降级演练，以及 RAID 之上还能叠什么（LVM、dm-cache 等存储虚拟化层）。第 18、20 章讲的分区与文件系统是本章的地基。

> 本章目标：能按容量、容错、写代价三张账说出 RAID 0/1/5/6/10 的差别；能用 `mdadm` 在 loop 设备上创建 RAID1、模拟降级与重建，并解释 `/proc/mdstat` 的每个字段；理解 RAID 与 LVM 的叠放顺序及理由；知道硬件 RAID 与软 RAID 的边界；能判断什么时候 RAID 不解决问题、以及 RAID5 写洞与重建风险该如何缓解。
> 对应 Wiki：[RAID](https://wiki.archlinux.org/title/RAID)、[LVM](https://wiki.archlinux.org/title/LVM)、[Btrfs](https://wiki.archlinux.org/title/Btrfs)

## 级别：三张账一起算

RAID 级别的选择不是「越高越好」，而是三个量同时变化：**可用容量、可容忍的盘故障数、写入代价**。

| 级别 | 最少盘数 | 容量 | 容错 | 写入代价 | 适用 |
| ------ | ---------- | ---------------------- | ------------------------ | ------------------ | -------------------------- |
| RAID 0 | 2 | 全部盘之和 | 0（坏一块全丢） | 无校验开销 | 临时数据、可重建的缓存 |
| RAID 1 | 2 | 一半（镜像） | 每对盘坏 1 块 | 写两份 | 系统盘、小容量高可靠 |
| RAID 5 | 3 | (N-1) 块 | 坏 1 块 | 每次写要读改写 + 校验 | 读多写少的大容量 |
| RAID 6 | 4 | (N-2) 块 | 坏 2 块 | 双校验，写放大更高 | 大容量、重建窗口长 |
| RAID 10 | 4 | 一半 | 每镜像对坏 1 块 | 写两份、可并行 | 数据库等随机写密集 |

两条常被忽略的账：**RAID 5 的写代价**不是「多算一个校验」，而是小随机写要先读旧数据与旧校验、再写新数据与新校验（read-modify-write），写放大可达 4 倍；**RAID 6 的双校验**让重建期间再坏一块也能撑住，但写性能进一步下降。容量大、盘多时，重建要几小时到几天，这段时间里阵列处于降级状态——这就是「RAID 5 不适用于大容量盘」的实际理由。

RAID 不是备份：它防硬件故障，不防误删、不防文件系统损坏、不防整机失窃。备份要做的是**另一份独立介质上的副本**（第 23 章会再讲 3-2-1）。

## 软 RAID：用 loop 设备安全演练

`mdadm` 管理 Linux 的软 RAID（内核 `md` 驱动）。学习阶段不需要真盘：用几个文件当块设备（loop device），创建、降级、重建、删除都能反复做，且**删除文件即彻底回滚**。

```bash
# 要装 mdadm，且内核有 md 模块；实机也能做，但不要碰真盘
mkdir -p /tmp/lab21 && cd /tmp/lab21
for i in 1 2; do dd if=/dev/zero of=disk$i.img bs=1M count=64 status=none; done
# 用 -f --show 自动取空闲的 loop 编号；固定写 /dev/loop1 在编号被占用时会直接失败
LOOP1=$(sudo losetup -f --show disk1.img) # 若报 no free loop device，先 sudo modprobe loop
LOOP2=$(sudo losetup -f --show disk2.img)
echo "$LOOP1 $LOOP2" # 示例输出：/dev/loop1 /dev/loop2；实际编号随机器不同
lsblk "$LOOP1" "$LOOP2" # 确认两个 loop 设备就位、无分区
sudo mdadm --create /dev/md0 --level=1 --raid-devices=2 --metadata=1.2 "$LOOP1" "$LOOP2"
cat /proc/mdstat # 预期：md0 : active raid1 loop2[1] loop1[0]，两盘均为 U
sudo mkfs.ext4 /dev/md0 && sudo mkdir -p /mnt/raid1 && sudo mount /dev/md0 /mnt/raid1
```

`/proc/mdstat` 是排障主界面，字段含义固定：`[n]` 是设备在阵列中的槽位，`[U]` 表示该盘在服务、`[_]` 表示缺失或失效；`[2/2]` 是「在线盘数/应有盘数」；重建时会出现 `resync=PENDING` 或 `recovery = 12.3%` 的进度行。`--metadata=1.2` 把元数据放在设备开头，适合整盘或分区做阵列成员。

## 降级与重建：把「坏一块」演一遍

真正要练的不是创建，而是**坏一块之后系统还能不能用、换盘能不能恢复**。以下操作在 loop 阵列上完成，生产环境的命令相同，只是设备名换成真实盘：

```bash
sudo mdadm --fail /dev/md0 "$LOOP1" # 标记第一块失效（模拟拔盘）
cat /proc/mdstat # 预期：[2/1] [U_]，只剩 $LOOP2 在服务，阵列仍可读写
sudo mount | grep md0 # 确认仍挂载，写一个文件验证可用
sudo mdadm --remove /dev/md0 "$LOOP1" # 从阵列移除失效盘
sudo mdadm --add /dev/md0 "$LOOP1" # 把「新盘」加回（真实场景是换上的新盘）
cat /proc/mdstat # 预期：出现 recovery/resync 进度，完成后恢复 [2/2] [UU]
```

真实换盘还要多做两步：`mdadm --zero-superblock` 清掉旧盘残留的阵列元数据（否则 `--add` 会被拒绝或认错阵列），以及新盘容量不得小于原盘。重建期间**不要做 `scrub`、`balance` 或大规模写入**——重建本身已经是满盘 I/O，再叠负载会拉长窗口，提高「重建时再坏一块」的概率。

```bash
# 清理实验环境（顺序：先卸载、停阵列、拆 loop、删文件）
sudo umount /mnt/raid1
sudo mdadm --stop /dev/md0
sudo losetup -d "$LOOP1" "$LOOP2" # 变量沿用上面的赋值；新开的 shell 先用 losetup -a 查回设备名
rm -rf /tmp/lab21
```

这套清理顺序本身就是回滚流程：任何一步失败，都停在「阵列还在、数据还在」的状态，不会先毁数据。

## RAID 与 LVM：叠放顺序

两者可以叠，顺序有讲究：

```text
盘 → RAID（md0）→ LVM PV → VG → LV → 文件系统     （常见：先 RAID 后 LVM）
盘 → LVM PV → VG → LV → RAID（多块 LV 做 md）    （少见：先 LVM 后 RAID）
```

**先 RAID 后 LVM** 是主流：RAID 负责「坏一块不死」，LVM 负责「在线扩容与快照」，各管一层，职责清晰。反过来把多个 LV 做成 RAID，虽然可行，但 LVM 的元数据与 RAID 的重建机制叠加，排障时要同时看两层，且扩容顺序更绕。选哪种取决于你更需要「盘级冗余」还是「卷级灵活」——多数场景是前者。

## 存储虚拟化：RAID 之上还能叠什么

RAID 是最基础的存储虚拟化；再往上有几个常用层，各自的边界值得记住：

| 技术 | 解决什么 | 代价与边界 |
| ---------- | ---------------------------- | ---------------------------------------------- |
| LVM thin | 超额分配、按需增长、快照 | 池满会导致写入失败；快照链过长拖慢性能（第 19 章） |
| dm-cache | 用 SSD 给 HDD 做读/写缓存 | 缓存盘故障与元数据丢失需要处理；命中率决定收益 |
| dm-writecache | 用 SSD 加速写入落盘 | 更适合顺序写；掉电一致性依赖实现细节 |
| btrfs RAID | 文件系统自带镜像/校验 | RAID56 的写洞与性能争议需按官方文档核实（第 19 章） |

这些层的共同点：**它们都把「物理布局」与「逻辑卷」解耦**，代价是多一层元数据、多一套救援命令。原则是「一层解决一个问题」——不要在同一块盘上同时叠 thin、cache、加密、RAID，除非你能说清每一层故障时的恢复顺序。

## 硬件 RAID vs 软 RAID

| 对比 | 硬件 RAID | 软 RAID（mdadm） |
| ---------- | ---------------------------- | ---------------------------- |
| 计算位置 | 阵列卡上的处理器 | 主机 CPU |
| 系统可见 | 一张「大硬盘」 | 每块盘都可见，`md` 设备另列 |
| 换卡风险 | 卡型号/固件不同可能认不出阵列 | 盘在就能重组，依赖 Linux |
| 监控 | 厂商工具 | `/proc/mdstat`、`mdadm --detail` |
| 适用 | 企业存储、需要电池保护写缓存 | 家用/小型服务器、追求可迁移 |

硬件 RAID 的隐性风险是**阵列卡成为单点**：卡坏了、型号停产了，盘上的数据可能认不出来。软 RAID 把布局写在每块盘的元数据里，换一台 Linux 就能 `mdadm --assemble` 重组，可迁移性更好；代价是消耗主机 CPU 与内存。

## 失败模式

- **把 RAID 当备份**：误删文件在所有镜像上同时消失；RAID 只防盘坏。
- **RAID5 写洞**：掉电时「数据已写、校验未写」的不一致，重建时可能无法判断哪块可信；可用写意图日志（bitmap）或 PPL（`--consistency-policy=ppl`，本机 mdadm 4.6 已支持该参数，创建前用 `mdadm --create --help` 确认内核与元数据版本）缓解，但根本方案是 RAID6 或 RAID10。
- **重建期间再坏一块**：降级阵列在重建完成前仍然脆弱；大容量盘重建窗口长，RAID5 尤其危险。
- **UEFI 启动分区放进 RAID0**：ESP 需要固件能直接读，RAID0 跨盘条带化后固件无法识别；多盘启动方案要让 ESP 独立或做镜像（需按引导器文档设计）。
- **元数据残留**：旧盘直接 `--add` 会带着上一套阵列的签名，必须先 `--zero-superblock`。
- **忘记 `mdadm.conf` 与 initramfs**：根在 RAID 上时，`mdadm --detail --scan >> /etc/mdadm.conf` 与重建 initramfs 缺一不可，否则开机找不到阵列（第 30 章）。

## 验证与回滚

| 操作 | 验证 | 回滚 |
| ------------------- | -------------------------------------- | ------------------------------ |
| 创建阵列 | `/proc/mdstat` 显示 `[UU]`、`fsck` 通过 | `mdadm --stop` + `losetup -d`（实验环境） |
| 模拟降级 | 仍可挂载、可写入；`mdstat` 显示 `[U_]` | `--add` 回盘并等重建完成 |
| 换盘 | `mdadm --detail` 看 `State: clean, degraded, recovering` | 旧盘未销毁前可退回 |
| 改叠放结构 | 先在 loop 设备或快照上验证全套命令 | 依赖备份；LVM 元数据可用 `vgcfgrestore` |

一条铁律：**任何阵列操作前先 `mdadm --detail` 与 `cat /proc/mdstat` 记录当前状态**。出问题时，这份「操作前基线」是判断「哪块盘是新坏的、哪块是原本就缺的」的唯一依据。

## 取舍边界

- **RAID vs 备份**：不是二选一，是两层——RAID 保可用，备份保可恢复。只有 RAID 的系统仍然会丢数据。
- **RAID5 vs RAID6 vs RAID10**：盘少、写少、容量优先可考虑 RAID5；盘多、容量大、重建窗口长用 RAID6；随机写密集、性能优先用 RAID10（容量代价一半）。
- **软 RAID vs 硬件 RAID**：可迁移性与成本优先选软 RAID；需要写缓存保护与成熟监控选硬件 RAID，但要把「卡是单点」计入风险。
- **RAID vs 文件系统自带冗余**：btrfs 的镜像/校验能带来自愈能力；但 **RAID5/RAID6 在内核中仍标注为实验特性**，写入性能与故障恢复行为随内核版本变化，判断是否可用应以 btrfs 官方文档和本机 `btrfs device stats`、`btrfs scrub status` 的实际输出为准。关键数据仍建议「RAID/LVM + 独立备份」而不是只靠文件系统。

## 小结

- RAID 三张账：容量、容错、写代价；RAID 只保可用性，不保可恢复性。
- `mdadm` 可用 loop 设备安全演练：创建 → `--fail` → `--remove` → `--add` → 等重建 → 清理。
- `/proc/mdstat` 的 `[UU]`、`[2/1]`、`recovery` 进度是排障主界面；重建期间避免额外负载。
- 叠放顺序通常「先 RAID 后 LVM」：RAID 管盘级冗余，LVM 管卷级灵活。
- 存储虚拟化每加一层就多一套元数据与救援命令；一层解决一个问题。
- 硬件 RAID 的阵列卡是单点；软 RAID 可迁移性更好，代价是主机开销。
- RAID5 写洞与重建风险可用 RAID6/RAID10 或写意图日志缓解；根在 RAID 上要配 `mdadm.conf` 与 initramfs。

## 练习

1. 级别对账：用正文的三张账，计算 6 块 4 TiB 盘在 RAID0、RAID1、RAID5、RAID6、RAID10 下的可用容量与可容忍故障数，写出每种的最小盘数。
2. 创建与观察（可实机；只用 /tmp 下的 loop 镜像）：按正文用两个 loop 文件建 RAID1，记录 `cat /proc/mdstat` 与 `sudo mdadm --detail /dev/md0` 的关键行，解释 `[UU]` 与 `State: clean`。
3. 降级演练（可实机；只用 /tmp 下的 loop 镜像）：`--fail` 一块后用 `mount` 与写入验证阵列仍可用，记录 `[U_]`；再 `--remove`、`--add`，观察重建进度直到恢复 `[UU]`。
4. 元数据残留（可实机；只用 /tmp 下的 loop 镜像）：把一块盘 `--remove` 后不清 `--zero-superblock` 直接 `--add`，记录报错；清掉再 `--add`，说明为什么必须清。
5. 叠放设计题：给「4 块 2 TiB 盘、需要坏一块不停机、还要能在线扩容」写出一套设备栈（从盘到文件系统），标出每一层的命令与验证点。
6. 边界判断题：分别回答「RAID1 能否防误删」「RAID6 能否防勒索」「硬件 RAID 卡坏了怎么办」，各用一句话说明理由。

## 自检

- [ ] 能默写 RAID 0/1/5/6/10 的容量公式与可容忍故障数
- [ ] 能解释 RAID5 的写放大来源，以及为什么大容量盘不建议 RAID5
- [ ] 能用 `mdadm` 在 loop 设备上完成创建、降级、重建、清理的全流程
- [ ] 能读懂 `/proc/mdstat` 的 `[UU]`、`[2/1]`、`[U_]` 与重建进度
- [ ] 能说清 RAID 与 LVM 的叠放顺序及理由，以及硬件/软 RAID 的取舍
- [ ] 能说出 RAID 不能替代备份的三个理由，以及根在 RAID 上需要的额外配置

## 参考

- [RAID](https://wiki.archlinux.org/title/RAID)
- [LVM](https://wiki.archlinux.org/title/LVM)
- [Btrfs](https://wiki.archlinux.org/title/Btrfs)
- [mdadm(8)](https://man7.org/linux/man-pages/man8/mdadm.8.html)
