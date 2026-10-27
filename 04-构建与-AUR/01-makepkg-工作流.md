# 01 makepkg 工作流

`makepkg` 是 Arch 的本地打包工具：它读取 `PKGBUILD`，下载源码、校验、编译，最后生成可用 `pacman` 安装的包文件。理解它与 `pacman` 的分工，是使用 AUR 和制作自己软件包的前提。

> 本章目标：能独立完成一次从 PKGBUILD 到 `.pkg.tar.zst` 的构建，并解释构建目录、依赖安装和安装产物的去向。
> 对应 Wiki：[Makepkg](https://wiki.archlinux.org/title/Makepkg)、[Creating packages](https://wiki.archlinux.org/title/Creating_packages)

## 1.1 makepkg 与 pacman 的分工

两者解决的是不同阶段的问题，不要混用。

| 工具      | 输入               | 输出             | 谁提供包             |
| --------- | ------------------ | ---------------- | -------------------- |
| `pacman`  | 仓库索引与二进制包 | 安装、升级、卸载 | 官方仓库或本地包文件 |
| `makepkg` | `PKGBUILD` 与源码  | `.pkg.tar.zst`   | 你自己在本地构建     |

`pacman -S` 从配置的仓库下载已经编译好的包；`makepkg` 只负责构建，依赖由 `-s` 交给 pacman 处理。构建完成后，仍由 `pacman -U` 安装产物，因此包的登记、文件清单和卸载流程与仓库包完全一致。

先安装构建工具链：

```bash
sudo pacman -S --needed base-devel git namcap
```

`base-devel` 提供 `gcc`、`make`、`fakeroot` 等基础工具，是大多数 PKGBUILD 的隐含前提。缺少它时，`makepkg` 会在构建阶段报“找不到编译器”或“缺少 fakeroot”。

| 路径                            | 作用                             |
| ------------------------------- | -------------------------------- |
| `/etc/makepkg.conf`             | 系统级默认值，由 `pacman` 包提供 |
| `~/.config/pacman/makepkg.conf` | 用户级覆盖，优先级更高           |

常用可调项包括 `CFLAGS`、`MAKEFLAGS`、`PKGEXT`、`PKGDEST`、`SRCDEST`：

```bash
# 查看当前生效的构建参数
grep -E '^(CFLAGS|MAKEFLAGS|PKGEXT|PKGDEST|SRCDEST)=' /etc/makepkg.conf
```

## 1.2 三个目录：$startdir、$srcdir、$pkgdir

PKGBUILD 里的路径几乎都围绕这三个变量展开。

| 变量        | 含义                                | 默认位置        |
| ----------- | ----------------------------------- | --------------- |
| `$startdir` | 执行 `makepkg` 时 PKGBUILD 所在目录 | 当前目录        |
| `$srcdir`   | 源码下载、解包、编译的工作目录      | `$startdir/src` |
| `$pkgdir`   | 打包根目录，模拟最终系统的 `/`      | `$startdir/pkg` |

`$pkgdir/usr/bin/foo` 在安装后会变成 `/usr/bin/foo`。包文件里只记录 `$pkgdir` 下的内容，因此所有安装动作都必须写进 `$pkgdir`，不能直接写 `/usr`。

```bash
mkdir -p ~/build/hello-arch && cd ~/build/hello-arch
# 放入 hello.sh 与 PKGBUILD 后
makepkg -o          # 只下载/复制源码，不构建
ls -la src/
makepkg             # 正常构建
ls -la pkg/usr/bin/
```

`-o` 对应 `--nobuild`：完成源码准备后停止。它适合检查 `source` 路径是否正确，而不必反复编译。

## 1.3 一次完整构建发生了什么

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

## 1.4 常用参数

| 参数                | 作用                                  | 典型场景         |
| ------------------- | ------------------------------------- | ---------------- |
| `-s` / `--syncdeps` | 用 `pacman` 安装缺失的仓库依赖        | 首次构建         |
| `-i` / `--install`  | 构建后调用 `pacman -U` 安装           | 验证包           |
| `-si`               | 安装依赖并构建后安装                  | 最常用组合       |
| `-f` / `--force`    | 覆盖同名包文件，强制重新构建          | 改了 PKGBUILD 后 |
| `-c` / `--clean`    | 构建后删除 `src/`、`pkg/`，保留包文件 | 节省空间         |
| `-o` / `--nobuild`  | 只下载与准备源码                      | 检查 source      |
| `--printsrcinfo`    | 把 `.SRCINFO` 输出到标准输出          | AUR 提交         |

组合使用：

```bash
makepkg -si                 # 装依赖、构建、安装
makepkg -f                  # 重新构建，覆盖旧包
makepkg -c                  # 构建后清理工作目录
makepkg --printsrcinfo > .SRCINFO
```

`-s` 只处理官方仓库里的依赖。若 `depends` 指向 AUR 包，`makepkg` 无法自动解决，必须先把那个 AUR 包构建并安装，再回来构建当前包。

## 1.5 产物、安装与卸载

默认产物文件名由四段组成：

```text
<pkgname>-<pkgver>-<pkgrel>-<arch>.pkg.tar.zst
```

例如 `hello-arch-1.0.0-1-any.pkg.tar.zst`。`epoch` 会写进包元数据并参与版本比较，但不出现在文件名中。拆分包会为每个子包各生成一个文件；启用调试符号时还会额外生成 `-debug` 包。

安装与核对：

```bash
sudo pacman -U ./hello-arch-1.0.0-1-any.pkg.tar.zst
pacman -Ql hello-arch
hello-arch
```

卸载与仓库包一致，包管理器知道它安装过哪些文件：

```bash
sudo pacman -Rns hello-arch
```

`-i` 只是把上面的 `pacman -U` 自动化，不会把包加入任何仓库。要让别的机器也能安装，需要分发包文件，或建立本地仓库。

## 1.6 构建失败的常见入口

| 现象                                                       | 先检查                               |
| ---------------------------------------------------------- | ------------------------------------ |
| `ERROR: Cannot find source file`                           | `source` 写的路径、文件名大小写      |
| `ERROR: One or more files did not pass the validity check` | `sha256sums` 与文件是否对应          |
| `error: target not found`                                  | 依赖名拼写、仓库是否启用             |
| `ERROR: package() is not defined`                          | 是否写了 `package()` 或拆分包函数    |
| 包安装后没有文件                                           | `package()` 是否把文件装进 `$pkgdir` |

修复后优先用 `-f` 重建，并观察 `src/` 与 `pkg/` 里的中间结果，而不是直接删除整个目录重来。更多 PKGBUILD 细节见 [02 PKGBUILD 逐行详解](02-PKGBUILD-逐行详解.md)，AUR 场景见 [03 AUR 机制与助手](03-AUR-机制与助手.md)。

## 小结

- `pacman` 管二进制包，`makepkg` 管从源码到包的构建，二者通过 `.pkg.tar.zst` 交接。
- 构建依赖 `base-devel`；`makepkg` 不能以 root 运行，`package()` 在 `fakeroot` 中完成。
- `$startdir` 是 PKGBUILD 所在目录，`$srcdir` 放源码，`$pkgdir` 是安装后根目录的镜像。
- 构建顺序为：校验 PKGBUILD、取源码、校验、`prepare()`、`build()`、`check()`、`package()`、压缩。
- 最常用组合是 `makepkg -si`；产物用 `pacman -U` 安装，用 `pacman -Rns` 卸载。

## 练习

1. 用 [02 PKGBUILD 逐行详解](02-PKGBUILD-逐行详解.md) 的 hello 示例构建一次包，记录 `makepkg` 的完整输出行数与最后生成的包文件名。
2. 先执行 `makepkg -o`，查看 `src/`；再执行 `makepkg`，查看 `pkg/`，说明两个目录的差别。
3. 删除 `pkg/` 后重新构建，观察 `-f` 的作用。
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
