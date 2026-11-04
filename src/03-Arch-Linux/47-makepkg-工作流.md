# 第 47 章 makepkg 工作流

`makepkg` 是 Arch 的本地打包工具：它读取 `PKGBUILD`，下载源码、校验、编译，最后生成可用 `pacman` 安装的包文件。理解它与 `pacman` 的分工，是使用 AUR 和制作自己软件包的前提。先跑通一个最小 PKGBUILD（下面只给构建脚本；配套的 `hello.sh` 内容在第 48 章「最小 PKGBUILD」一节，先照它创建一个再回来构建）：

```bash
# 最小 PKGBUILD：身份 → 版本 → 依赖 → 构建安装
pkgname=hello-arch # 包名
pkgver=0.1.0 # 上游版本
pkgrel=1 # 打包版本，只改 PKGBUILD 时 +1
arch=('any') # 与架构无关
license=('MIT')
depends=() # 运行期依赖
makedepends=() # 构建期依赖
source=('hello.sh') # 与 PKGBUILD 放在同一目录的本地源文件
sha256sums=('1338391f057fed0e3a77101fd0d6929b31bba37bbd2e2d0cb70c51413ea77a78')
package() { install -Dm755 "$srcdir/hello.sh" "$pkgdir/usr/bin/hello-arch"; }
```

`source` 与 `sha256sums` 的元素个数必须相等：每个源文件对应一个校验和；只有 `source=()` 为空时才写 `sha256sums=()`。上面的哈希对应第 48 章 `hello.sh` 的原文，可用 `sha256sum hello.sh` 自行核对；发布包不得保留 `SKIP`（VCS/签名文件例外，见第 48 章）。

> 本章目标：能独立完成一次从 PKGBUILD 到 `.pkg.tar.zst` 的构建，并解释构建目录、依赖安装和安装产物的去向。
> 对应 Wiki：[Makepkg](https://wiki.archlinux.org/title/Makepkg)、[Creating packages](https://wiki.archlinux.org/title/Creating_packages)

## makepkg 与 pacman 的分工

两者解决的是不同阶段的问题，不要混用。

| 工具 | 输入 | 输出 | 谁提供包 |
| --------- | ------------------ | ---------------- | -------------------- |
| `pacman` | 仓库索引与二进制包 | 安装、升级、卸载 | 官方仓库或本地包文件 |
| `makepkg` | `PKGBUILD` 与源码 | `.pkg.tar.zst` | 你自己在本地构建 |

`pacman -S` 从配置的仓库下载已经编译好的包；`makepkg` 只负责构建，依赖由 `-s` 交给 pacman 处理。构建完成后，仍由 `pacman -U` 安装产物，因此包的登记、文件清单和卸载流程与仓库包完全一致。

先安装构建工具链：

```bash
sudo pacman -S --needed base-devel git namcap
```

`base-devel` 提供 `gcc`、`make`、`fakeroot` 等基础工具，是大多数 PKGBUILD 的隐含前提。缺少它时，`makepkg` 会在构建阶段报「找不到编译器」或「缺少 fakeroot」。产物里除 `.PKGINFO`/`.MTREE` 外还有 `.BUILDINFO`（记录构建环境，复现排障用）；`PKGDEST`/`BUILDDIR` 可把产物与构建目录挪到别处，但**不要在共享目录或网络文件系统里构建**（跨文件系统极慢、权限语义不同，还可能丢失权限位）。

| 路径 | 作用 |
| ------------------------------- | -------------------------------- |
| `/etc/makepkg.conf` | 系统级默认值，由 `pacman` 包提供 |
| `~/.config/pacman/makepkg.conf` | 用户级覆盖，优先级更高 |

常用可调项包括 `CFLAGS`、`MAKEFLAGS`、`PKGEXT`、`PKGDEST`、`SRCDEST`：

```bash
# 查看当前生效的构建参数
grep -E '^(CFLAGS|MAKEFLAGS|PKGEXT|PKGDEST|SRCDEST)=' /etc/makepkg.conf
```

## 三个目录：$startdir、$srcdir、$pkgdir

PKGBUILD 里的路径几乎都围绕这三个变量展开。

| 变量 | 含义 | 默认位置 |
| ----------- | ----------------------------------- | ------------------------- |
| `$startdir` | 执行 `makepkg` 时 PKGBUILD 所在目录 | 当前目录 |
| `$srcdir` | 源码下载、解包、编译的工作目录 | `$startdir/src` |
| `$pkgdir` | 打包根目录，模拟最终系统的 `/` | `$startdir/pkg/<pkgname>` |

`$pkgdir/usr/bin/foo` 在安装后会变成 `/usr/bin/foo`。包文件里只记录 `$pkgdir` 下的内容，因此所有安装动作都必须写进 `$pkgdir`，不能直接写 `/usr`。

```bash
mkdir -p ~/build/hello-arch && cd ~/build/hello-arch
# 放入 hello.sh 与 PKGBUILD 后
makepkg -o # 只下载/复制源码，不构建
ls -la src/
makepkg # 正常构建
ls -la pkg/hello-arch/usr/bin/ # $pkgdir 的默认路径带包名
```

`-o` 对应 `--nobuild`：完成源码准备后停止。它适合检查 `source` 路径是否正确，而不必反复编译。

## 一次完整构建发生了什么

`makepkg` 的顺序是固定的，排查构建失败时按这个顺序定位。

1. 读取并校验 `PKGBUILD`：语法、必填变量、`arch` 是否匹配、函数是否齐全。
2. 检查并安装依赖：`depends`、`makedepends`、`checkdepends`；加 `-s` 才会自动安装。
3. 获取 `source`：URL 用下载工具取回，本地文件复制到 `$srcdir`。
4. 校验：逐个比对 `sha256sums` 等校验和；有 PGP 签名时用 `validpgpkeys` 验证。
5. 解包或展开：压缩包解到 `$srcdir`，补丁和脚本保持原样。
6. 执行 `prepare()`：打补丁、改路径、生成配置。
7. 执行 `build()`：编译、生成可执行文件或资源。
8. 执行 `check()`：运行测试套件，失败通常中止构建。
9. 执行 `package()`：以 `$pkgdir` 为根安装文件。
10. 压缩并写入元数据：生成 `.pkg.tar.zst`、`.PKGINFO`、`.MTREE`。

`build()` 和 `check()` 以普通用户身份运行；`package()` 在 `fakeroot` 环境中运行，使包内文件记录为 `root:root`，但不需要真正的 root 权限。`makepkg` 自身拒绝以 root 运行，这是有意的保护。

## 常用参数

| 参数 | 作用 | 典型场景 |
| --------------------- | ------------------------------------- | -------------------- |
| `-s` / `--syncdeps` | 用 `pacman` 安装缺失的仓库依赖 | 首次构建 |
| `-i` / `--install` | 构建后调用 `pacman -U` 安装 | 验证包 |
| `-si` | 安装依赖并构建后安装 | 最常用组合 |
| `-f` / `--force` | 覆盖同名包文件，强制重新构建 | 产物已存在时 |
| `-c` / `--clean` | 构建后删除 `src/`、`pkg/`，保留包文件 | 节省空间 |
| `-C` / `--cleanbuild` | 构建**前**删除 `$srcdir` | 旧源码残留导致失败时 |
| `-o` / `--nobuild` | 只下载与准备源码 | 检查 source |
| `--printsrcinfo` | 把 `.SRCINFO` 输出到标准输出 | AUR 提交 |

组合使用：

```bash
makepkg -si # 装依赖、构建、安装
makepkg -f # 重新构建，覆盖旧包
makepkg -c # 构建后清理工作目录
makepkg -C # 构建「前」删除 $srcdir（旧源码残留导致失败时用）
makepkg --printsrcinfo > .SRCINFO
```

`-s` 只处理官方仓库里的依赖。若 `depends` 指向 AUR 包，`makepkg` 无法自动解决，必须先把那个 AUR 包构建并安装，再回来构建当前包。

## 产物、安装与卸载

默认产物文件名由四段组成：

```text
<pkgname>-<pkgver>-<pkgrel>-<arch>.pkg.tar.zst
```

例如 `hello-arch-0.1.0-1-any.pkg.tar.zst`。`epoch` 同时写入包元数据并参与版本比较；当 `epoch>0` 时文件名会变成 `<pkgname>-<epoch>:<pkgver>-<pkgrel>-<arch>.pkg.tar.zst`（可用 `pacman -Sp fakeroot` 观察 `fakeroot-1:1.37.2-3-x86_64.pkg.tar.zst`）。拆分包会为每个子包各生成一个文件；启用调试符号时还会额外生成 `-debug` 包。

安装与核对：

```bash
sudo pacman -U ./hello-arch-0.1.0-1-any.pkg.tar.zst
pacman -Ql hello-arch
hello-arch
```

卸载与仓库包一致，包管理器知道它安装过哪些文件：

```bash
sudo pacman -Rns hello-arch
```

`-i` 只是把上面的 `pacman -U` 自动化，不会把包加入任何仓库。要让别的机器也能安装，需要分发包文件，或建立本地仓库。

## 构建失败的常见入口

| 现象 | 先检查 |
| ---------------------------------------------------------- | ------------------------------------ |
| `ERROR: Cannot find source file` | `source` 写的路径、文件名大小写 |
| `ERROR: One or more files did not pass the validity check` | `sha256sums` 与文件是否对应 |
| `error: target not found` | 依赖名拼写、仓库是否启用 |
| `ERROR: package() is not defined` | 是否写了 `package()` 或拆分包函数 |
| 包安装后没有文件 | `package()` 是否把文件装进 `$pkgdir` |

修复后优先用 `-f` 重建，并观察 `src/` 与 `pkg/` 里的中间结果，而不是直接删除整个目录重来。更多 PKGBUILD 细节见 [第 48 章 PKGBUILD 逐行详解](48-PKGBUILD-逐行详解.md)，AUR 场景见 [第 49 章 AUR 机制与助手](49-AUR-机制与助手.md)。

## 失败模式

- **用 root 跑 `makepkg`**：上游明确拒绝；构建目录与产物属主也会变成 root，后续普通用户无法清理或复用。
- **缺 `base-devel`**：`makepkg` 找不到 `fakeroot`、`gcc`、`pkg-config`，报错看似源码问题，实为工具链缺失。
- **`source=()` 写错文件名或校验和**：下载成功但校验失败，或解压出非预期目录；先手工 `curl` 核对。
- **`package()` 里路径写错**：`$pkgdir` 未创建或写成相对路径，产物为空却在最后一步才报错。
- **在 `src/` 里改源码**：`makepkg -C` 或下次构建会清掉；补丁应写进 `prepare()` 或 `source=()`。
- **`-i` 与 `-s` 混用却不看依赖**：`-s` 只装构建依赖，运行时依赖由包元数据声明；缺 `depends` 会导致装完不能运行。
- **构建目录与产物放在共享路径**：多人或 CI 共用时权限与缓存互相污染；每次用独立目录。

## 验证与回滚

构建本身不改系统包数据库，可以安全演练；`makepkg -i` 会安装包，**未实测**。

```bash
makepkg --verifysource # 只下载并校验源码，不编译
makepkg -o # 只解压源码、执行 prepare，不编译
makepkg -f # 重新构建，生成 .pkg.tar.zst
pacman -Qip 包文件 # 读取包元数据：包名/版本/依赖
namcap PKGBUILD 包文件 # 静态检查常见问题（需安装 namcap）
```

`--verifysource` 把「网络与校验和」单独隔离出来，失败时不用等完整编译；`pacman -Qip` 不安装就能看包元数据，`pacman -Qlp` 看包内文件清单（`-Qkp` 只核对文件是否存在，不输出依赖）。回滚：构建失败删掉 `src/` 与 `pkg/` 重来；包已安装则 `pacman -Rns 包名` 卸载（**未实测**），本地仓库条目同步删除。实验可在 `/tmp` 建一个最小 `PKGBUILD` 构建，不执行 `-i`。

## 取舍边界

- **`makepkg` vs 手工编译**：能用 `PKGBUILD` 就用，依赖、校验、打包都可复现；手工编译只适合一次性验证。
- **`-s` vs `-i`**：`-s` 装构建依赖，`-i` 装构建结果；CI 环境通常只构建不安装。
- **`-o` vs 完整构建**：改 `prepare()` 或源码地址时先用 `-o` 快速验证；确认后再完整编译。
- **`-C` vs 保留 `src/`**：调试补丁时保留 `src/` 便于看中间结果；日常构建用 `-C` 保证干净。
- **本地构建 vs 进仓库**：自用包本地构建即可；要分发给他人应进自定义仓库并签名（第 50 章）。

## 小结

- `pacman` 管二进制包，`makepkg` 管从源码到包的构建，二者通过 `.pkg.tar.zst` 交接。
- 构建依赖 `base-devel`；`makepkg` 不能以 root 运行，`package()` 在 `fakeroot` 中完成。
- `$startdir` 是 PKGBUILD 所在目录，`$srcdir` 放源码，`$pkgdir` 是安装后根目录的镜像。
- 构建顺序为：校验 PKGBUILD、取源码、校验、`prepare()`、`build()`、`check()`、`package()`、压缩。
- 最常用组合是 `makepkg -si`；产物用 `pacman -U` 安装，用 `pacman -Rns` 卸载。

## 练习

1. 用 [第 48 章 PKGBUILD 逐行详解](48-PKGBUILD-逐行详解.md) 的 hello 示例构建一次包，记录 `makepkg` 的完整输出行数与最后生成的包文件名。
2. 先执行 `makepkg -o`，查看 `src/`；再执行 `makepkg`，查看 `pkg/`，说明两个目录的差别。
3. 连续构建两次，观察第二次因产物已存在而拒绝覆盖的报错；再用 `makepkg -f` 覆盖重建。
4. 故意把 `source` 改成不存在的文件名，记录报错，再修复。
5. 用 `pacman -Ql` 列出自己构建的包安装了哪些文件，并与 `$pkgdir` 对比。

## 自检

- [ ] 能说明 `pacman` 与 `makepkg` 各自负责什么
- [ ] 能解释 `$startdir`、`$srcdir`、`$pkgdir` 的区别
- [ ] 能说出 `-s`、`-i`、`-f`、`--clean`、`--printsrcinfo` 的作用
- [ ] 知道为什么 `makepkg` 不能以 root 运行
- [ ] 能根据产物文件名判断包名、版本和架构
- [ ] 能独立安装并卸载自己构建的包

## 参考

- [Makepkg](https://wiki.archlinux.org/title/Makepkg)
- [Creating packages](https://wiki.archlinux.org/title/Creating_packages)
- [PKGBUILD](https://wiki.archlinux.org/title/PKGBUILD)
- [Arch User Repository](https://wiki.archlinux.org/title/Arch_User_Repository)
