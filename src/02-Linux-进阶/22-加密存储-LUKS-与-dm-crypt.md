# 第 22 章 加密存储：LUKS 与 dm-crypt

第 18、20、21 章把盘分好、文件系统建好、RAID 叠好，数据在磁盘上仍然是明文——拆下硬盘、挂到另一台机器，`mount` 一下就能读。加密存储解决的是**介质离开机器之后**的保密问题：磁盘被偷、被转卖、被返修时，里面的内容无法直接读取。本章只讲块层加密这一种做法（LUKS + dm-crypt），以及它的密钥管理、日常运维与不可逆风险；文件级加密（GPG、age）与全盘加密的取舍放在最后一节比较。

> 本章目标：理解 dm-crypt 在块层的位置与 LUKS 头部（header）、密钥槽（keyslot）、主密钥（volume key）三者的关系；能在一个 loop 文件上完整走一遍「格式化 → 打开 → 建文件系统 → 挂载 → 关闭 → 重开」；会用 `cryptsetup` 管理多个口令、备份与恢复 header；能说出 TRIM、休眠、密钥文件、LUKS1/LUKS2 各自的边界；知道密码丢失与 header 损坏分别意味着什么。
> 对应 Wiki：[Dm-crypt](https://wiki.archlinux.org/title/Dm-crypt)、[Dm-crypt/System configuration](https://wiki.archlinux.org/title/Dm-crypt/System_configuration)、[Dm-crypt/Specialties](https://wiki.archlinux.org/title/Dm-crypt/Specialties)

## 原理：加密发生在文件系统之下

dm-crypt 是内核 device-mapper 的一个目标（target）。它把「上层看到的块设备」与「底层真实扇区」之间的每一次读写都做一次加解密，文件系统对此完全无感：

```text
文件 → 文件系统（ext4/btrfs）→ dm-crypt（每个扇区加解密）→ 真实块设备
                                      ↑
                              LUKS header 里的密钥
```

这个位置决定了三件事：**加密对文件系统透明**（换 ext4、XFS、btrfs 都不影响）、**元数据也加密**（文件名、目录结构同样不可见）、**性能开销发生在块层**（CPU 做对称加密，现代 CPU 有 AES-NI 时开销很小）。用 `cryptsetup benchmark` 可以看本机各算法的实测吞吐。

### LUKS：头部 + 密钥槽 + 数据区

LUKS 不是「一种加密算法」，而是一套**头部格式**。一个 LUKS 容器分三段：

| 区域 | 内容 | 丢失后果 |
| ---------- | ------------------------------------------ | ---------------------------------- |
| header | 版本、cipher 参数、UUID、keyslot 描述、JSON（LUKS2） | 容器无法识别，数据等于不可读 |
| keyslot 区 | 每个口令加密保存的一份主密钥副本 | 对应口令失效，其他 keyslot 仍可用 |
| 数据区 | 真正加密后的文件系统 | 依赖主密钥；主密钥在 keyslot 里 |

关键设计是**两级密钥**：你输入的口令不直接加密数据，而是经 KDF（密钥派生函数）派生出密钥，用它解开某个 keyslot 里保存的**主密钥（volume key）**；数据区始终用主密钥加密。好处是改口令只需重写 keyslot，不必重新加密整块盘；多个口令也只是多个 keyslot。因此「改密码」和「换主密钥」是两件完全不同的事，后者要 `cryptsetup reencrypt` 全盘重写。

LUKS1 与 LUKS2 的差别值得记：

| 对比 | LUKS1 | LUKS2 |
| ---------- | ----------------------- | ------------------------------------------ |
| 元数据 | 固定二进制结构 | JSON，主副两份，带校验 |
| 默认 KDF | PBKDF2 | Argon2id（抗 GPU/ASIC） |
| 默认数据偏移 | 约 2 MiB | 16 MiB（keyslot 区更大） |
| 附加能力 | 少 | token（TPM、FIDO2、systemd-cryptenroll）、在线 reencrypt |
| 兼容性 | 老工具与引导器普遍支持 | 新工具支持；GRUB 对 LUKS2 的支持有限：只解析 PBKDF2 派生的 keyslot，Argon2 解不开；加密 `/boot` 还需 `GRUB_ENABLE_CRYPTODISK=y` |

在本书验证环境实测（cryptsetup 2.8.8）用默认参数 `luksFormat --type luks2` 后，`luksDump` 显示：`Metadata area: 16384 [bytes]`、`Keyslots area: 16744448 [bytes]`、数据 `offset: 16777216 [bytes]`，cipher 为 `aes-xts-plain64`、密钥 512 bit、PBKDF 为 `argon2id`。这些数字解释了为什么 LUKS2 容器开头会「吃掉」约 16 MiB——它不是文件系统，是头部预留。

还有一条必须说清的边界：**LUKS 提供机密性，不提供完整性**。攻击者不能读出内容，但可以在你不知道的情况下翻转密文位，导致解密后的明文出现可控错误；`dm-crypt` 默认不检测这种篡改。需要认证加密时，LUKS2 可以在格式化时加 `--integrity`，底层换成 dm-integrity，代价是额外空间与性能。

## 步骤：在 loop 文件上建一个 LUKS2 容器

学习阶段不要碰真盘。用一个普通文件当块设备（loop device），创建、打开、关闭、删除都能反复做，且**删掉文件就彻底回滚**。以下命令已在本书验证环境跑通（cryptsetup 2.8.8，全程只在 `/tmp` 下操作）：

```bash
# 要 root；实机也能做，但只碰 /tmp 下的文件
mkdir -p /tmp/lab22 && cd /tmp/lab22
truncate -s 64M vault.img # 造一个 64 MiB 的容器文件
LOOP=$(sudo losetup -f --show vault.img) # 分配空闲 loop 设备并接住设备名（如 /dev/loop0）
printf 'testpass' | sudo cryptsetup luksFormat --type luks2 --batch-mode --key-file - "$LOOP"
sudo cryptsetup luksDump "$LOOP" | head -30 # 预期：Version 2、cipher aes-xts-plain64、PBKDF argon2id
printf 'testpass' | sudo cryptsetup open --key-file - "$LOOP" vault
sudo mkfs.ext4 /dev/mapper/vault # 注意对象是 /dev/mapper/vault，不是 $LOOP
sudo mkdir -p /mnt/lab22 && sudo mount /dev/mapper/vault /mnt/lab22
echo secret | sudo tee /mnt/lab22/note.txt
sudo umount /mnt/lab22 && sudo cryptsetup close vault
```

重开一次，验证「关上再打开」这条日常路径：

```bash
printf 'testpass' | sudo cryptsetup open --key-file - "$LOOP" vault
sudo mount /dev/mapper/vault /mnt/lab22
cat /mnt/lab22/note.txt # 预期：secret
sudo cryptsetup status vault # 预期：type LUKS2、cipher、keysize、device、offset
```

`cryptsetup status` 是运行时的主界面：它显示映射名、底层设备、cipher、keysize、数据偏移与是否启用了 discard。`lsblk -f` 则会把未打开的容器标成 `crypto_LUKS`，打开后多出一层 `crypt` 设备——这两条输出是判断「加密层到底有没有接上」的最快方式。

## 日常运维：口令、crypttab 与 header 备份

**多口令与改口令。** 每个口令占一个 keyslot，`luksDump` 的 `Keyslots:` 段能看到编号与 KDF 参数：

```bash
sudo cryptsetup luksAddKey "$LOOP" # 追加一个新口令（先验证一个已有口令）
sudo cryptsetup luksChangeKey "$LOOP" # 改某个口令：验证旧的、写入新的
sudo cryptsetup luksKillSlot "$LOOP" 1 # 销毁 1 号 keyslot（先确认它不是唯一可用的口令）
```

`luksKillSlot` 是**不可逆**的：被销毁的 keyslot 无法恢复，必须还有一个已知口令的 keyslot 才能打开。误删最后一个 keyslot 等于永久锁死数据，动手前先 `luksDump` 数清有几个槽。

**开机自动打开。** `/etc/crypttab` 的格式是四段：`<映射名> <设备> <口令来源> <选项>`：

```text
vault UUID=50885dac-f517-46aa-9d0b-91923d1817c4 none luks,discard
```

`none` 表示开机时交互式询问口令；也可以写密钥文件路径（如 `/etc/keys/vault.key`，权限必须严格）。`discard` 打开 TRIM 透传。systemd 会按 crypttab 生成 `systemd-cryptsetup@vault.service`，`systemctl start`/`status` 可单独调试。根分区加密还要在 initramfs 里带上 `cryptsetup` hook 并重建 initramfs，否则内核启动时根本没人解锁——这部分与第 30 章的启动链、第 58 章的 mkinitcpio 衔接。

**header 备份。** 这是本章最重要的一条纪律。头部损坏时，即使口令正确、数据完好，容器也无法识别；man 页写得很直接：*If the header of a LUKS volume gets damaged, all data is permanently lost unless you have a header backup.* 备份与验证如下：

```bash
sudo cryptsetup luksHeaderBackup "$LOOP" --header-backup-file /tmp/lab22/header.bak
sudo cryptsetup luksDump --header /tmp/lab22/header.bak "$LOOP" | head -8 # 用备份文件当 header 读一次，确认可解析
```

`--header` 选项让所有 LUKS 命令改用指定的 header 文件或设备（优先于位置参数），所以上面这条能直接用备份文件 dump，不必先恢复。备份文件里含**加密后的主密钥副本**，它和口令一样敏感：应与数据盘分开存放，不能放在同一块要加密的盘上。

## 失败模式

- **header 丢失或损坏**：误分区、误 `wipefs`、SSD 固件故障、把前 16 MiB 写成 0，都会让 `cryptsetup` 报「不是有效 LUKS 设备」。没有 header 备份时，主密钥随之丢失，数据在密码学意义上不可恢复。
- **口令全丢**：所有 keyslot 都解不开，等于主密钥不可得。LUKS 没有「管理员后门」，也没有「重置密码」这回事。
- **`luksFormat` 指向已有数据**：格式化只写头部与 keyslot 区，不擦数据区，但旧文件系统已经不可达。对着真盘执行与 `mkfs` 同级危险，先 `lsblk -f` 与 `cryptsetup isLuks` 确认对象。
- **TRIM 泄露使用模式**：打开 `discard` 后，SSD 能知道哪些块已空闲，从而推断文件系统的写入与删除模式。它提升寿命与性能，但削弱「看不出盘上有什么」这一属性；是否开启取决于威胁模型。
- **休眠把明文写进 swap**：休眠会把内存快照写进 swap。如果 swap 没加密，全盘加密等于被绕过。要么用加密 swap，要么禁用休眠（第 18、19 章的 swap 配置在这里多了一层安全约束）。
- **挂起时密钥仍在内存**：普通 suspend 不擦除内存中的主密钥；对高敏感场景可用 `cryptsetup luksSuspend` 主动丢弃密钥，恢复时必须重新输入口令（`luksResume`）。
- **把加密当完整性**：LUKS 不防篡改，误以为「加密了就安全」会忽略备份与哈希校验；需要完整性时用 `--integrity` 或在上层做签名/校验和。
- **只加密数据盘、忘了系统盘上的密钥文件**：密钥文件放在未加密分区，等于把钥匙和锁放在一起。

## 验证与回滚

| 操作 | 验证 | 回滚 |
| ----------------------- | -------------------------------------------- | ------------------------------------------ |
| 创建容器 | `cryptsetup luksDump` 显示 Version 与 cipher | loop 文件删除即彻底回滚（实验环境） |
| 打开容器 | `cryptsetup status` 显示映射与 offset | `cryptsetup close <名>`，再 `losetup -d` |
| 改口令 / 加 keyslot | 用新旧口令各跑一次 `open --test-passphrase` | 旧口令仍有效的 keyslot 不要提前销毁 |
| 备份 header | `luksDump --header 备份文件 <设备>` 能解析 | 备份文件本身即回滚材料 |
| 恢复 header | 恢复后 `luksDump` 与 `open` 均成功 | 恢复会覆盖当前 header，先另存一份再操作 |

口令是否可用，不必真的打开容器，`--test-passphrase` 只验证不映射：

```bash
printf 'testpass' | sudo cryptsetup open --test-passphrase --key-file - "$LOOP" && echo pass-ok
```

**header 损坏与恢复的完整演练**（在 loop 文件上做，安全）：

```bash
# 接上面的实验环境：先 umount、close、losetup -d，再操作文件
cp /tmp/lab22/vault.img /tmp/lab22/vault2.img # 在副本上演练，原件保持可用
sudo dd if=/dev/zero of=/tmp/lab22/vault2.img bs=1M count=16 conv=notrunc status=none # 副本前 16 MiB 清零
sudo cryptsetup luksDump /tmp/lab22/vault2.img # 预期：报「不是有效 LUKS 设备」（header 已毁）
sudo cryptsetup luksHeaderRestore /tmp/lab22/vault2.img \
  --header-backup-file /tmp/lab22/header.bak --batch-mode
sudo cryptsetup luksDump /tmp/lab22/vault2.img | head -5 # 预期：恢复正常，Version 2
```

注意顺序：`luksHeaderRestore` 会**覆盖**目标设备当前的 header 与 keyslot 区，所以先确认目标就是要恢复的那块容器；恢复不触碰数据区，但 header 里的 UUID、cipher 参数必须与数据区匹配，拿错备份恢复等于把锁换成了另一把钥匙。

清理实验环境时按「卸载 → 关闭映射 → 拆 loop → 删文件」倒序执行，任何一步失败都停在数据仍可读的状态：

```bash
sudo umount /mnt/lab22
sudo cryptsetup close vault
sudo losetup -d "$LOOP"
rm -rf /tmp/lab22
```

## 取舍边界

- **全盘加密 vs 文件级加密**：全盘加密防「整机/整盘丢失」，但对已开机、已解锁的系统无能为力；文件级加密（GPG、age）能保护单个文件跨介质传输，但元数据与目录结构可能暴露。两者不是替代关系，常见组合是「系统盘全盘加密 + 备份文件再单独加密」。
- **LUKS vs plain dm-crypt**：`plain` 模式没有 header、没有 keyslot，口令直接派生密钥，看起来更「干净」，但 cipher 参数要靠记忆或外部记录，改口令等于全盘重加密，也没有多口令能力。除特殊威胁模型外，选 LUKS2。
- **LUKS2 vs LUKS1**：新系统默认 LUKS2。若要让 GRUB 直接解锁加密的 `/boot`，要么用 `--pbkdf pbkdf2` 建 LUKS2 并开 `GRUB_ENABLE_CRYPTODISK=y`，要么退回 LUKS1；具体能力以 GRUB 文档与你的版本为准。更省事的做法是 `/boot` 单独分区、不加密，把 LUKS 只用在根分区上。
- **passphrase vs keyfile vs TPM/FIDO2**：口令易用但可被暴力猜测（Argon2 只是提高成本）；keyfile 适合自动化，但文件本身要保护；TPM/FIDO2 能免输入，却把「能否开机解锁」绑定到硬件状态，主板更换或固件升级可能导致解不开。生产环境常用「keyfile + 恢复口令」双路径。
- **TRIM 开 vs 关**：开提升 SSD 寿命与写性能，代价是泄露使用模式；关则保留「看不出盘上有什么」，但长期可能影响 SSD 垃圾回收效率。
- **加密 vs 备份**：加密不替代备份，header 备份也不替代数据备份。加密盘损坏时，唯一可靠的路是「另一份未受同一故障影响的备份」。

## 小结

- dm-crypt 在块层加解密，文件系统透明；LUKS 是一套头部格式，不等于某种算法。
- LUKS 三段：header、keyslot 区、数据区；口令只解开 keyslot 里的主密钥，数据始终用主密钥加密。
- LUKS2 用 JSON 元数据与 Argon2id，默认 cipher 为 `aes-xts-plain64`，数据偏移约 16 MiB（实测确认）。
- loop 文件是最安全的演练环境：`truncate` → `losetup` → `luksFormat` → `open` → `mkfs` → `mount`，删文件即回滚。
- `luksAddKey`/`luksChangeKey`/`luksKillSlot` 管口令；`/etc/crypttab` 管开机解锁；initramfs 需带 `cryptsetup` hook。
- **header 必须备份并验证**：`luksHeaderBackup` 后用 `luksDump --header` 读一次；header 丢了，口令正确也救不回数据。
- LUKS 提供机密性不提供完整性；TRIM、休眠、密钥文件的存放位置都会改变实际安全边界。

## 练习

1. 容器全流程（可实机；只在 /tmp 下建容器文件）：按正文在 `/tmp/lab22` 建 64 MiB 的 LUKS2 容器，完成打开、`mkfs.ext4`、挂载、写文件、卸载、关闭、重开、读回，记录 `luksDump` 与 `status` 的关键字段（预期：Version 2、`aes-xts-plain64`、offset 16777216）。
2. 多口令（可实机；只在 /tmp 下建容器文件）：用 `luksAddKey` 加第二个口令，分别用两个口令执行 `open --test-passphrase`；再用 `luksKillSlot` 销毁第二个槽，确认第一个口令仍可打开（预期：两条 test-passphrase 均成功，销毁后只剩一个）。
3. header 备份与恢复（可实机；只在 /tmp 下建容器文件）：`luksHeaderBackup` 后在副本上前 16 MiB 清零，确认 `luksDump` 失败；用 `luksHeaderRestore` 恢复并再次 dump，说明 header 与数据区各自的作用（预期：清零后报无效 LUKS，恢复后正常）。
4. 口令错配（可实机；只在 /tmp 下建容器文件）：故意用错误口令执行 `open --test-passphrase`，记录退出码与报错；再解释为什么「口令错」和「header 坏」的报错不同。
5. crypttab 设计题：为一个非根数据盘写出一条 `crypttab` 条目（UUID、`none`、`discard`），说明开机时会提示什么、`systemctl status systemd-cryptsetup@<名>.service` 能看出什么；再回答根分区加密还需要改哪个文件（提示：mkinitcpio 的 HOOKS）。
6. 边界判断题：分别回答「LUKS 能否检测密文被篡改」「全盘加密能否防住已登录的攻击者」「header 备份应该放在哪」「开了 discard 会泄露什么」，各用一句话说明理由。

## 自检

- [ ] 能画出「文件系统 → dm-crypt → 块设备」的位置，并解释为什么 LUKS 对文件系统透明
- [ ] 能说清 header、keyslot、主密钥三者的关系，以及「改口令」与「换主密钥」的区别
- [ ] 能默写 loop 文件上的创建、打开、挂载、关闭、清理流程
- [ ] 知道 `luksHeaderBackup` 的必要性，并会用 `luksDump --header` 验证备份
- [ ] 能说出 LUKS2 相对 LUKS1 的三个变化（JSON、Argon2id、16 MiB 偏移）
- [ ] 能解释 TRIM、休眠、密钥文件位置如何改变安全边界
- [ ] 能区分「口令丢失」「keyslot 被销毁」「header 损坏」三种故障的恢复可能

## 参考

- [Dm-crypt](https://wiki.archlinux.org/title/Dm-crypt)
- [Dm-crypt/System configuration](https://wiki.archlinux.org/title/Dm-crypt/System_configuration)
- [Dm-crypt/Specialties](https://wiki.archlinux.org/title/Dm-crypt/Specialties)
- [cryptsetup(8)](https://man7.org/linux/man-pages/man8/cryptsetup.8.html)
