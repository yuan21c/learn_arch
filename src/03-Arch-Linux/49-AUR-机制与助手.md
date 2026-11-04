# 第 49 章 AUR 机制与助手

AUR（Arch User Repository）是用户提交的 `PKGBUILD` 集合，不是二进制仓库。它把「有人已经写好构建脚本」这件事集中起来，但编译、依赖、安全和维护仍由使用者自己负责。官方不为 AUR 包提供支持。

> 本章目标：能安全地手动从 AUR 构建包，读懂更新差异，并在理解风险的前提下使用 AUR 助手。
> 对应 Wiki：[Arch User Repository](https://wiki.archlinux.org/title/Arch_User_Repository)、[AUR helpers](https://wiki.archlinux.org/title/AUR_helpers)、[Makepkg](https://wiki.archlinux.org/title/Makepkg)

## AUR 是什么，不是什么

| 维度 | 官方仓库 | AUR |
| -------- | ---------------- | -------------------------------------- |
| 内容 | 已编译的二进制包 | `PKGBUILD`、`.SRCINFO`、补丁等构建材料 |
| 安装方式 | `pacman -S` | 手动 `makepkg -si` 或助手 |
| 审核 | 打包者与 QA 流程 | 无官方二进制审核，社区投票与评论 |
| 支持 | 官方支持 | 官方不支持，风险自负 |
| 更新 | 随仓库同步 | 上游变化后由提交者更新脚本 |

AUR 页面上的「包」只是构建脚本的入口。构建参数见 [第 47 章 makepkg 工作流](47-makepkg-工作流.md)，变量语法见 [第 48 章 PKGBUILD 逐行详解](48-PKGBUILD-逐行详解.md)。

## 标准手动流程

网页侧的流程：在 [aur.archlinux.org](https://aur.archlinux.org) 搜索包名 → 看 Package Details 里的上游 URL 与依赖 → `git clone https://aur.archlinux.org/<pkg>.git` 后走下面的标准手动流程；页面评论区常有构建失败的最新线索。

准备工具（`base-devel` 与 `git` 是前提）：

```bash
sudo pacman -S --needed base-devel git
```

以包名 `example` 为例：

```bash
mkdir -p ~/build && cd ~/build
git clone https://aur.archlinux.org/example.git
cd example
less PKGBUILD
makepkg -si
```

四步不能省：

1. `git clone`：只取构建材料，不执行任何脚本。
2. 读 `PKGBUILD` 全文：确认 `source` 域名、校验和、`build()`/`package()` 行为，以及 `install=` 指向的 `.install` 脚本；`source` 里的本地文件与补丁逐个打开读。
3. `makepkg -si`：`-s` 安装官方仓库依赖，`-i` 构建后安装。
4. 验证：`pacman -Ql example`、实际运行程序、检查是否有异常文件。

若 AUR 包依赖另一个 AUR 包，`-s` 无法自动解决。先构建并安装依赖，再构建目标包；或使用助手处理依赖树。

## 安全审查清单

AUR 没有统一的代码审计，恶意 PKGBUILD 可以在构建时执行任意命令。

| 检查项 | 危险信号 |
| -------- | --------------------------------------------------------- |
| `source` | 短链接、网盘、来源不明的二进制、与上游主页不符的域名 |
| 校验和 | 全部 `SKIP`，或校验和与源码版本明显不匹配 |
| 构建步骤 | `curl ... \| bash`、`wget ... \| sh`、`base64 -d \| bash` |
| 权限 | `chmod 777`、`sudo`、修改 `/etc` 或 `/usr` 的脚本 |
| `install=` | 指向的 `.install` 含 `pre_install`/`post_install` 等函数，安装阶段以 root 执行，必须逐行读 |
| 本地文件 | `source` 中的本地文件、补丁（非 URL 项）可能夹带未展示的改动，逐个打开核对 |
| 安装路径 | 文件写到 `$pkgdir` 之外，或伪装成系统包 |
| 维护状态 | 长期未更新、大量「out-of-date」标记、评论中报告构建失败 |
| 社区信号 | 投票极少、维护者新注册、评论被删除或无人回应 |

`install=` 列出的 `.install` 不是普通脚本：`pre_install`/`post_install`/`pre_upgrade`/`post_upgrade`/`pre_remove`/`post_remove` 由 pacman 在安装、升级、卸载阶段以 root 执行，审查时要像对待 `PKGBUILD` 一样逐行读。

几条硬规则：

- 拒绝 `curl | bash`，无论它看起来多方便。
- 不要在未读 `PKGBUILD` 的情况下执行 `makepkg -si`。
- 不要盲目使用 `--noconfirm`。它跳过确认，不会替你审查脚本。
- 不把 AUR 包当作官方安全更新；关键系统组件优先找官方仓库替代品。

## AUR 助手：paru 与 yay

助手自动完成搜索、克隆、依赖解析、构建和升级，但它们**仍然执行 PKGBUILD**，不会让包变安全。

先手动构建一次助手本身，理解流程后再日常使用。`paru` 与 `yay` 的仓库归属会变化，安装前先确认：

```bash
pacman -Ss '^paru$'
pacman -Ss '^yay$'
```

若只存在于 AUR，按本章「标准手动流程」：

```bash
git clone https://aur.archlinux.org/paru.git
cd paru
less PKGBUILD
makepkg -si
```

常用命令：

| 目的 | paru | yay |
| ------------------ | -------------- | ------------- |
| 安装 AUR 包 | `paru -S 包名` | `yay -S 包名` |
| 完整升级（含 AUR） | `paru -Syu` | `yay -Syu` |
| 只升级 AUR 包 | `paru -Sua` | `yay -Sua` |

助手在升级时通常会展示 `PKGBUILD` 差异。不要一路回车；看到来源变化、新增下载命令或校验和被改成 `SKIP`，先停下来。`--noconfirm` 会让这类确认消失，不适合日常升级。

## 升级、soname 变化与重建

手动更新：

```bash
cd ~/build/example
git pull
git diff ORIG_HEAD..HEAD # ORIG_HEAD 是 pull 前的位置；审查整个目录，别只看 PKGBUILD
makepkg -si
```

若 `PKGBUILD` 没变但上游版本变了，也要确认 `pkgver` 与校验和同步更新；`.install` 与补丁的改动同样不能漏读。

系统升级后 AUR 包可能失效，常见原因是共享库 soname 变化：

```bash
ldd /usr/bin/example | grep 'not found'
pacman -F libexample.so.1 # 需先 pacman -Fy
pacman -Qoq /usr/lib/libexample.so.1 # 路径存在时确认归属
pacman -Qm
```

`ldd` 报 `not found` 后，用 `pacman -F libexample.so.1` 去仓库里找提供者（需先 `pacman -Fy`）；`pacman -Qoq <现存路径>` 只用于确认某个已存在的库路径当前由哪个已安装包提供——文件被删和从未属于任何包都会报同一条 `No package owns`，不能据此区分「被升级替换」。用 `pacman -Qm` 列出所有非官方来源包，逐个判断哪些需要重建。典型需要重建的场景包括 `icu`、`python`、`openssl`、`glibc` 等基础库的大版本更新。

```bash
cd ~/build/example
git pull
makepkg -f -si
```

助手用户可用 `paru -Sua` 或 `yay -Sua` 批量升级，但升级后仍要检查 `pacman -Qm` 和实际运行结果。

## 升级失败与日常维护

AUR 包构建失败时，先看 `makepkg` 输出的第一条 `ERROR`；再读 AUR 页面评论，确认是否已有上游或依赖问题。随后检查依赖是否改名、是否需要先重建，清理旧 `src/` 后重试；仍失败时核对上游发布说明与 `PKGBUILD` 的版本、校验和。

维护习惯：

- 定期 `pacman -Qm`，删除不再需要的 AUR 包；记录每个包的用途和构建目录。
- 不要随意添加第三方二进制仓库来「替代」AUR，那会引入新的信任问题。
- AUR 页面标记过期的包，可等待维护者更新，或核对上游后修改本地 PKGBUILD，但不要盲目上传。

## 失败模式

- **`PKGBUILD` 里出现 `curl ... | bash`**：构建阶段以当前用户执行任意远程代码；这是最明确的拒绝信号，不是「安装方式」。
- **所有校验和都是 `SKIP`**：源码可被替换而无法发现；VCS 包也应钉住 `#commit=`，不能只靠 `SKIP`。
- **不读 `install=` 指向的 `.install`**：`post_install` 等函数由 pacman 以 root 执行，能改 `/etc`、`/usr`、删文件；必须逐行审查。
- **一路 `--noconfirm`**：跳过确认也跳过差异展示；升级时来源变化、新增下载命令都不会提示。
- **把投票数当安全证明**：投票只反映 popularity，不反映代码审查；维护者新注册、评论被删同样是信号。
- **助手与 pacman 同时运行**：两者都操作本地数据库，可能触发锁竞争或半事务；同一时间只留一个包管理进程。
- **AUR 包长期不重建**：上游 soname 变化后程序启动即报 `lib*.so` 找不到；升级后要检查 `pacman -Qm` 与 `ldd`。

## 验证与回滚

审查与构建都应在安装前完成：

```bash
git clone https://aur.archlinux.org/example.git && cd example
git log --oneline -n 5 # 看最近改动
git diff ORIG_HEAD..HEAD # 更新后审查整个目录
less PKGBUILD
less ./*.install # 若 install= 存在，逐个读
makepkg --verifysource # 只下载并校验源码
namcap PKGBUILD
makepkg -f # 只构建，不安装
pacman -Qkp ./*.pkg.tar.zst
```

`--verifysource` 把网络与校验和单独隔离；`namcap` 检查元数据；`pacman -Qkp` 读取产物而不安装。回滚：安装前记下旧版本与构建目录，出问题时用缓存或 ALA 降级（第 43 章），再 `pacman -Rns` 卸载有问题的包（**未实测**）。本章的 `makepkg -si` 安装与助手升级均**未实测**，演练止于构建与只读检查。

## 取舍边界

- **官方仓库 vs AUR**：官方有就用官方；AUR 只在前者没有、且你愿意读脚本时使用。
- **手动构建 vs 助手**：首次安装、审查敏感包用手动；日常批量升级可用助手，但不能开 `--noconfirm`。
- **paru vs yay**：功能高度重叠，选一个并固定；两者仓库归属会变化，安装前用 `pacman -Ss` 确认来源。
- **跟踪最新 vs 钉住提交**：需要新功能用最新；生产环境钉住提交并在维护窗口重建，换取可复现。
- **重建 vs 换官方替代**：上游进入官方仓库后优先切换，减少长期维护面；无法替代时保留构建目录与版本记录。

## 小结

- AUR 是构建脚本集合，不是二进制仓库，官方不支持。
- 标准流程是 `git clone`、读 `PKGBUILD`、`makepkg -si`，依赖需自行解决。
- 安全审查重点看 `source`、校验和、构建命令、安装路径和维护状态。
- 助手只是自动化，仍执行 PKGBUILD；先手动构建一次，再日常使用。
- 系统升级后检查 `pacman -Qm`，soname 变化时重建受影响的 AUR 包。

## 练习

1. 手动从 AUR 构建一个不涉及系统关键组件的小包，全程不使用助手。
2. 在 AUR 页面找到该包的 `PKGBUILD`，指出 `source` 的域名和校验和来源。
3. 用 `pacman -Qm` 列出系统中的非官方包，为每个包写一句用途说明。
4. 升级一个 AUR 包，先用 `git diff` 阅读变更，再执行 `makepkg -si`。
5. 找一个依赖其他 AUR 包的包，写出手动解决依赖的顺序。

## 自检

- [ ] 能说清 AUR 与官方仓库的区别
- [ ] 能不用助手完成一次 AUR 安装
- [ ] 能列出至少五条 PKGBUILD 安全审查项
- [ ] 知道为什么不能盲目使用 `--noconfirm`
- [ ] 能解释 soname 变化为什么要重建包
- [ ] 能用 `pacman -Qm` 检查非官方来源包
- [ ] 知道 AUR 助手仍然执行 PKGBUILD

## 参考

- [Arch User Repository](https://wiki.archlinux.org/title/Arch_User_Repository)
- [AUR helpers](https://wiki.archlinux.org/title/AUR_helpers)
- [Makepkg](https://wiki.archlinux.org/title/Makepkg)
- [PKGBUILD](https://wiki.archlinux.org/title/PKGBUILD)
