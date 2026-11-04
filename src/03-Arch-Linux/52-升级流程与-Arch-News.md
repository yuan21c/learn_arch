# 第 52 章 升级流程与 Arch News

Arch 是滚动发行版，升级不是「偶尔执行一次」的动作，而是一套有前置检查、有输出阅读、有升级后验证的流程。跳过其中任何一步，都可能把一次普通更新变成部分升级。

> 本章目标：能按固定流程完成一次安全升级，读懂 pacman 的关键输出，并正确处理 `.pacnew` 与升级后的 AUR 重建。
> 对应 Wiki：[System maintenance](https://wiki.archlinux.org/title/System_maintenance)、[Arch News](https://archlinux.org/news/)、[Pacman#Pacnew and Pacsave files](https://wiki.archlinux.org/title/Pacman#Pacnew_and_Pacsave_files)

## 升级前：先看、再备份、后执行

升级前的检查应形成习惯，而不是凭记忆。

| 检查项 | 命令 | 目的 |
| -------- | -------------------------------------------------------- | ------------------------ |
| 阅读新闻 | 打开 <https://archlinux.org/news/> 或订阅 RSS | 发现需要手动干预的更新 |
| 备份 | 虚拟机快照，或 `tar`/`rsync` 文件级备份 | 保留可回滚状态 |
| 磁盘空间 | `df -h /`、`df -i /` | 避免事务中途写满 |
| 缓存体积 | `du -sh /var/cache/pacman/pkg` | 预留下载与解包空间 |
| 待升级包 | `checkupdates` 或 `pacman -Qu` | 了解更新范围 |
| 忽略规则 | 检查 `/etc/pacman.conf` 中的 `IgnorePkg` / `IgnoreGroup` | 防止长期压包导致部分升级 |

`checkupdates` 由 `pacman-contrib` 提供，使用临时数据库检查更新，不需要 root，也不会改动系统；`pacman -Qu` 则依赖上次同步的索引。

```bash
grep -E '^(IgnorePkg|IgnoreGroup)' /etc/pacman.conf
```

```bash
sudo pacman -S --needed pacman-contrib
checkupdates
pacman -Qu # 只对比本地数据库与已同步的仓库索引
```

Arch News 要重点看标题中的包名与「manual intervention」字样。新闻可能要求先升级某个包、修改配置、重建模块或重启服务；忽略它，`pacman -Syu` 本身不会提醒你。

## 执行升级并阅读输出

```bash
sudo pacman -Syu
```

不要执行 `pacman -Sy 包名`，那会只同步数据库而升级单个包，造成部分升级（唯一例外：keyring 引导更新，见下文「`archlinux-keyring` 过旧」一节，且随后必须立即 `-Su`）。换镜像源后可以用一次 `pacman -Syyu`，平时 `-Syu` 足够。

输出按阶段出现，重点看这些位置：

| 输出 | 含义 | 需要做什么 |
| -------------------------------------- | ---------------- | ------------------------ |
| `:: Starting full system upgrade...` | 开始全系统升级 | 确认不是只升级单个包 |
| `looking for conflicting packages...` | 依赖与冲突检查 | 出现冲突先停下，不要强装 |
| `:: Proceed with installation? [Y/n]` | 确认事务 | 读过输出再确认 |
| `warning: ... installed as ....pacnew` | 配置文件有新版本 | 升级后用 `pacdiff` 处理 |
| `:: Running post-transaction hooks...` | 执行钩子 | 钩子失败要单独排查 |

`-Syu` 中途不要关机、不要关闭终端，也不要在另一个终端执行 pacman。事务被中断可能留下锁文件和半安装状态，处理方式见 [第 53 章 常见故障处理](53-常见故障处理.md)。

## 升级后：验证而不是假设

```bash
systemctl --failed
journalctl -p err -b
pacman -Qdt
pacman -Qm
pacman -Qkk 包名 # 只针对可疑包，不必每次全量
```

- `systemctl --failed`：启动失败的单元，空输出才正常。
- `journalctl -p err -b`：本次启动的错误级别日志。
- `pacman -Qdt` / `pacman -Qm`：孤立依赖与非官方来源包。

需要重启的更新主要是内核、systemd、glibc 以及被大量进程映射的库。升级后若这些包有新版本，必须真正重启才能让新版本生效：

```bash
sudo systemctl reboot
```

> **注意**：重启会终止所有未保存的工作。多用户机器先看 `who` 确认没有他人登录，再确认没有 pacman 事务在运行。

重启后验证：

```bash
uname -r
ps -p 1 -o comm=
systemctl is-system-running
uptime -s
```

`uname -r` 应显示刚升级的内核版本；若仍是旧版本，说明启动时加载的还是旧镜像，回到第 36 章检查 `/boot` 与引导项。`uptime -s` 应接近刚才的重启时间——PID 1 的启动时间晚于升级时间，才说明系统真的重启过。

## .pacnew 与 .pacsave

pacman 只管理包自带的文件。若某个文件被标记为配置文件（PKGBUILD 中的 `backup=()`），升级时发现你改过它，pacman 不会覆盖你的版本，而把新版本保存为 `.pacnew`，例如 `/etc/ssh/sshd_config.pacnew`。

卸载包时，被修改过的配置文件会改名为 `.pacsave`；使用 `pacman -Rn` 的 `n` 选项则不保留。`pacman -Rns` 会连同配置一起删除，执行前确认。

```bash
pacdiff -o # 只列出待处理文件
sudo pacdiff # 逐个查看、合并或覆盖
sudo DIFFPROG=vimdiff pacdiff # 临时指定对比工具
```

`pacdiff` 属于 `pacman-contrib`，它调用 `DIFFPROG` 指定的对比工具。

处理原则：先理解新配置改了什么，再把必要内容合并进现有配置；不要无条件用 `.pacnew` 覆盖，否则可能丢失本机设置。处理完删除对应 `.pacnew`。用 `pacman -Qii 包名` 可以查看该包的备份文件列表与修改状态。

## 需要手动干预的典型更新

| 场景 | 表现 | 处理 |
| ------------------------ | -------------------------------- | ---------------------------------------------- |
| `archlinux-keyring` 过旧 | 签名未知、安装包被拒绝 | 先更新密钥环，再完成全系统升级 |
| `glibc` 大版本 | 服务异常、locale 或 NSS 行为变化 | 按 News 指示重启服务或系统 |
| `python` 次版本升级 | 第三方模块导入失败 | 官方包由仓库重建；AUR 模块需自行重建 |
| `icu` 等库 soname 变化 | 程序报 `libicu*.so` 找不到 | 重建依赖它的 AUR 包 |
| 配置文件合并 | 出现 `.pacnew` | 用 `pacdiff` 合并 |
| `systemd` 升级 | 旧进程仍运行旧版本 | 重启用户空间；必要时 `systemctl daemon-reexec` |

密钥环是使用特殊升级顺序的典型场景。系统很久未升级时，Wiki 允许先单独更新密钥环：

```bash
sudo pacman -Sy --needed archlinux-keyring && sudo pacman -Su
```

> **注意**：这是 Wiki 明确说明的例外，不是日常做法。执行后必须立即用 `pacman -Su` 完成全系统升级，不能停在「只更新了 keyring」的状态。

## 升级后的 AUR 重建

官方仓库升级后，AUR 包不会自动跟进。列出非官方来源包并检查链接：

```bash
pacman -Qm
ldd /usr/bin/程序名 | grep 'not found'
pacman -Qoq /usr/lib/libfoo.so.1
```

若共享库 soname 已变化，旧 AUR 包会链接失败。用助手批量升级，或进入构建目录手动重建：

```bash
cd ~/build/包名
git pull
makepkg -f -si
```

批量升级可用 `paru -Sua` 或 `yay -Sua`，但升级后仍要逐个验证程序能否启动。AUR 的构建与安全细节见 [第 49 章 AUR 机制与助手](49-AUR-机制与助手.md)。

## 失败模式

- **跳过 Arch News**：需要手动干预的更新（keyring、glibc、配置迁移）不会被 pacman 提醒；升级「成功」但服务起不来。
- **没有可回退状态就升级**：真机没快照、也没文件级备份，出问题只能从头修；升级前的最小退路是 VM 快照或 `/etc` 备份。
- **升级到一半断电或关终端**：留下锁文件与半安装状态；后续事务可能全部失败（处理见第 53 章）。
- **磁盘或 inode 不足**：事务在解包阶段失败，系统处于不一致状态；升级前必须同时看 `df -h` 与 `df -i`。
- **忽略 `.pacnew`**：配置长期停留在旧版本，安全修复没有生效；服务表面正常，问题在下次重启或漏洞利用时暴露。
- **内核/systemd/glibc 升级后不重启**：`uname -r` 仍是旧内核，旧库仍被进程映射；「升级完成」只是包层面完成。
- **AUR 包不重建**：官方库 soname 变化后，AUR 程序启动即报共享库缺失。
- **长期 `IgnorePkg`**：被压住的包持续部分升级，最终以依赖冲突或启动失败暴露。

## 验证与回滚

升级前先做只读预检，升级后逐项验证，不要凭「没报错」判断成功：

```bash
checkupdates # 只读检查可用更新，不写数据库
pacman -Qu | wc -l # 待升级包数量
df -h / && df -i / # 容量与 inode
grep -E '^(IgnorePkg|IgnoreGroup)' /etc/pacman.conf
systemctl --failed --no-pager
journalctl -p err -b --no-pager | tail -n 10
uname -r && uptime -s
pacdiff -o # 只列出待处理的 .pacnew/.pacsave
```

`checkupdates` 与 `pacman -Qu` 都不改系统；`uptime -s` 晚于升级时间才说明真正重启过；`pacdiff -o` 只列清单，不合并。回滚：虚拟机快照回整机；`/etc` 用备份或 `.pacnew` 逐文件合并；单包降级用缓存/ALA（第 43 章）。本章的 `pacman -Syu` 与重启**未实测**，预检与验证命令可安全复现。

## 取舍边界

- **频繁小步升级 vs 长期不动**：小步升级容易定位问题；长期不动会积累多个手动干预点。按 News 节奏，至少每月一次完整升级。
- **升级后立即重启 vs 延后**：内核、systemd、glibc 更新后应尽快重启；有未保存工作时先保存，别用「运行中」状态判断新版本已生效。
- **`.pacnew` 立即合并 vs 延后**：安全相关配置立即处理；需要停机窗口的登记到维护清单，但不能无限延后。
- **AUR 全量批量升级 vs 逐个**：批量快，但一个失败会打断整批；关键包逐个升级并立即验证。
- **只保留主线内核 vs 加装 LTS**：加装 `linux-lts` 是最便宜的保险；代价是多一份内核与 initramfs 的维护。

## 小结

- 升级前读 Arch News、备份、检查磁盘与待升级包，确认没有忽略规则。
- 只用 `sudo pacman -Syu` 完成全系统升级，永远不要 `pacman -Sy 包名`（唯一例外：keyring 引导，见上文）。
- 升级后检查 `systemctl --failed`、`journalctl -p err -b`、孤立包和非官方包。
- 内核、systemd、glibc 升级后必须重启才生效，用 `uname -r` 与 `uptime -s` 确认。
- `.pacnew` 用 `pacdiff` 合并；`.pacsave` 是卸载时保留的修改过的配置。
- keyring、glibc、python、icu 和配置合并是常见的手动干预点；AUR 包需在升级后重建。

## 练习

1. 在升级前执行 `checkupdates` 和 `pacman -Qu`，比较两者输出是否一致。
2. 阅读最近一期 Arch News，写清它影响哪些包、需要什么操作。
3. 先打一次虚拟机快照（真机则做一次 `tar` 备份），再完成一次 `pacman -Syu`，记录输出中的冲突与 `.pacnew`。
4. 用 `pacdiff -o` 列出系统中的待处理配置文件，解释每一个的来源。
5. 用 `pacman -Qm` 找出 AUR 包，挑一个检查它是否依赖近期升级过的库。

## 自检

- [ ] 升级前会主动阅读 Arch News
- [ ] 能解释 `-Syu` 与 `-Sy 包名` 的区别
- [ ] 能从 pacman 输出中识别冲突、`.pacnew` 和钩子失败
- [ ] 知道哪些升级后必须重启，以及如何确认新内核已加载
- [ ] 能说明 `.pacnew` 与 `.pacsave` 的产生条件
- [ ] 能独立处理一次 keyring 过旧的更新
- [ ] 升级后会检查 failed unit、日志、孤立包和 AUR 包

## 参考

- [System maintenance](https://wiki.archlinux.org/title/System_maintenance)
- [Arch News](https://archlinux.org/news/)
- [Pacman#Pacnew and Pacsave files](https://wiki.archlinux.org/title/Pacman#Pacnew_and_Pacsave_files)
