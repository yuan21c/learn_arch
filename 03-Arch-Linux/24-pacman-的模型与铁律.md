# 第 24 章 pacman 的模型与铁律

如果你用过 apt 或 dnf，pacman 的命令行看起来只是换了几个字母。真正的差别在数据模型：pacman 不维护一份「已安装包清单文件」，而是把同步数据库、本地数据库和包缓存分开管理，再用事务一次性完成升级。理解这三层数据，才能明白 Arch 为什么反复强调「只能完整升级」。

> 本章目标：能说清 pacman 的数据库、缓存与事务模型，区分显式安装与依赖安装，并解释部分升级为何会破坏系统。
> 对应 Wiki：[Pacman](https://wiki.archlinux.org/title/Pacman)

## 三层数据

| 名称       | 位置                     | 内容                                           | 谁写入              |
| ---------- | ------------------------ | ---------------------------------------------- | ------------------- |
| 同步数据库 | `/var/lib/pacman/sync/`  | 仓库索引，如 `core.db`、`extra.db` 及签名      | `pacman -Sy` 下载   |
| 本地数据库 | `/var/lib/pacman/local/` | 每个已安装包一个目录，记录版本、依赖、文件列表 | pacman 安装或卸载时 |
| 包缓存     | `/var/cache/pacman/pkg/` | 下载过的 `.pkg.tar.zst` 安装包                 | pacman 下载时       |

```bash
ls /var/lib/pacman/sync/
# core.db  core.db.sig  extra.db  extra.db.sig
ls /var/lib/pacman/local/ | head -n 3
# bash-5.3.3-1 / glibc-2.42-5 / pacman-7.1.0-1（三行，此处合并展示）
sudo du -sh /var/cache/pacman/pkg
```

同步数据库只是一份「仓库里有什么」的索引，不包含包文件本身；`-Sy` 刷新它，但不安装任何东西。本地数据库才是「这台机器装了什么」的唯一事实来源，`pacman -Q` 系列命令读的都是它。缓存则决定你能不能在断网或降级时拿到旧版本。

> **危险**：不要手动编辑 `/var/lib/pacman/local/`。写坏一个 `desc` 文件，pacman 会认为包状态不一致，后续升级可能直接失败。

## 显式安装与依赖安装

每个包的本地记录里都有一个「安装原因」：`explicit`（用户主动要求）或 `dep`（为满足别的包而装）。这个标记决定了孤立包清理的结果。

```bash
pacman -Qe            # 显式安装的包
pacman -Qd            # 作为依赖安装的包
pacman -Qdt           # 依赖安装、且已无人依赖的包（孤立包）

sudo pacman -D --asdeps 库名      # 改标为依赖
sudo pacman -D --asexplicit 库名  # 改标为显式
```

`pacman -Qi 包名` 的输出中有「安装原因」一行，可直接确认。典型场景：你手动装了一个库给别的程序用，它默认是显式的；改标为 `asdeps` 后，等使用者卸载，它才会出现在 `-Qdt` 里。

### 包、组、元包

| 概念 | 是什么                           | 例子           | 查看方式          |
| ---- | -------------------------------- | -------------- | ----------------- |
| 包   | 最小的安装单位，有版本和文件列表 | `bash`、`htop` | `pacman -Si 包名` |
| 组   | 一组包的逻辑集合，本身不是包     | `base-devel`   | `pacman -Sg 组名` |
| 元包 | 一个空包，只靠依赖拉入其他包     | `base`         | `pacman -Si base` |

```bash
pacman -Sg base-devel      # 只列出组成员，不安装
sudo pacman -S base-devel  # 安装整组
```

安装组时，组内每个包都会被记为显式安装，因为 pacman 不记录「你装过这个组」。如果组里某些包只是工具链依赖，可用 `-D --asdeps` 逐个调整。元包则相反：它的依赖才是安装原因，卸载元包后依赖会变成孤立包。

## 仓库顺序与版本选择

`/etc/pacman.conf` 中仓库的先后顺序就是优先级：

```ini
[core]
Include = /etc/pacman.d/mirrorlist

[extra]
Include = /etc/pacman.d/mirrorlist
```

当同名包出现在多个仓库时，pacman 选择**配置文件中先出现的仓库**，不会跨仓库比较版本。单个仓库内部通常只有一个版本，具体下载地址由 `mirrorlist` 中的镜像决定。

官方仓库（`core`、`extra`）由 Arch 团队构建并签名。AUR 不是仓库：它没有同步数据库、没有二进制包，`pacman -Ss` 搜不到，`pacman -Qm` 会把从 AUR 或本地安装的包列为「外来包」。AUR 的使用与风险见 [第 32 章 AUR 机制与助手](32-AUR-机制与助手.md)。

## 部分升级为什么危险

部分升级指：同步数据库已刷新，但系统里只有一部分包被升级。最常见的原因是执行了 `pacman -Sy 包名`。此时本地数据库与仓库索引不再对应，而且 pacman 只校验声明的依赖，ABI 断裂不在元数据里。

三类典型断裂：

1. **soname 变化**。`libfoo` 从 `libfoo.so.1` 升到 `libfoo.so.2`，仓库里的程序已针对新库重建；你只升级了新程序，旧库还在，程序启动时报 `error while loading shared libraries`。
2. **依赖版本约束**。新包声明 `python>=3.14`，pacman 会把 python 拉上新版本，但其他按旧 ABI 构建的 Python 模块不会一起重建。
3. **批量重建波**。`glibc`、`icu`、`openssl`、`python` 升级时，Arch 会重建大量依赖包。只升级其中一部分，等于把新库和旧使用者混在一起。

```bash
# 错误：只刷新数据库再装一个包
sudo pacman -Sy htop

# 正确：先完整升级，再安装
sudo pacman -Syu htop
```

## 铁律

> **铁律**：升级系统只用 `sudo pacman -Syu`。不要在未完整升级的系统上执行 `pacman -Sy 包名`。

| 场景         | 命令                    | 说明                           |
| ------------ | ----------------------- | ------------------------------ |
| 日常升级     | `sudo pacman -Syu`      | 刷新数据库并升级全部包         |
| 升级并装新包 | `sudo pacman -Syu 包名` | 仍是一次完整升级事务           |
| 更换镜像源后 | `sudo pacman -Syyu`     | 强制重下数据库，仅在换源后使用 |

## 关键路径

| 路径                     | 作用                                            |
| ------------------------ | ----------------------------------------------- |
| `/etc/pacman.conf`       | 仓库、选项、`IgnorePkg`、`SigLevel`、hooks 目录 |
| `/var/lib/pacman/local/` | 已安装包的本地数据库                            |
| `/var/lib/pacman/sync/`  | 仓库同步数据库                                  |
| `/var/lib/pacman/db.lck` | 事务锁，存在表示有 pacman 在运行                |
| `/var/cache/pacman/pkg/` | 包缓存，降级与离线重装的来源                    |
| `/var/log/pacman.log`    | 所有事务与包变更的日志                          |

> **危险**：看到「unable to lock database」时，先确认没有别的 pacman 在运行（`pgrep -a pacman`），再考虑删除 `db.lck`。两个 pacman 并发写本地数据库会造成真实损坏。

## 一次升级事务发生了什么

```bash
sudo pacman -Syu
```

```text
:: Synchronizing package databases...
:: Starting full system upgrade...
Packages (3) htop-3.4.1-1  libfoo-2.0-1  python-3.14.0-1
Total Download Size:   18.42 MiB
:: Proceed with installation? [Y/n]
```

确认后，pacman 依次做这些事：

1. 读取 `pacman.conf`，获取 `/var/lib/pacman/db.lck` 锁。
2. `-y`：下载各仓库的 `.db` 与 `.db.sig`，替换同步数据库。
3. 依赖求解，计算升级、安装、卸载集合，检查冲突。
4. 下载缺失的包到缓存，校验 SHA-256 与 PGP 签名，检查磁盘空间。
5. 执行 `PreTransaction` hooks。
6. 逐包解包：运行 `pre_install` 脚本、写入文件、运行 `post_install` 脚本、更新本地数据库。
7. 执行 `PostTransaction` hooks，例如 systemd 的 `daemon-reload`、`sysusers` 相关 hook。
8. 释放锁，把每一步写入 `/var/log/pacman.log`。

下载与校验全部在修改系统之前完成，因此下载失败或签名错误会干净地中止。但第 6 步中途失败（如磁盘满、脚本报错）可能留下半完成状态，此时不要急着重启，先看日志里最后一个成功动作。

## 小结

- 同步数据库是仓库索引，本地数据库是已安装事实，包缓存是旧版本来源。
- 显式安装和依赖安装由「安装原因」区分，直接影响孤立包清理。
- 组是包的集合，元包是靠依赖拉包的普通包；安装组会把成员标为显式。
- 同名包按 `pacman.conf` 的仓库顺序选择，AUR 不在 pacman 的仓库体系内。
- 部分升级破坏的是 ABI 与重建关系，pacman 的依赖检查往往发现不了。
- 升级只用 `pacman -Syu`；`-Syyu` 只在换镜像后使用。

## 练习

1. 列出 `sync`、`local`、缓存三个目录，用 `du -sh` 记录大小（环境：WSL，只读）。
2. 随机选一个已安装包，用 `pacman -Qi` 找到它的安装原因，再用 `-Qe`/`-Qd` 验证（环境：WSL，只读）。
3. 用 `pacman -Sg base-devel` 查看组成员，不安装；说明组与元包的区别（环境：WSL，只读）。
4. 读懂「部分升级」而不制造它（环境：WSL，只读）：记录 `pacman -Qu` 的待升级列表与 `pacman -Q linux` 的本地版本，用自己的话写出「如果只 `-Sy` 再装某个包，会与哪一层数据不一致」。**不要真的用 `-Sy` 装包**；想演练请在虚拟机的快照里做。

## 自检

- [ ] 能说出三个目录分别存什么、由谁写入
- [ ] 能解释 `-Qdt` 为什么依赖「安装原因」
- [ ] 能说明组和元包的区别
- [ ] 能解释同名包在多个仓库时如何选择
- [ ] 能举出至少两种部分升级导致的具体故障
- [ ] 能完整描述一次 `pacman -Syu` 事务的步骤

## 参考

- [Pacman](https://wiki.archlinux.org/title/Pacman)
- [System maintenance](https://wiki.archlinux.org/title/System_maintenance)
