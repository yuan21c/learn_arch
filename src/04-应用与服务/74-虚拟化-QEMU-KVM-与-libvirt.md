# 第 74 章 虚拟化：QEMU、KVM 与 libvirt

容器共享宿主内核（第 71 章），虚拟机则各自跑一个内核。这一章讲三层：QEMU 提供设备模型、KVM 提供硬件加速、libvirt 提供统一管理。还会落到两个高风险话题：UEFI/OVMF 启动与 PCI 直通。直通能把整块 GPU 交给虚拟机，也能让宿主当场失去显示输出——所以操作前先想清楚回滚。

> 本章目标：能判断本机是否具备 KVM 条件（CPU 虚拟化、`/dev/kvm`、模块）；能用 `qemu-img` 创建/检查镜像并用 `qemu-system-x86_64` 启动；能用 `virt-install --print-xml` 生成域 XML、`virsh` 管理生命周期与快照；理解 UEFI/OVMF 的作用；知道 PCI 直通的 IOMMU、vfio-pci、IOMMU group 三个前提与「宿主失去设备」的代价；能识别「无 `/dev/kvm`」「直通绑走宿主 GPU」「快照当备份」三类问题。
> 对应 Wiki：[QEMU](https://wiki.archlinux.org/title/QEMU)、[KVM](https://wiki.archlinux.org/title/KVM)、[Libvirt](https://wiki.archlinux.org/title/Libvirt)、[PCI_passthrough_via_OVMF](https://wiki.archlinux.org/title/PCI_passthrough_via_OVMF)、[Intel_GVT-g](https://wiki.archlinux.org/title/Intel_GVT-g)

## 三层分工：QEMU、KVM、libvirt

| 层 | 作用 | 关键点 |
| ---------- | ---------------------------------------- | ------------------------------------------ |
| QEMU | 模拟 CPU 外设、磁盘、网卡，启动客体 | 纯软件模拟（TCG）慢；配 KVM 后接近原生 |
| KVM | 利用 CPU 虚拟化扩展执行客体代码 | 需要 VT-x/AMD-V 与 `/dev/kvm` |
| libvirt | 统一管理域、网络、存储池，屏蔽 QEMU 参数 | XML 描述域；`virsh`/`virt-install` 操作 |

先确认硬件与内核条件（只读）：

```bash
lscpu | grep -i virtualization
ls -l /dev/kvm
lsmod | grep -E '^kvm'
qemu-system-x86_64 -accel help
```

`-accel help` 列出可用加速器；有 `kvm` 才谈性能。若 `/dev/kvm` 不存在：BIOS/UEFI 里没开虚拟化、`kvm` 模块没加载，或你本身就在虚拟机里且宿主没开嵌套。

## QEMU：镜像与启动参数

```bash
sudo pacman -S qemu-full
qemu-img create -f qcow2 /tmp/lab.qcow2 512M
qemu-img info /tmp/lab.qcow2
qemu-img check /tmp/lab.qcow2
```

qcow2 是稀疏文件，按需增长，支持快照与 backing file；raw 性能略好但不支持快照。启动一个带安装介质的客体：

```bash
qemu-system-x86_64 \
  -accel kvm -cpu host -m 2048 -smp 2 \
  -drive file=/tmp/lab.qcow2,if=virtio \
  -cdrom /path/to/archlinux.iso \
  -netdev user,id=net0 -device virtio-net-pci,netdev=net0 \
  -nographic
```

- `-accel kvm` 用硬件加速；没有 KVM 时去掉它退化为 TCG，能跑但很慢。
- `-cpu host` 把宿主 CPU 特性透传给客体；迁移到不同 CPU 的宿主时改用具体模型。
- `if=virtio` 是半虚拟化磁盘，性能最好；客体缺 virtio 驱动时会「看不到硬盘」。
- `-netdev user` 是最简单的 NAT，默认无入站；需要被外部访问时加 `hostfwd` 或改用桥接。

## libvirt：把参数变成可管理的域

`virt-install --print-xml` 只生成 XML，不创建域，适合先审阅：

```bash
sudo pacman -S libvirt virt-install
sudo systemctl enable --now libvirtd
virt-install --name lab --memory 1024 --vcpus 1 \
  --disk /tmp/lab.qcow2 --cdrom /path/to/archlinux.iso \
  --network network=default --print-xml > /tmp/lab.xml
virsh define /tmp/lab.xml
virsh list --all
virsh dumpxml lab | head -40
```

常用生命周期与快照：

```bash
virsh start lab
virsh domstate lab
virsh shutdown lab
virsh snapshot-create-as lab snap1 "before-upgrade"
virsh snapshot-list lab
virsh snapshot-revert lab snap1
virsh undefine lab --remove-all-storage
```

libvirt 的默认网络是 NAT；`virsh net-list --all` 若显示 `default` 未激活，先 `virsh net-start default` 并 `virsh net-autostart default`。存储池同理，`virsh pool-list --all` 看路径与权限。

## UEFI/OVMF 与 PCI 直通

**UEFI/OVMF**：客体要 UEFI 启动时，用 OVMF 固件（`edk2-ovmf`），把代码与变量分别挂成两块 pflash：

```bash
sudo pacman -S edk2-ovmf
ls /usr/share/edk2/x64/OVMF_CODE.fd /usr/share/edk2/x64/OVMF_VARS.fd
```

变量文件要复制一份给每个域用，不能多个域共享同一份 `VARS`，否则 NVRAM 互相覆盖。Secure Boot 的密钥与签名链已在第 61 章讲过，这里不重复。

**PCI 直通**三个前提：

1. **IOMMU 开启**：内核参数加 `intel_iommu=on iommu=pt`（AMD 用 `amd_iommu=on`），重启后 `dmesg | grep -e DMAR -e IOMMU` 应有输出。
2. **设备在独立 IOMMU group**：`ls /sys/kernel/iommu_groups/` 查看；group 里若混着其他关键设备，不能单独直通。
3. **绑定 vfio-pci**：用 `vfio-pci` 的 `ids=` 或 `driver_override` 把设备从宿主驱动摘走，再在域 XML 里加 `<hostdev>`。

```bash
lspci -nnk | grep -A3 -i 'vga\|3d'
virsh nodedev-list --cap pci | grep 0000_01
virsh nodedev-detach pci_0000_01_00_0
virsh nodedev-reattach pci_0000_01_00_0
```

**代价要说清**：把宿主唯一的 GPU 直通给客体，宿主会失去显示输出；没有第二块显卡/核显时，只能靠 SSH 或串口管理。`virsh nodedev-detach` 之后宿主驱动被摘走，回滚要 `reattach` 或重启。Intel GVT-g 这类 mediated device 已被上游标记为弃用，优先考虑 SR-IOV 或整卡直通。

## 失败模式

- **`-accel kvm` 报无权限/无法打开 `/dev/kvm`**：用户不在 `kvm` 组、模块未加载，或宿主 BIOS 未开虚拟化。
- **客体启动后找不到硬盘**：`if=virtio` 但客体没有 virtio 驱动；换 `if=ide`/`if=scsi` 验证，或装驱动。
- **libvirt 域起不来，日志只说 permission denied**：存储池目录属主、SELinux/AppArmor 标签、镜像文件权限；`virsh domstate` 之外看 `/var/log/libvirt/qemu/lab.log`。
- **默认网络不可用**：`default` 网络没启动或没设 autostart；`virsh net-list --all` 确认。
- **OVMF 启动失败**：`VARS` 文件不可写或被多个域共享；每个域复制一份并设正确权限。
- **直通后宿主黑屏/驱动报错**：把宿主正在用的 GPU 绑给了 vfio；直通前确认有第二套显示或远程管理通道。
- **IOMMU group 不独立**：同组设备被一起摘走，宿主其他功能受影响；换插槽/主板或使用 ACS 覆盖（有风险）。
- **快照链过长、磁盘爆满**：qcow2 快照是增量，链越长越慢；定期合并，别把快照当长期备份。
- **嵌套虚拟化性能差或失败**：宿主未开 `nested=1`；`cat /sys/module/kvm_intel/parameters/nested` 确认。
- **`virsh undefine` 以为删了数据**：默认只删域定义，磁盘还在；要删卷用 `--remove-all-storage`，且先确认卷名。

## 验证与回滚

镜像与域的健康检查各有命令：

```bash
qemu-img info /tmp/lab.qcow2
qemu-img check /tmp/lab.qcow2
virsh domstate lab
virsh dominfo lab
virsh domblklist lab
virsh snapshot-list lab
virsh pool-list --all
```

回滚分三类：

- **域配置改坏**：`virsh dumpxml lab > /tmp/lab.xml.bak`，改坏后 `virsh define /tmp/lab.xml.bak`；或 `virsh snapshot-revert` 回到改动前快照。
- **磁盘写坏**：`qemu-img check` 先判断，能从备份恢复就不要在损坏链上继续写；qcow2 快照可回退，但它不是异地备份。
- **直通绑走宿主设备**：`virsh nodedev-reattach pci_0000_01_00_0` 尝试归还；不成功则去掉 `vfio-pci.ids` 内核参数并重启。**这一步必须在有控制台/SSH 的前提下做**。

本机可实测的安全路径：只做 `qemu-img create/info/check`、`virt-install --print-xml`、`virsh define/dumpxml/undefine`，不启动域、不碰直通。启动客体需要 ISO 与资源，直通需要重启与第二套显示通道——两者在本验收环境均**未实测**。

## 取舍边界

- **QEMU CLI vs libvirt**：临时实验、单次启动用 CLI 直观；长期管理、快照、网络、远程访问用 libvirt。libvirt 的 XML 最终也是翻译成 QEMU 参数。
- **KVM vs TCG**：有硬件虚拟化就用 KVM；没有时 TCG 能跑但慢，适合验证流程而非日常使用。
- **直通 vs virtio**：直通给客体近乎原生的设备性能，但牺牲宿主设备与灵活性；多数场景 virtio 磁盘/网卡已足够。
- **整卡直通 vs SR-IOV/GVT-g**：整卡简单、兼容性好，但一台客体独占；SR-IOV 能切分虚拟功能，前提是硬件支持；GVT-g 已弃用，不再作为新方案。
- **qcow2 vs raw**：qcow2 省空间、支持快照；raw 简单、性能略好、便于迁移到其他平台。按是否需要快照选。
- **快照 vs 备份**：快照解决「快速回退」，备份解决「磁盘/主机全损」；两者不能互相替代，快照要和备份一起做。
- **桌面 VM vs 服务器 VM**：桌面要 GPU/音频/USB，直通与延迟更敏感；服务器要稳定与远程管理，virtio + 桥接更合适。

## 小结

- QEMU 模拟设备、KVM 提供加速、libvirt 提供管理；三层分开看，排障才有方向。
- 先确认 CPU 虚拟化、`/dev/kvm`、`kvm` 模块，再谈启动参数。
- qcow2 支持快照与稀疏增长；`qemu-img check` 是磁盘健康的第一道检查。
- `virt-install --print-xml` 适合先审阅再 `virsh define`；`virsh` 管生命周期、网络、存储池与快照。
- OVMF 的 `VARS` 每域一份；PCI 直通要 IOMMU、独立 group、vfio-pci 三件事齐备。
- 直通会夺走宿主设备；没有第二套显示/远程通道就不要在主力机上试。
- 快照不是备份；直通与启动操作在本机验收环境未实测。

## 练习

1. 条件检查：跑 `lscpu | grep -i virtualization`、`ls -l /dev/kvm`、`qemu-system-x86_64 -accel help`，记录本机是否支持 KVM。
2. 镜像练习：`qemu-img create -f qcow2 /tmp/lab.qcow2 512M`，用 `qemu-img info` 看格式/虚拟大小，再用 `qemu-img check` 验证；尝试 `qemu-img resize` 后复查。
3. 域 XML：用 `virt-install --print-xml` 生成一份 XML，`virsh define` 后 `dumpxml` 对比，再 `undefine`；全程不启动。
4. 网络与存储池：`virsh net-list --all`、`virsh pool-list --all`，说明默认 NAT 与存储池路径；未激活时如何启动与设自启。
5. 直通推演：给出一块独显直通的三步准备与两条回滚路径；说明为什么必须保留 SSH/串口通道（不实际执行）。
6. 快照与备份：为一个域创建快照、改一个文件、回退；再说明「主机磁盘损坏」时快照为什么救不了。

## 自检

- [ ] 能说出 QEMU、KVM、libvirt 各负责什么
- [ ] 会判断本机是否具备 KVM 条件（CPU、`/dev/kvm`、模块）
- [ ] 会用 `qemu-img` 创建、查看、检查镜像
- [ ] 能用 `virt-install --print-xml` + `virsh define` 管理域
- [ ] 理解 OVMF 的 CODE/VARS 分工，知道 VARS 不能共享
- [ ] 能列出 PCI 直通的三个前提与「宿主失去设备」的代价
- [ ] 知道快照不是备份，且直通/启动在本机未实测

## 参考

- [QEMU](https://wiki.archlinux.org/title/QEMU)
- [KVM](https://wiki.archlinux.org/title/KVM)
- [Libvirt](https://wiki.archlinux.org/title/Libvirt)
- [PCI passthrough via OVMF](https://wiki.archlinux.org/title/PCI_passthrough_via_OVMF)
- [Intel GVT-g](https://wiki.archlinux.org/title/Intel_GVT-g)
