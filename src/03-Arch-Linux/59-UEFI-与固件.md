# 第 59 章 UEFI 与固件

UEFI 把「启动」从「读扇区执行代码」变成「固件按 NVRAM 里的条目加载 FAT32 分区上的 EFI 程序」。理解这三样东西——固件设置、NVRAM 启动条目、ESP 里的文件——大部分启动问题都能定位到具体一层。固件更新则是另一类风险：它写的是主板或设备自身的固件，失败可能让机器无法开机。

> 本章目标：能判断系统是否以 UEFI 启动；读懂 `efibootmgr -v` 的条目、顺序与当前启动项；理解 ESP 布局与 `EFI/BOOT/BOOTX64.EFI` fallback 的作用；知道固件设置（CSM、Secure Boot、TPM、快速启动）各自影响什么；了解 `fwupd` 的能力与风险，并坚持「未实测」的边界。
> 对应 Wiki：[Unified Extensible Firmware Interface](https://wiki.archlinux.org/title/Unified_Extensible_Firmware_Interface)、[EFI system partition](https://wiki.archlinux.org/title/EFI_system_partition)、[Fwupd](https://wiki.archlinux.org/title/Fwupd)

## 先确认：UEFI 还是传统模式

```bash
ls /sys/firmware/efi # 目录存在 = 以 UEFI 启动
cat /sys/firmware/efi/fw_platform_size # 64 = 64 位固件
efibootmgr -v # 能读条目 = EFI 变量可访问
bootctl status
```

如果 `/sys/firmware/efi` 不存在，系统是以传统 BIOS/CSM 模式启动的；此时 `efibootmgr` 无意义，ESP 也可能只是普通分区。安装方式与固件模式不一致，是「装完起不来」的常见根因。

## 三层模型：固件、NVRAM、ESP

| 层 | 内容 | 检查方式 |
| ---------- | -------------------------------------------------------- | ------------------------------ |
| 固件设置 | 启动模式（UEFI/CSM）、Secure Boot、TPM、快速启动、启动顺序 | 开机按键进固件界面 |
| NVRAM | `Boot0000`… 条目、`BootOrder`、`BootNext`、超时 | `efibootmgr -v` |
| ESP | FAT32 分区上的 `.efi` 文件与配置 | `findmnt /boot`、`ls /boot/EFI` |

固件按 `BootOrder` 依次尝试条目；每个条目记录「分区 GUID + 文件路径 + 描述」。条目指向的文件不存在、分区 GUID 变化、ESP 未挂载，都会让条目失效。`BootNext` 只对下一次启动生效，适合临时切换，不是永久顺序。

## 读 `efibootmgr -v`

```bash
efibootmgr -v
# BootCurrent: 0001
# Timeout: 1 seconds
# BootOrder: 0001,0002,0003
# Boot0001* GRUB  HD(1,GPT,...)/\EFI\GRUB\grubx64.efi
# Boot0002* systemd-boot HD(1,GPT,...)/\EFI\systemd\systemd-bootx64.efi
```

- `BootCurrent` 是本次启动使用的条目；它和 `BootOrder` 第一位不必相同。
- `*` 表示条目启用，没有 `*` 表示禁用。
- 路径里的 `HD(1,GPT,…)` 是 ESP 的分区 GUID；分区重建后 GUID 变化，旧条目会失效。
- 同一引导器出现多个重复条目很常见；清理前先确认哪个是当前使用项。

## ESP 布局与 fallback

典型 ESP：

```text
/boot/
├── EFI/
│   ├── BOOT/
│   │   └── BOOTX64.EFI        # 可移动设备 fallback 路径
│   ├── GRUB/
│   │   └── grubx64.efi
│   └── systemd/
│       ├── systemd-bootx64.efi
│       └── loader/
│           ├── loader.conf
│           └── entries/*.conf
├── vmlinuz-linux
└── initramfs-linux.img
```

`EFI/BOOT/BOOTX64.EFI` 是 UEFI 规范的可移动设备默认路径：当 NVRAM 条目全部失效或机器换盘时，固件会尝试它。把主引导器复制到该路径作为保险很常见；本章与第 61 章涉及 Secure Boot 时，这个文件也要纳入签名范围。

ESP 是 FAT32，权限模型与 Linux 文件系统不同；`/boot` 直接挂 ESP 时，内核与 initramfs 也放在 FAT32 上。ESP 空间不足会让内核更新失败，升级前应检查剩余空间。

## 固件设置：只改必要的

- **CSM/Legacy**：开启后可能以传统模式启动，与 UEFI 安装混用会找不到引导项；UEFI 安装应关闭 CSM。
- **Secure Boot**：校验签名链，细节见第 61 章；不开也能正常使用 UEFI。
- **TPM**：用于磁盘加密绑定与度量启动；开启前确认恢复密钥与固件清除策略。
- **快速启动（Fast Boot）**：跳过部分初始化，可能让 USB/网络引导不可用；排障时先关。
- **启动顺序**：把常用系统放第一位，但不要把「只能靠手动选择」的条目删掉。

固件界面因厂商而异，本章不给出具体按键；原则是「一次只改一项，改完保存重启验证」。

## 固件更新：fwupd 的边界

`fwupd` 可以在 Linux 内更新部分设备固件（主板、SSD、外设），但是否支持取决于厂商把更新发布到 LVFS：

```bash
fwupdmgr get-devices
fwupdmgr get-updates
fwupdmgr update
```

更新前必须：接稳电源、确认设备支持、阅读更新说明、保留恢复方式。固件更新失败可能让设备变砖，虚拟机与不支持设备不会提供真实更新。

> 本章的 `efibootmgr` 写操作（新建/删除/改顺序）、固件设置修改与 `fwupdmgr update` 均**未实测**；可复现练习只做 `efibootmgr -v`、`bootctl status`、`fwupdmgr get-devices` 等只读盘点。

## 失败模式

- **UEFI 固件 + 传统模式安装**：没有 ESP 或没有 EFI 条目，固件找不到系统；安装前先确认启动模式。
- **开启 CSM 后找不到条目**：CSM 可能绕过 NVRAM 或改变设备初始化；UEFI 系统应关闭 CSM。
- **删除启动条目却没记原顺序**：`efibootmgr -B` 删错条目后无法从固件界面恢复；操作前保存 `efibootmgr -v` 全文。
- **NVRAM 写满**：条目过多导致新建失败；先清理重复项，再添加。
- **ESP 空间不足**：内核或 initramfs 写入失败，升级中断；定期检查 `df -h /boot`。
- **ESP 分区 GUID 变化**：重建分区后旧条目指向不存在的 GUID；需要重建条目而非只复制文件。
- **固件更新断电**：写入中途断电可能让设备无法启动；必须接稳电源并确认可恢复。
- **把 `BootNext` 当永久顺序**：它只生效一次；永久调整要用 `-o`。

## 验证与回滚

只读盘点可以完整复现：

```bash
ls /sys/firmware/efi
cat /sys/firmware/efi/fw_platform_size
efibootmgr -v
bootctl status
findmnt /boot
df -h /boot
ls -R /boot/EFI | head -n 30
fwupdmgr get-devices
```

判读：`/sys/firmware/efi` 判断模式；`BootCurrent` 与 `BootOrder` 判断当前与顺序；ESP 挂载与剩余空间判断能否写入；`fwupdmgr get-devices` 只枚举设备，不更新。回滚：改 NVRAM 前保存 `efibootmgr -v`，用 `efibootmgr -o` 恢复顺序、`-b` 删除误建条目；ESP 文件改动前复制整个 `EFI` 目录；固件更新失败按厂商恢复流程处理，通常需要 U 盘盲刷或服务网点。

## 取舍边界

- **UEFI vs 传统 BIOS**：新硬件用 UEFI + GPT；只有老固件或特殊兼容需求才用传统模式。
- **systemd-boot vs GRUB**：单系统 UEFI 选 systemd-boot，配置少；多系统、复杂分区、需要救援命令行选 GRUB。
- **fallback 副本 vs 只留自定义条目**：多一份 `BOOTX64.EFI` 成本低，能救 NVRAM 失效；代价是 Secure Boot 下要多签一个文件。
- **OS 内固件更新 vs 厂商工具**：`fwupd` 方便、可脚本化，但支持面有限；厂商工具通常更全，但需在特定环境运行。
- **开启 Secure Boot vs 关闭**：安全收益与维护成本并存；不能写固件密钥的机器走 shim + MOK，否则按第 61 章取舍。
- **快速启动开 vs 关**：日常可开，排障与 USB 引导时关；不要为了几秒启动时间牺牲可诊断性。

## 小结

- 先确认启动模式：`/sys/firmware/efi` 存在才是 UEFI；传统模式谈 EFI 条目没有意义。
- 启动分三层：固件设置、NVRAM 条目、ESP 文件；问题要定位到具体一层。
- `efibootmgr -v` 的 `BootCurrent`、`BootOrder`、条目路径与分区 GUID 是排障核心。
- `EFI/BOOT/BOOTX64.EFI` 是可移动设备 fallback，可作为 NVRAM 失效时的保险。
- 固件设置一次只改一项；CSM、Secure Boot、TPM、快速启动都会改变启动行为。
- `fwupd` 只更新厂商发布到 LVFS 的设备；更新前接稳电源并确认恢复方式，本章未实测。

## 练习

1. 执行 `ls /sys/firmware/efi`、`cat /sys/firmware/efi/fw_platform_size`、`efibootmgr -v`，记录启动模式、当前条目与顺序（只读）。
2. 从 `efibootmgr -v` 找出 `BootCurrent` 对应条目，说明它的分区 GUID 与文件路径。
3. 列出 `/boot/EFI` 下的文件，指出哪个是 fallback，哪个是主引导器（只读）。
4. 检查 `/boot` 的挂载点与剩余空间，解释 ESP 空间不足会破坏哪一步升级。
5. 说明 `BootNext` 与 `BootOrder` 的差别，各给一个使用场景。
6. 列出固件更新前的四项准备，以及更新失败时的两条恢复路径。

## 自检

- [ ] 能判断系统是否以 UEFI 启动
- [ ] 能读懂 `efibootmgr -v` 的条目、顺序与当前项
- [ ] 知道 ESP 布局与 `EFI/BOOT/BOOTX64.EFI` 的作用
- [ ] 能区分固件设置、NVRAM、ESP 三层的问题
- [ ] 知道 `fwupd` 的能力边界与更新风险
- [ ] 明确 NVRAM 与固件写操作未实测，只做只读盘点

## 参考

- [Unified Extensible Firmware Interface](https://wiki.archlinux.org/title/Unified_Extensible_Firmware_Interface)
- [EFI system partition](https://wiki.archlinux.org/title/EFI_system_partition)
- [Fwupd](https://wiki.archlinux.org/title/Fwupd)
- [efibootmgr(8)](https://man.archlinux.org/man/efibootmgr.8)
- 上一章：[第 58 章 启动深讲](58-启动深讲.md)
- 下一章：[第 60 章 内核、模块与 initramfs](60-内核-模块与-initramfs.md)
