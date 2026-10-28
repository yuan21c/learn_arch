# 第 42 章 Secure Boot：签名、shim 与 MOK

第 20 章讲启动链时把 Secure Boot 留给了本章，第 41 章安装引导器默认假设它是关的。真机装完起不来，十有八九卡在这里：UEFI 固件只执行它信任的签名程序。本章给三条路线——关闭、sbctl 自签、shim + MOK——以及各自的回退方案。

> 本章目标：理解 Secure Boot 在启动链中的校验位置；能安全地关闭它；能用 sbctl 完成签名并处理内核升级后的重签；知道 shim/MOK 路线的适用场景与救援方法。
> 对应 Wiki：[Unified Extensible Firmware Interface/Secure Boot](https://wiki.archlinux.org/title/Unified_Extensible_Firmware_Interface/Secure_Boot)、[sbctl](https://wiki.archlinux.org/title/Sbctl)

## Secure Boot 校验的是什么链

固件在移交控制权之前会逐级校验签名：引导器 → 内核（或 UKI）→ 可执行的早期代码。链上任何一环没签名、或签名者不在固件信任名单里，启动就停住或直接跳回固件设置。

| 概念           | 作用                                               |
| -------------- | -------------------------------------------------- |
| 平台密钥 PK    | 固件的信任根，决定谁能把密钥写进固件               |
| KEK / db / dbx | 签名者白名单与吊销名单，被信任的证书放在 db        |
| Setup Mode     | 固件允许写入自有密钥的状态，`enroll-keys` 的前提   |
| sbctl 自签     | 你生成密钥写进 db，再用它签引导器与内核            |
| shim           | 微软签名的小引导器，转而信任 MOK 列表              |
| MOK            | shim 信任的自有密钥列表，用 `mokutil` 在系统内维护 |

```bash
# 环境：VM，已装好的系统
bootctl status        # 看引导器与固件/ESP 状态
sbctl status          # 看签名工具视角的 Setup Mode 与已签文件
mokutil --sb-state    # 看 Secure Boot 当前是否启用（需 mokutil）
```

## 路线一：关闭 Secure Boot（本书主线）

开机按 Del/F2 进固件设置（或 Windows 高级启动 → UEFI 固件设置），在 Boot/Security 页把 Secure Boot 设为 Disabled。最简单、零维护，本书第 41-45 章的安装流程都以此为前提。

> **危险**：固件设置里的其他选项（CSM、TPM、Boot Order）改错可能让机器起不来。动手前拍照记录原值，一次只动 Secure Boot 一项，存盘退出后立即验证能进系统。

## 路线二：sbctl 自签

```bash
# 环境：VM
pacman -S sbctl
sbctl create-keys
sbctl enroll-keys --microsoft   # 把自签密钥写入固件 db（保留微软 CA，以 Wiki 为准）
sbctl status                    # 预期能看到密钥信息与 Setup Mode 状态
```

签名启动链上的每个 EFI 二进制，`-s` 让文件登记在册、后续重签可一键完成：

```bash
sbctl sign -s /boot/vmlinuz-linux
sbctl sign -s /boot/EFI/systemd/systemd-bootx64.efi   # 路径随引导器而变
sbctl sign -s /boot/EFI/BOOT/BOOTX64.EFI              # fallback 入口也要签
sbctl verify                    # 预期每个文件都已签，无 NOT SIGNED
```

要点：

- `enroll-keys` 要在 Setup Mode 下做：固件未启用 SB、或 PK 尚未被厂商占用时才可写入。
- 内核升级会替换 `/boot/vmlinuz-linux`，旧签名随之失效。先确认 pacman hook 是否自动重签（`pacman -Ql sbctl | grep hook`），没有就升级后手动 `sbctl sign -s`。
- 换引导器、更新 `grubx64.efi`/`systemd-bootx64.efi` 同理，二进制一变就得重签。

## 路线三：shim + MOK

shim 是微软签名的小引导器，被固件信任后转而加载你注册进 MOK 的内核与引导器。典型流程：安装 shim（多为 AUR/自建形态）→ `mokutil --import <你的公钥.der>` → 重启进入固件自带的 MOK Manager 界面选 Enroll → 此后内核用 MOK 私钥签名。

这条路线不动固件密钥库，适合公司机器或无法进入固件设置的场景；代价是多一层 shim，且打包形态随版本变化较大，**流程细节以 Wiki 为准**。排障入口：

```bash
mokutil --list-enrolled    # 环境：VM，看 MOK 里已有哪些密钥
mokutil --list-new         # 看待注册的密钥
```

## 与 mkinitcpio、引导器的联动

- systemd-boot 直接加载 `/vmlinuz-linux`，签这个文件即可；GRUB 路线先签 `grubx64.efi`，再由它加载内核（信任链多一跳）。
- 用 UKI 时（第 41 章提及），内核、initramfs、命令行合成单个 `.efi`，只签这一个文件。
- `mkinitcpio -P` 重建的是 initramfs 文件，不替换内核二进制，一般无需重签内核；但 initramfs 被打进 UKI 时，UKI 本身变了就要重签。

## 常见误区

- 「关闭 SB 就不安全了」：对学习机而言，关闭换来的是可控性；真正要防护的机器应走签名路线。
- 「签了内核就够了」：引导器先于内核执行，它不签照样被固件拦下。
- 「签名一次终身有效」：任何被签文件的字节变了，签名就失效——升级、换引导器、改 UKI 都算。
- 「Setup Mode 就是关闭 SB」：Setup Mode 只是允许写入密钥的状态，两者是不同开关。

## 回退与救援

| 症状                      | 可能原因                  | 恢复                                               |
| ------------------------- | ------------------------- | -------------------------------------------------- |
| 固件报 Security Violation | 文件未签或签名失效        | 关闭 SB 进入系统后重签                             |
| 升级后起不来              | 新内核未重签              | Live ISO 挂载根 + `arch-chroot` 后 `sbctl sign -s` |
| MOK 注册不生效            | Setup Mode/注册流程没走完 | `mokutil --list-enrolled` 核对；必要时先关闭 SB    |
| 放弃签名路线              | —                         | 固件关闭 SB，密钥清理以 Wiki 为准                  |

保留 fallback 启动项（第 41 章）与一份可启动的 Live ISO，是所有引导层改动的通用安全网；动手前先确认 `ls /boot` 里有可用的 fallback 内核。

## 小结

- Secure Boot 校验引导器与内核的签名，链上任何一环不受信任就启动失败。
- 本书主线是关闭它；想开着就用 sbctl 自签；不便写固件密钥时用 shim + MOK。
- sbctl 路线的关键是 Setup Mode 下 `enroll-keys`，以及二进制更新后的重签。
- 引导层改动的通用安全网：fallback 启动项、Live ISO、固件原值拍照。

## 练习

1. 进入固件设置，记录 Secure Boot 当前状态与菜单路径后原样退出（环境：VM；预期：能说出 Enabled/Disabled 与所在菜单）。
2. 在 VM 中执行 `sbctl create-keys` 与 `sbctl status`，解释 Setup Mode 两种状态各自的含义（环境：VM；预期：`sbctl status` 输出密钥信息与 Setup Mode 状态）。
3. 用 `sbctl sign -s` 签名任意测试二进制并 `sbctl verify` 检查（环境：VM；预期：verify 中该文件无 NOT SIGNED）。
4. 查 `pacman -Ql sbctl | grep hook`，判断你的系统是否会自动重签（环境：WSL 或 VM；预期：能列出 hook 路径或确认没有）。
5. 阅读题：解释为什么内核升级后需要重签，而 `mkinitcpio -P` 通常不需要（环境：阅读题）。
6. 阅读题：对比 sbctl 与 shim+MOK 的信任根差异（环境：阅读题）。

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
