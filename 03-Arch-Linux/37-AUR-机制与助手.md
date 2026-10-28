# 第 37 章 AUR 机制与助手

AUR（Arch User Repository）是用户提交的 `PKGBUILD` 集合，不是二进制仓库。它把“有人已经写好构建脚本”这件事集中起来，但编译、依赖、安全和维护仍由使用者自己负责。官方不为 AUR 包提供支持。

> 本章目标：能安全地手动从 AUR 构建包，读懂更新差异，并在理解风险的前提下使用 AUR 助手。
> 对应 Wiki：[Arch User Repository](https://wiki.archlinux.org/title/Arch_User_Repository)、[AUR helpers](https://wiki.archlinux.org/title/AUR_helpers)、[Makepkg](https://wiki.archlinux.org/title/Makepkg)

## AUR 是什么，不是什么

| 维度     | 官方仓库         | AUR                                    |
| -------- | ---------------- | -------------------------------------- |
| 内容     | 已编译的二进制包 | `PKGBUILD`、`.SRCINFO`、补丁等构建材料 |
| 安装方式 | `pacman -S`      | 手动 `makepkg -si` 或助手              |
| 审核     | 打包者与 QA 流程 | 无官方二进制审核，社区投票与评论       |
| 支持     | 官方支持         | 官方不支持，风险自负                   |
| 更新     | 随仓库同步       | 上游变化后由提交者更新脚本             |

AUR 页面上的“包”只是构建脚本的入口。构建参数见 [第 35 章 makepkg 工作流](35-makepkg-工作流.md)，变量语法见 [第 36 章 PKGBUILD 逐行详解](36-PKGBUILD-逐行详解.md)。

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
2. 读 `PKGBUILD`：确认 `source` 域名、校验和、`build()`/`package()` 行为。
3. `makepkg -si`：`-s` 安装官方仓库依赖，`-i` 构建后安装。
4. 验证：`pacman -Ql example`、实际运行程序、检查是否有异常文件。

若 AUR 包依赖另一个 AUR 包，`-s` 无法自动解决。先构建并安装依赖，再构建目标包；或使用助手处理依赖树。

## 安全审查清单

AUR 没有统一的代码审计，恶意 PKGBUILD 可以在构建时执行任意命令。

| 检查项   | 危险信号                                                  |
| -------- | --------------------------------------------------------- |
| `source` | 短链接、网盘、来源不明的二进制、与上游主页不符的域名      |
| 校验和   | 全部 `SKIP`，或校验和与源码版本明显不匹配                 |
| 构建步骤 | `curl ... \| bash`、`wget ... \| sh`、`base64 -d \| bash` |
| 权限     | `chmod 777`、`sudo`、修改 `/etc` 或 `/usr` 的脚本         |
| 安装路径 | 文件写到 `$pkgdir` 之外，或伪装成系统包                   |
| 维护状态 | 长期未更新、大量“out-of-date”标记、评论中报告构建失败     |
| 社区信号 | 投票极少、维护者新注册、评论被删除或无人回应              |

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

| 目的               | paru           | yay           |
| ------------------ | -------------- | ------------- |
| 安装 AUR 包        | `paru -S 包名` | `yay -S 包名` |
| 完整升级（含 AUR） | `paru -Syu`    | `yay -Syu`    |
| 只升级 AUR 包      | `paru -Sua`    | `yay -Sua`    |

助手在升级时通常会展示 `PKGBUILD` 差异。不要一路回车；看到来源变化、新增下载命令或校验和被改成 `SKIP`，先停下来。`--noconfirm` 会让这类确认消失，不适合日常升级。

## 升级、soname 变化与重建

手动更新：

```bash
cd ~/build/example
git pull
git diff ORIG_HEAD..HEAD -- PKGBUILD   # ORIG_HEAD 是 pull 前的位置
makepkg -si
```

若 `PKGBUILD` 没变但上游版本变了，也要确认 `pkgver` 与校验和同步更新。

系统升级后 AUR 包可能失效，常见原因是共享库 soname 变化：

```bash
ldd /usr/bin/example | grep 'not found'
pacman -Qoq /usr/lib/libexample.so.1
pacman -Qm
```

`pacman -Qoq` 用于确认该库路径当前由哪个已安装包提供；路径已不存在时，说明旧库已被升级替换。用 `pacman -Qm` 列出所有非官方来源包，逐个判断哪些需要重建。典型需要重建的场景包括 `icu`、`python`、`openssl`、`glibc` 等基础库的大版本更新。

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
- 不要随意添加第三方二进制仓库来“替代”AUR，那会引入新的信任问题。
- AUR 页面标记过期的包，可等待维护者更新，或核对上游后修改本地 PKGBUILD，但不要盲目上传。

## 小结

- AUR 是构建脚本集合，不是二进制仓库，官方不支持。
- 标准流程是 `git clone`、读 `PKGBUILD`、`makepkg -si`，依赖需自行解决。
- 安全审查重点看 `source`、校验和、构建命令、安装路径和维护状态。
- 助手只是自动化，仍执行 PKGBUILD；先手动构建一次，再日常使用。
- 系统升级后检查 `pacman -Qm`，soname 变化时重建受影响的 AUR 包。

## 练习

1. 手动从 AUR 构建一个不涉及系统关键组件的小包，全程不使用助手。（环境：WSL）
2. 在 AUR 页面找到该包的 `PKGBUILD`，指出 `source` 的域名和校验和来源。（环境：WSL）
3. 用 `pacman -Qm` 列出系统中的非官方包，为每个包写一句用途说明。（环境：WSL）
4. 升级一个 AUR 包，先用 `git diff` 阅读变更，再执行 `makepkg -si`。（环境：WSL）
5. 找一个依赖其他 AUR 包的包，写出手动解决依赖的顺序。（环境：WSL）

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
