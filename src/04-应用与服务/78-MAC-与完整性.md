# 第 78 章 MAC 与完整性

第 76 章讲的是「谁能登录、哪个端口开」；本章讲的是「即使拿到 root，能改什么、改了能不能被发现」。前者是访问控制，后者是强制访问控制（MAC）与完整性。两条线各有工具：AppArmor/SELinux/TOMOYO 限制程序能碰哪些路径或标签；dm-verity/dm-integrity/IMA/TPM 负责「内容是否被篡改」。最后补上验证这些机制的工具：nmap、Wireshark、ClamAV、USBGuard 与核心转储。

> 本章目标：能区分 DAC 与 MAC，并说出 AppArmor、SELinux、TOMOYO 的模型差异；会查看/切换 AppArmor profile 状态并用日志定位拒绝；理解 dm-verity（只读哈希树）与 dm-integrity（可写校验）的差别；知道 IMA/EVM、TPM 度量与 Secure Boot 各自解决什么；会用 USBGuard 做设备白名单；能用 nmap/Wireshark/ClamAV 在自己的实验环境做验证；能识别「profile 拒绝导致应用故障」「USBGuard 锁死键鼠」「核心转储泄密」三类问题。
> 对应 Wiki：[AppArmor](https://wiki.archlinux.org/title/AppArmor)、[SELinux](https://wiki.archlinux.org/title/SELinux)、[TOMOYO](https://wiki.archlinux.org/title/TOMOYO)、[USBGuard](https://wiki.archlinux.org/title/USBGuard)、[ClamAV](https://wiki.archlinux.org/title/ClamAV)、[Wireshark](https://wiki.archlinux.org/title/Wireshark)

## DAC 与 MAC：从「属主说了算」到「策略说了算」

传统 Unix 权限是 DAC（自主访问控制）：文件属主可以 `chmod`/`chown`，root 几乎不受限制。MAC 在其上再加一层策略：**即使 root，也要符合策略**。三种实现：

| 机制 | 模型 | 策略写在哪 | 典型场景 |
| ---------- | ------------------------------ | -------------------------- | ------------------------------ |
| AppArmor | 按路径（path-based） | `/etc/apparmor.d/` | 单机、桌面、服务收窄 |
| SELinux | 按标签（label-based） | 策略库 + 文件上下文 | 企业发行版、精细多类隔离 |
| TOMOYO | 按路径/域名 | 策略文件 | 嵌入式、特定发行版 |

Arch 官方内核**已经编译了 SELinux 支持**（`CONFIG_SECURITY_SELINUX=y`，可用 `zgrep CONFIG_SECURITY_SELINUX /proc/config.gz` 核对），只是默认没有启用。完整启用需要三件事齐全：安装 SELinux 用户空间与策略、在内核命令行加 `lsm=`（保留现有 LSM 的前提下追加 `selinux`，以当前 `lsm=` 值为准）、重新生成 initramfs/引导项，并确保文件系统支持 xattr。缺任何一项都表现为「装了但 `sestatus` 说没启用」。普通 Arch 用户通常选 AppArmor，省事得多。**不要同时按两套教程混配**，先确认当前内核命令行里的 `lsm=` 与 `aa-status`/`sestatus` 的实际输出。

## AppArmor：profile、状态与日志

```bash
sudo pacman -S apparmor
sudo systemctl enable --now apparmor
sudo aa-status
sudo journalctl -k -b | grep -i apparmor | tail -20
```

`aa-status` 显示已加载 profile 数与处于 enforce/complain 的数量。给一个程序套 profile 的基本流程：

```bash
sudo aa-complain /etc/apparmor.d/usr.bin.myapp
sudo apparmor_parser -r /etc/apparmor.d/usr.bin.myapp
sudo aa-logprof
```

`complain` 只记录不阻止，适合先观察；`aa-logprof` 根据拒绝日志生成规则；确认无误后 `aa-enforce`。内核日志里的 `apparmor="DENIED"` 会写明 `profile=`、`operation=`、`requested_mask=`，照着补路径或能力。

## SELinux 与 TOMOYO 的边界

- **SELinux**：每个进程与文件带 `user:role:type:level` 标签，策略决定「哪个 type 能读哪个 type」。常用命令：`sestatus`、`ls -Z`、`restorecon -Rv /path`、`setenforce 0`（临时宽容）、`audit2why`。文件被 `cp`/`mv` 改标签后服务起不来，`restorecon` 往往能救。
- **TOMOYO**：按路径与执行域名做限制，配置比 SELinux 轻，但生态小；Arch 不作为默认方案。
- **选型**：要成熟的企业策略与审计链 → SELinux；要低门槛的单机收窄 → AppArmor；已有 TOMOYO 的嵌入式环境才继续用它。

## 完整性：dm-verity、dm-integrity、IMA

| 机制 | 保护对象 | 可写 | 信任根 | 典型用途 |
| ------------- | ------------------------------ | ------ | ------------------------ | ------------------------------ |
| dm-verity | 只读块设备的每个块 | 否 | 内核命令行/initramfs 的根哈希 | 系统镜像、容器基础镜像 |
| dm-integrity | 块设备每扇区校验 + 日志 | 是 | 密钥（可选） | 需要防静默损坏的可写卷 |
| IMA/EVM | 文件哈希/元数据 | 是 | 策略 + TPM/密钥 | 文件级度量与评估 |
| TPM | 启动度量（PCR）与密钥封装 | — | 硬件 | 度量启动、密封密钥 |
| Secure Boot | 引导链签名 | — | 固件密钥库 | 阻止未签名引导（第 61 章） |

**dm-verity** 建一棵哈希树，读块时逐级校验；任何一块被改，读取即失败。根哈希必须通过可信渠道传给内核，否则攻击者可以连哈希树一起换。**dm-integrity** 给可写卷加每扇区校验与日志，防的是静默损坏与部分篡改，不是保密。**IMA/EVM** 在文件层做度量/评估，通常与 TPM 配合；它需要内核配置与策略，默认未启用。

用文件演练 verity（写入 `/tmp`，不碰真实块设备）：

```bash
sudo pacman -S cryptsetup
truncate -s 16M /tmp/vdata.img
truncate -s 16M /tmp/vhash.img
veritysetup format /tmp/vdata.img /tmp/vhash.img | tee /tmp/verity.txt
grep 'Root hash' /tmp/verity.txt
veritysetup verify /tmp/vdata.img /tmp/vhash.img "$(grep 'Root hash' /tmp/verity.txt | awk '{print $NF}')"
```

`format` 输出根哈希，`verify` 用根哈希校验整棵哈希树。**本书验证环境实测：cryptsetup 2.8.8 可直接对两个普通文件执行 `format`/`verify`，无需 loop 设备**；若你的版本要求块设备，再用 `losetup` 绑定。把数据文件改一个字节再 `verify`，会看到 `Verification failed at position 0`——这就是「篡改可发现」。

## 设备、恶意软件与流量验证

- **USBGuard**：设备白名单，防「插一个恶意 USB」。**默认全拒绝**：规则文件里没有的设备一律被 block，所以启用顺序错了会当场失去键盘鼠标。
  **动手前必读**：先准备第二个输入通道——同一局域网的 SSH 会话，或另一把有线键盘/串口控制台；并确认 `/etc/usbguard/rules.conf` 里当前键鼠都带 `allow`。若启动后发现键鼠失灵，在另一终端执行 `sudo systemctl stop usbguard` 即可恢复，再回来修规则。

  ```bash
  sudo pacman -S usbguard
  sudo usbguard generate-policy > /tmp/usb.rules # ① 生成当前设备策略
  grep -Ei 'keyboard|mouse|kbd|hid' /tmp/usb.rules # ② 审阅：当前键鼠必须在 allow 列表里
  sudo usbguard list-devices # ③ 对照每个设备的设备名与状态
  sudo install -m 0600 -o root -g root /tmp/usb.rules /etc/usbguard/rules.conf # ④ 规则落盘
  sudo systemctl start usbguard # ⑤ 先 start，不动键盘鼠标试一试
  sudo usbguard list-devices | grep -i blocked # ⑥ 预期：当前键鼠不在 blocked 列表
  sudo systemctl enable usbguard # ⑦ 确认键鼠可用后再设开机自启
  ```

  不要用 `enable --now` 一步到位：它在规则尚未安装时就会启动守护进程，默认拒绝策略会立刻封锁当前输入设备。若 `generate-policy` 的输出里没有键盘（远程或纯串口机器常见），先手工加一条 `allow` 规则再继续。
- **ClamAV**：恶意软件扫描，靠签名库；`sudo freshclam` 更新，`clamscan -r /tmp` 扫描。它不是 EDR，不能替代行为监控。
- **nmap**：从外部视角看自己开了哪些端口。只对自有主机使用：
  ```bash
  nmap -sT -p- 127.0.0.1
  ```
  `-sT` 是 TCP connect，普通用户可跑；`-sS` 需要 root。扫描第三方网络可能违法，先确认授权。
- **Wireshark/tshark**：抓包看实际流量。`sudo tshark -i lo -c 20` 或把用户加入 `wireshark` 组；抓包文件可能含凭据，按敏感数据保管。
- **Metasploit**：漏洞验证框架，只能在自有实验环境用；对生产或第三方系统使用属违法/破坏行为，本章不提供攻击步骤。
- **CrowdSec**：行为型 IDS/IPS，和 fail2ban 类似但共享信号；`cscli decisions list` 看决策。它属于第 79 章的响应话题，这里只作工具定位。
- **核心转储**：`coredumpctl list`/`coredumpctl info` 能看崩溃现场，但转储里可能有密钥、令牌；不需要时把 `Storage=` 设为 `none` 或限制保留，别让 `/var/lib/systemd/coredump` 成为泄密点。

## 失败模式

- **AppArmor profile 一上就拒写**：应用需要写日志/缓存目录，profile 没放行；先 `aa-complain` 观察，再按 `DENIED` 日志补规则。
- **`aa-status` 显示 0 个 profile**：服务没启用、内核 `lsm=` 没包含 apparmor，或 profile 没加载；三者逐一确认。
- **SELinux 改标签后服务起不来**：`cp`/`mv` 保留或改变了上下文；`restorecon -Rv` 恢复，别急 `setenforce 0` 掩盖问题。
- **dm-verity 更新后无法挂载**：根哈希没随镜像更新，或哈希树与数据不匹配；根哈希必须走签名/可信更新流程。
- **把 dm-integrity 当加密**：它只校验完整性，不保密；保密要用加密层（第 22 章）。
- **IMA 策略过严**：未签名/未度量的程序被拒；先在 `audit` 模式观察，再切 `enforce`。
- **TPM PCR 变化后密钥解不开**：固件/引导更新改变了度量值；密封策略要考虑 PCR 变化，保留恢复路径。
- **USBGuard 锁死键鼠**：白名单没包含当前 HID；启用前保留一个已授权设备或 SSH 通道，锁死后在另一终端 `sudo systemctl stop usbguard` 恢复。
- **ClamAV 签名过期**：`freshclam` 失败后仍在扫，给人「已检查」的错觉。
- **nmap/Wireshark 越界**：扫描/抓包第三方网络或未授权系统，法律与职业风险都高。
- **核心转储泄密**：崩溃文件里带密钥/令牌，却被长期保留或打包上传。

## 验证与回滚

机制是否生效，一律看实际状态：

```bash
sudo aa-status
sudo journalctl -k -b | grep -i 'apparmor="DENIED"' | tail -5
sestatus 2>/dev/null || echo "未启用 SELinux"
ls -Z /etc/ssh/sshd_config 2>/dev/null
sudo veritysetup verify /tmp/vdata.img /tmp/vhash.img "<root-hash>"
sudo usbguard list-devices
clamscan -r /tmp | tail -5
nmap -sT -p 22,80,443 127.0.0.1
```

回滚路径：

- **AppArmor**：`sudo aa-complain <profile>` 临时只记录；确认规则后 `aa-enforce`；彻底移除用 `apparmor_parser -R <profile>`。
- **SELinux**：`restorecon -Rv` 修标签；临时 `setenforce 0` 只用于定位，不要长期宽容。
- **dm-verity/integrity**：移除映射需要 root 与重启；验证阶段只用 `/tmp` 文件，失败就删除两个镜像重来。
- **USBGuard**：锁死时在另一个终端 `sudo systemctl stop usbguard`（这一步不需要键鼠）；把缺的设备补进 `/etc/usbguard/rules.conf` 后再 `systemctl start usbguard`，确认可用才 `enable`。
- **IMA/TPM**：策略改回 `audit` 或移除策略；PCR 变化导致的解封失败需要回到原引导状态或更新密封策略。
- **核心转储**：改 `Storage=` 后 `systemctl restart systemd-coredump`，并清理已有转储。

## 取舍边界

- **AppArmor vs SELinux**：路径模型易读、上手快 → AppArmor；标签模型精细、适合多租户/企业 → SELinux。两者都不是「开了就安全」，策略质量决定效果。
- **MAC vs DAC**：DAC 决定「谁能改权限」，MAC 决定「即使有权限也不能做什么」；先做好 DAC（账号、sudo、权限），再上 MAC。
- **dm-verity vs dm-integrity**：只读镜像防篡改 → verity；可写卷防静默损坏 → integrity；需要保密 → 加密层。
- **IMA vs dm-verity**：块级只读校验 → verity；文件级度量/评估 → IMA；两者可叠加，但复杂度也叠加。
- **TPM 度量 vs Secure Boot**：Secure Boot 管「谁被允许引导」，TPM 度量记录「实际引导了什么」；前者是门禁，后者是证据。
- **USBGuard 严格度**：白名单最安全但维护成本高；至少允许当前键鼠与常用存储，并把「新增设备」当成需要审阅的事件。
- **ClamAV vs EDR**：签名扫描对已知恶意文件有效；行为型检测与响应靠 CrowdSec/EDR/审计（第 79 章）。
- **安全工具的合法性**：nmap/Wireshark/Metasploit 只在自有或获授权的环境使用；技术能力不等于授权。

## 小结

- DAC 是属主说了算，MAC 是策略说了算；AppArmor 按路径、SELinux 按标签、TOMOYO 按路径/域名。
- AppArmor 先 complain 观察、再 enforce；`aa-status` 与 `DENIED` 日志是事实来源。
- dm-verity 防只读镜像篡改，dm-integrity 防可写卷静默损坏，IMA/EVM 做文件级度量，TPM 记录引导度量。
- Secure Boot 管引导准入，TPM 管度量证据；两者不能互相替代。
- USBGuard 防恶意 USB，但必须先放行键鼠；ClamAV 靠签名，nmap/Wireshark 只在授权环境用。
- 核心转储可能泄密；不需要就关掉或限制保留。
- 所有 MAC/完整性机制都要有「临时宽容 → 观察 → 收紧」的回滚路径。

## 练习

1. 状态检查：跑 `aa-status`、`journalctl -k | grep -i apparmor`，判断本机 AppArmor 是否启用、加载了多少 profile。
2. profile 演练（可选）：对一个自建小程序用 `aa-complain` 观察拒绝日志，再用 `aa-logprof` 生成规则；不实际改系统 profile 时，记录「会补哪些路径」。
3. verity 实验：按正文用两个 `/tmp` 文件 `format` + `verify`，改一个字节后再 verify，记录失败信息；清理文件。
4. 设备白名单：`usbguard generate-policy` 生成规则，检查是否包含当前键鼠；说明为什么不能直接启用空规则。
5. 端口视角：用 `nmap -sT -p- 127.0.0.1` 扫本机，和 `ss -tulpn` 对比，解释差异（哪些端口只绑回环、哪些服务未监听）。
6. 抓包与隐私：用 `tshark -i lo -c 10` 抓本机回环流量，说明抓包文件的敏感性与保管要求。
7. 转储检查：`coredumpctl list` 看是否有转储；说明如何关闭或限制保留。

## 自检

- [ ] 能区分 DAC 与 MAC，并说出三种 MAC 的模型差异
- [ ] 会看 `aa-status` 与 `DENIED` 日志，能用 complain/enforce 切换
- [ ] 理解 dm-verity 与 dm-integrity 的保护目标差异
- [ ] 知道 IMA/EVM、TPM 度量、Secure Boot 各自解决什么
- [ ] 会用 USBGuard 生成白名单，并知道先放行键鼠
- [ ] 能说清 nmap/Wireshark/ClamAV 的适用与合法性边界
- [ ] 知道核心转储可能泄密，并会限制保留
- [ ] 每种机制都能说出验证命令与回滚路径

## 参考

- [AppArmor](https://wiki.archlinux.org/title/AppArmor)
- [SELinux](https://wiki.archlinux.org/title/SELinux)
- [TOMOYO](https://wiki.archlinux.org/title/TOMOYO)
- [USBGuard](https://wiki.archlinux.org/title/USBGuard)
- [ClamAV](https://wiki.archlinux.org/title/ClamAV)
- [Wireshark](https://wiki.archlinux.org/title/Wireshark)
