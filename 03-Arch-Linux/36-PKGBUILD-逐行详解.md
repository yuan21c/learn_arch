# 第 36 章 PKGBUILD 逐行详解

`PKGBUILD` 是一个受约束的 Bash 脚本：上半部分声明包的身份、版本、依赖与源码，下半部分定义构建和安装步骤。`makepkg` 通过读取它决定「从哪里取源码、怎么编译、把哪些文件装进包」。

> 本章目标：能读懂并写出结构完整的 PKGBUILD，分清各类依赖与元数据，并知道每个字段出错时会发生什么。
> 对应 Wiki：[PKGBUILD](https://wiki.archlinux.org/title/PKGBUILD)、[Makepkg](https://wiki.archlinux.org/title/Makepkg)、[Creating packages](https://wiki.archlinux.org/title/Creating_packages)

## 元数据变量

| 变量           | 作用              | 要点                                                   |
| -------------- | ----------------- | ------------------------------------------------------ |
| `pkgname`      | 包名              | 小写，不含空格；拆分包时为数组                         |
| `pkgver`       | 上游版本          | 不能含连字符 `-`；可含字母、数字、`.`、`_`、`+`        |
| `pkgrel`       | 打包版本          | 正整数；只改 PKGBUILD 时加 1，`pkgver` 升级后归 1      |
| `epoch`        | 版本纪元          | 整数，用于强制新版本优先，格式为 `epoch:pkgver-pkgrel` |
| `pkgdesc`      | 一句话描述        | 单行，简洁说明包做什么                                 |
| `arch`         | 支持的架构        | `('any')` 表示架构无关，编译型通常 `('x86_64')`        |
| `url`          | 上游主页          | 便于用户核对来源                                       |
| `license`      | 许可证            | 数组，如 `('GPL-3.0-or-later')`、`('MIT')`             |
| `depends`      | 运行时依赖        | 安装包时由 `pacman` 一并安装                           |
| `makedepends`  | 构建时依赖        | 只在本机构建时需要，不写入包的运行时依赖               |
| `checkdepends` | 测试依赖          | 仅在 `check()` 阶段需要                                |
| `optdepends`   | 可选依赖          | 不会被自动安装，只显示提示                             |
| `conflicts`    | 冲突包            | 声明不能与本包共存                                     |
| `provides`     | 提供的虚拟包/替代 | 让依赖该名字的包得到满足                               |
| `replaces`     | 替代的旧包        | 升级时提示用本包替换                                   |
| `source`       | 源码列表          | 本地文件、URL 或 VCS 地址；可重命名                    |
| `sha256sums`   | 源码校验和        | 与 `source` 顺序逐项对应，`SKIP` 表示跳过              |
| `validpgpkeys` | 可信 PGP 指纹     | 完整 40 位指纹，用于验证签名源码                       |

一个 PKGBUILD 可以产出多个包：`pkgbase` 写总名，每个子包配一个 `package_子包名()`；VCS（git/svn）源的包还需要 `pkgver()` 从仓库动态生成版本。另有三个常用字段：`backup=('etc/mytools.conf')` 把配置列入保护（升级时生成 `.pacnew`、不覆盖你的修改，第 34 章）；`install=` 指定安装钩子脚本（post_install 等）；`options=('!strip')` 控制打包行为（`!strip` 保留调试符号）。

```bash
pkgbase=mytools                        # 可选；省略时默认取 pkgname 第一项
pkgname=(mytools-cli mytools-doc)      # 一次构建产出两个包
package_mytools-cli() { depends=('glibc'); install -Dm755 cli "$pkgdir/usr/bin/mytools"; }
package_mytools-doc()  { install -Dm644 doc.1 "$pkgdir/usr/share/man/man1/mytools.1"; }
```

`pkgver`、`pkgrel`、`epoch` 共同决定版本比较结果。例如 `epoch=1`、`pkgver=2.0.1`、`pkgrel=3` 的完整版本是 `1:2.0.1-3`：先比 epoch，再比版本，最后比 pkgrel。

## 依赖与包关系

四类依赖的边界：`depends` 在运行时必须存在；`makedepends` 只在构建时需要；`checkdepends` 只供 `check()` 使用；`optdepends` 不会被自动安装，仅在 `pacman -Si`/`-Qi` 和安装提示中显示。

`optdepends` 推荐写成 `'包名: 用途说明'`；`conflicts`、`provides`、`replaces` 常用于改名或替代场景：

```bash
optdepends=('python: 运行插件脚本')
provides=('old-name=1.2.3')
conflicts=('old-name')
replaces=('old-name')
```

这三项不会自动删除文件，最终仍由 `pacman` 在事务中处理。

## source、校验和与签名

`source` 数组中的每一项都要在 `sha256sums` 中有对应项，顺序一致。本地文件名相对于 PKGBUILD 所在目录；重命名语法为 `本地名::URL`。

```bash
source=('hello.sh' 'config.toml::https://example.com/config.toml')
sha256sums=('SKIP' '3f2c...')
updpkgsums          # pacman-contrib 提供，自动重算并写回
```

内容固定的发布 tarball 应填真实校验和，不应保留 `SKIP`；对 VCS 源（git/svn 等，校验和随提交变化）与 `.sig`/`.asc` 签名文件，`SKIP` 是标准做法。但 `SKIP` 不等于“已校验”：VCS 包通常用 `source=('git+...#commit=<哈希>')` 钉住某次提交，缺省则跟随上游默认分支的最新提交；PGP 验证只在源里带 `.sig`/`.asc` 且 PKGBUILD 声明 `validpgpkeys` 时发生。审查 AUR 的 `-git` 包时要看 `pkgver()` 与 `#commit=`，不能只看到 `SKIP` 就放行。上游若有签名文件，把它加入 `source`，并在 `validpgpkeys` 填完整 40 位指纹；只填密钥 ID 或短指纹不够。

## 四个函数与执行顺序

| 函数        | 是否必需 | 作用                     | 运行环境   |
| ----------- | -------- | ------------------------ | ---------- |
| `prepare()` | 否       | 打补丁、改配置、生成文件 | 普通用户   |
| `build()`   | 否       | 编译、生成产物           | 普通用户   |
| `check()`   | 否       | 运行测试                 | 普通用户   |
| `package()` | 是       | 把文件安装到 `$pkgdir`   | `fakeroot` |

顺序固定为 `prepare()` → `build()` → `check()` → `package()`。`check()` 失败会中止构建；只想跳过测试时可用 `makepkg --nocheck`，但正式打包不应长期跳过。拆分包用 `package_子包名()`，此时可以不写总 `package()`。

## 完整可运行示例

先准备脚本源文件：

```bash
mkdir -p ~/build/hello-arch && cd ~/build/hello-arch
cat > hello.sh <<'EOF'
#!/usr/bin/env bash
printf 'Hello, Arch!\n'
EOF
```

再写入 PKGBUILD：

```bash
pkgname=hello-arch
pkgver=1.0.0
pkgrel=1
pkgdesc='Minimal demo package'
arch=('any')
url='https://example.com/hello-arch'
license=('MIT')
depends=('bash')
source=('hello.sh')
sha256sums=('SKIP')

package() {
  install -Dm755 "$srcdir/hello.sh" "$pkgdir/usr/bin/hello-arch"
}
```

构建、检查并安装：

```bash
makepkg --printsrcinfo > .SRCINFO
namcap PKGBUILD
makepkg -si
hello-arch
```

`sha256sums=('SKIP')` 只用于本地练习。正式包应填写真实校验和，发布到 AUR 前也不应保留 `SKIP`。

## install -Dm755 与安装路径

`install` 是 coreutils 提供的复制工具：`-D` 自动创建父目录，`-m755` 把权限设为 `rwxr-xr-x`，最后一个参数是目标文件。因此上面的命令会创建 `$pkgdir/usr/bin/`、复制脚本并设为可执行。

文件必须落在 `$pkgdir` 下，安装后 `$pkgdir/usr/bin/hello-arch` 才会变成 `/usr/bin/hello-arch`。可执行文件用 `755`，配置或文档用 `644`。

> **危险**：不要在 `package()` 里写 `cp hello.sh /usr/bin/`。这会直接修改当前系统，而包内仍为空，卸载时也无法追踪。

## 检查与生成 .SRCINFO

`namcap` 静态检查 PKGBUILD 与构建产物；`.SRCINFO` 是 AUR 展示用的结构化摘要，修改 PKGBUILD 后必须重新生成：

```bash
namcap PKGBUILD
makepkg --printsrcinfo > .SRCINFO
```

## 常见错误

| 现象                       | 原因                         | 修复                                        |
| -------------------------- | ---------------------------- | ------------------------------------------- |
| `Cannot find source file`  | 文件名、相对路径或大小写错误 | 确认文件与 PKGBUILD 同目录，或修正 `source` |
| 校验和不匹配               | 源码更新或校验和填错         | `updpkgsums` 后重建；正式包不要用 `SKIP`    |
| `target not found`         | 依赖未装或包名错误           | `makepkg -s`；AUR 依赖先手动构建            |
| `package() is not defined` | 缺少安装函数                 | 补 `package()` 或 `package_子包名()`        |
| 包内没有文件               | 文件写到了 `$pkgdir` 之外    | 所有路径改为 `"$pkgdir/..."`                |

## 小结

- PKGBUILD 上半部分描述「包是什么」，下半部分描述「怎么构建、装到哪里」。
- `pkgver` 不能含连字符；`pkgrel` 在只改打包方式时递增；`epoch` 用于强制版本优先。
- `depends` 是运行时依赖，`makedepends` 与 `checkdepends` 只在构建时需要，`optdepends` 不会被自动安装。
- `source` 与 `sha256sums` 按顺序对应；正式包应使用真实校验和，签名源码用 `validpgpkeys`。
- 函数顺序为 `prepare()`、`build()`、`check()`、`package()`；所有安装动作都写入 `$pkgdir`。

## 练习

1. 把示例脚本改成输出当前用户与时间，重新构建并安装。（环境：WSL）
2. 给 PKGBUILD 增加 `optdepends`，用 `pacman -Qi hello-arch` 查看是否显示。（环境：WSL）
3. 删除 `sha256sums` 中的 `SKIP`，用 `updpkgsums` 生成真实校验和后重建。（环境：WSL）
4. `$pkgdir` 落点对比（环境：WSL）：把安装目标分别写成 `"$pkgdir/usr/bin/hello-arch"` 与 `/tmp/pkgroot/usr/bin/hello-arch`（一次性 DESTDIR）各构建一次，用 `find /tmp/pkgroot` 与 `tar tf` 看两者的差别，理解 `$pkgdir` 是打包沙箱。**不要**去掉 `$pkgdir` 让文件直落真实 `/usr/bin`：普通用户会权限拒绝，特权执行则污染系统、卸载无法追踪。
5. 用 `namcap PKGBUILD` 检查示例，解释每条提示的含义。（环境：WSL）

## 自检

- [ ] 能逐项解释 `pkgname`、`pkgver`、`pkgrel`、`epoch` 的关系
- [ ] 能区分 `depends`、`makedepends`、`checkdepends`、`optdepends`
- [ ] 能说明 `conflicts`、`provides`、`replaces` 各自的用途
- [ ] 知道 `source` 与 `sha256sums` 的顺序对应关系
- [ ] 能解释 `install -Dm755` 中每个参数的含义
- [ ] 知道为什么文件必须装进 `$pkgdir`
- [ ] 能用 `namcap` 和 `.SRCINFO` 完成打包前检查

## 参考

- [PKGBUILD](https://wiki.archlinux.org/title/PKGBUILD)
- [Makepkg](https://wiki.archlinux.org/title/Makepkg)
- [Creating packages](https://wiki.archlinux.org/title/Creating_packages)
