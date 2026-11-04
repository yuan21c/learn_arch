# 第 61 章 Secure Boot：签名、shim 与 MOK

第 30 章讲启动链时把 Secure Boot 留给了本章，第 58 章安装引导器默认假设它是关的。真机装完起不来，十有八九卡在这里：UEFI 固件只执行它信任的签名程序。本章给三条路线——关闭、sbctl 自签、shim + MOK——以及各自的回退方案。

> 本章目标：理解 Secure Boot 在启动链中的校验位置；能安全地关闭它；能用 sbctl 完成签名并处理内核升级后的重签；知道 shim/MOK 路线的适用场景与救援方法。
> 对应 Wiki：[Unified Extensible Firmware Interface/Secure Boot](https://wiki.archlinux.org/title/Unified_Extensible_Firmware_Interface/Secure_Boot)、[sbctl](https://wiki.archlinux.org/title/Sbctl)

## Secure Boot 校验的是什么链

固件在移交控制权之前会逐级校验签名：引导器 → 内核（或 UKI）→ 可执行的早期代码。链上任何一环没签名、或签名者不在固件信任名单里，启动就停住或直接跳回固件设置。

| 概念 | 作用 |
| -------------- | -------------------------------------------------- |
| 平台密钥 PK | 固件的信任根，决定谁能把密钥写进固件 |
| KEK / db / dbx | 签名者白名单与吊销名单，被信任的证书放在 db |
| Setup Mode | 固件允许写入自有密钥的状态，`enroll-keys` 的前提 |
| sbctl 自签 | 你生成密钥写进 db，再用它签引导器与内核 |
| shim | 微软签名的小引导器，转而信任 MOK 列表 |
| MOK | shim 信任的自有密钥列表，用 `mokutil` 在系统内维护 |

```bash
# 需在虚拟机中完成，已装好的系统
bootctl status # 看引导器与固件/ESP 状态
sbctl status # 看签名工具视角的 Setup Mode 与已签文件
mokutil --sb-state # 看 Secure Boot 当前是否启用（需 sudo pacman -S mokutil）
```

## 路线一：关闭 Secure Boot（本书主线）

开机按 Del/F2 进固件设置，在 Boot/Security 页把 Secure Boot 设为 Disabled。最简单、零维护，本书第 35–36 章的安装流程都以此为前提。

> **危险**：固件设置里的其他选项（CSM、TPM、Boot Order）改错可能让机器起不来。动手前拍照记录原值，一次只动 Secure Boot 一项，存盘退出后立即验证能进系统。

## 路线二：sbctl 自签

`sbctl create-keys` 在本地生成密钥，`sbctl enroll-keys` 会把公钥写入固件 `PK`/`KEK`/`db`。写固件是不可逆的系统级改动，先完成下面危险块中的检查与备份再执行。

> **危险**：`enroll-keys` 直接改写固件密钥库（PK/KEK/db），写错或中途断电可能导致机器无法启动。执行前必须：
> 1. 用 `sudo sbctl status` 确认 `Setup Mode: Enabled`，否则固件会拒绝写入；
> 2. 备份现状——`sudo efibootmgr -v > efibootmgr.bak`、`sudo sbctl status > sbctl-status.bak`，并拍照记录固件里「清除 PK / 恢复出厂密钥」入口的位置；
>
> 以下命令均需 root（示例中已写 `sudo`）。写入后若无法启动：进固件设置清除 PK 或恢复出厂密钥（厂商菜单名不同），再用 Live ISO 修复引导。部分厂商固件不允许写入自定义密钥，此时只能退回「关闭 Secure Boot」或 shim + MOK 路线（以 Wiki 与固件手册为准）。

```bash
# 需在虚拟机中完成，需 root
sudo pacman -S sbctl
sudo sbctl create-keys
sudo sbctl enroll-keys --microsoft # 写入自签密钥，同时保留微软 CA（见下方说明，以 Wiki 为准）
sudo sbctl status # 预期能看到密钥信息，且 Setup Mode 已变为 Disabled
```

写入完成后执行一次 `sudo sbctl status` 验证 `Setup Mode: Disabled` 且密钥已登记，再重启一次确认能进系统。

`--microsoft` 表示在登记自签密钥的同时保留固件 db 中的微软证书（Microsoft CA）。本手册保留它，是因为省略后带微软签名的固件 option ROM（部分显卡、网卡、阵列卡的扩展 ROM）不会被信任、无法启动，设备初始化可能卡在固件阶段。代价是安全边界相应放宽：固件不只信任你自签的密钥，也一并信任微软签发的第三方签名。可用性优先时保留 `--microsoft`；若追求最小信任面而去掉它，需接受上述兼容性风险。

签名启动链上的每个 EFI 二进制，`-s` 让文件登记在册、后续重签可一键完成：

```bash
sbctl sign -s /boot/vmlinuz-linux
sbctl sign -s /boot/EFI/systemd/systemd-bootx64.efi # 路径随引导器而变
sbctl sign -s /boot/EFI/BOOT/BOOTX64.EFI # fallback 入口也要签
sbctl verify # 预期每个文件都已签，无 NOT SIGNED
```

要点：

- `enroll-keys` 要在 Setup Mode 下做：Setup Mode 表示固件 `PK` 尚未注册（PK 为空或已被清除），不是「Secure Boot 已关闭」；只有此时才允许写入自有密钥。
- 内核升级会替换 `/boot/vmlinuz-linux`，旧签名随之失效。先确认 pacman hook 是否自动重签（`pacman -Ql sbctl | grep hook`），没有就升级后手动 `sbctl sign -s`。
- 换引导器、更新 `grubx64.efi`/`systemd-bootx64.efi` 同理，二进制一变就得重签。

## 路线三：shim + MOK

shim 是微软签名的小引导器，被固件信任后转而加载你注册进 MOK 的内核与引导器。典型流程：安装 shim（多为 AUR/自建形态）→ `mokutil --import <你的公钥.der>` → 重启进入固件自带的 MOK Manager 界面选 Enroll → 此后内核用 MOK 私钥签名。

这条路线不动固件密钥库，适合公司机器或无法进入固件设置的场景；代价是多一层 shim，且打包形态随版本变化较大，**流程细节以 Wiki 为准**。排障入口：

```bash
mokutil --list-enrolled # 需在虚拟机中完成，看 MOK 里已有哪些密钥
mokutil --list-new # 看待注册的密钥
```

## 与 mkinitcpio、引导器的联动

- systemd-boot 直接加载 `/vmlinuz-linux`，签这个文件即可；GRUB 路线先签 `grubx64.efi`，再由它加载内核（信任链多一跳）。
- 用 UKI 时（第 58 章提及），内核、initramfs、命令行合成单个 `.efi`，只签这一个文件。
- `mkinitcpio -P` 重建的是 initramfs 文件，不替换内核二进制，一般无需重签内核；但 initramfs 被打进 UKI 时，UKI 本身变了就要重签。

## 常见误区

- 「关闭 SB 就不安全了」：对学习机而言，关闭换来的是可控性；真正要防护的机器应走签名路线。
- 「签了内核就够了」：引导器先于内核执行，它不签照样被固件拦下。
- 「签名一次终身有效」：任何被签文件的字节变了，签名就失效——升级、换引导器、改 UKI 都算。
- 「Setup Mode 就是关闭 SB」：Setup Mode 是 `PK` 未注册/已清除、允许写入密钥的状态，与 Secure Boot 开关是两回事。

## 回退与救援

| 症状 | 可能原因 | 恢复 |
| ------------------------- | ------------------------- | -------------------------------------------------- |
| 固件报 Security Violation | 文件未签或签名失效 | 关闭 SB 进入系统后重签 |
| 升级后起不来 | 新内核未重签 | Live ISO 挂载根 + `arch-chroot` 后 `sbctl sign -s` |
| MOK 注册不生效 | MOK 未确认或密钥未登记 | `mokutil --list-new` 看待注册项，重启进 MokManager 完成 Enroll；`mokutil --list-enrolled` 核对结果。MOK 与 Setup Mode 无关 |
| 放弃签名路线 | — | 固件关闭 SB，密钥清理以 Wiki 为准 |

保留 fallback 启动项（第 58 章）与一份可启动的 Live ISO，是所有引导层改动的通用安全网；动手前先确认 `/etc/mkinitcpio.d/linux.preset` 已启用 fallback 且 `/boot` 里有对应的 fallback **镜像**（默认并不生成）。

## 失败模式

- **只签引导器不签内核**：固件信任了 `systemd-bootx64.efi`，下一跳加载未签内核仍会被拦；链上每一环都要签。
- **把 Setup Mode 当成「Secure Boot 已关闭」**：Setup Mode 是 `PK` 未注册、允许写入密钥的状态；Secure Boot 开关是另一件事。
- **没备份就 `enroll-keys`**：写固件密钥库不可逆，写错或断电可能让机器起不来；先记录 `efibootmgr -v`、`sbctl status` 与固件恢复入口。
- **忽略 `--microsoft` 的信任代价**：保留微软 CA 会让固件同时信任微软签发的第三方代码；去掉它则可能让带微软签名的扩展 ROM 无法初始化。取舍要写进维护记录。
- **内核升级后不重签**：`/boot/vmlinuz-linux` 被替换，旧签名失效；没有自动重签 hook 时必须手动 `sbctl sign -s`。
- **漏签 `EFI/BOOT/BOOTX64.EFI`**：fallback 入口未签，主入口失效时无法从它启动；fallback 与主入口都要覆盖。
- **MOK 导入后没在 MokManager 确认**：密钥只是「待注册」，重启时没完成 Enroll，签名仍不受信任。
- **固件不接受自定义密钥**：部分厂商固件锁定 PK；此时只能关闭 Secure Boot 或走 shim + MOK，不要反复尝试写入。

## 验证与回滚

签名与写固件都属于系统级改动，本章**未实测**；只读检查可以复现：

```bash
bootctl status
sbctl status
sbctl verify
mokutil --sb-state
mokutil --list-enrolled
efibootmgr -v
```

`sbctl status` 同时给出 Setup Mode 与密钥状态；`sbctl verify` 列出每个 EFI 二进制是否已签；`mokutil --list-enrolled` 核对 MOK 里已确认的密钥。回滚：签名路线出问题时，进固件关闭 Secure Boot 或清除 PK/恢复出厂密钥，再用 Live ISO 修复引导；MOK 路线可在 MokManager 删除已注册密钥。任何写操作前保留可启动的 Live ISO 与 fallback 入口，这是引导层改动的通用安全网。

## 取舍边界

- **关闭 Secure Boot vs sbctl 自签 vs shim + MOK**：学习机选关闭，零维护；自有机器能进固件选 sbctl；公司机器不能写固件密钥才用 shim + MOK。
- **`--microsoft` 保留 vs 去掉**：保留换取扩展 ROM 兼容性，放宽信任面；去掉缩小信任面，但可能卡在固件初始化。按硬件实际需求决定。
- **签独立内核 vs 签 UKI**：独立方案每次内核升级重签一个文件；UKI 只签一个 `.efi`，但每次重建 UKI 都要重签。
- **主入口 vs fallback 都签**：多签一个文件成本很低，却能保住备用启动路径；不要只签主入口。
- **自动化重签 vs 手动**：有 hook 时自动省事，但要验证 hook 真的覆盖了新文件；没有 hook 就把重签写进升级清单。

## 小结

- Secure Boot 校验引导器与内核的签名，链上任何一环不受信任就启动失败。
- 本书主线是关闭它；想开着就用 sbctl 自签；不便写固件密钥时用 shim + MOK。
- sbctl 路线的关键是 Setup Mode 下 `enroll-keys`，以及二进制更新后的重签。
- 引导层改动的通用安全网：fallback 启动项、Live ISO、固件原值拍照。

## 练习

1. 进入固件设置，记录 Secure Boot 当前状态与菜单路径后原样退出（需在虚拟机中完成；预期：能说出 Enabled/Disabled 与所在菜单）。
2. 在 VM 中执行 `sbctl create-keys` 与 `sbctl status`，解释 Setup Mode 两种状态各自的含义（需在虚拟机中完成；预期：`sbctl status` 输出密钥信息与 Setup Mode 状态）。
3. 用 `sbctl sign -s` 签名任意测试二进制并 `sbctl verify` 检查（需在虚拟机中完成；预期：verify 中该文件无 NOT SIGNED）。
4. 查 `pacman -Ql sbctl | grep hook`，判断你的系统是否会自动重签（预期：能列出 hook 路径或确认没有）。
5. 阅读题：解释为什么内核升级后需要重签，而 `mkinitcpio -P` 通常不需要。
6. 阅读题：对比 sbctl 与 shim+MOK 的信任根差异。

## 自检

- [ ] 能说出 Secure Boot 校验链上的每一跳
- [ ] 能在固件中安全地关闭 Secure Boot
- [ ] 能用 sbctl 完成签名并用 `sbctl verify` 验证
- [ ] 知道内核/引导器更新后何时需要重签
- [ ] 起不来时知道两级回退：关 SB、Live ISO 救援

## 参考

- [Unified Extensible Firmware Interface/Secure Boot](https://wiki.archlinux.org/title/Unified_Extensible_Firmware_Interface/Secure_Boot)
- [sbctl](https://wiki.archlinux.org/title/Sbctl)
- [Arch boot process](https://wiki.archlinux.org/title/Arch_boot_process)
