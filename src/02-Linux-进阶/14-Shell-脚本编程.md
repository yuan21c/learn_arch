# 第 14 章 Shell 脚本编程

前面各章的命令都是手工敲的。当同一串操作要重复第三次，就该把它写成脚本——不是为了让命令更短，而是为了让**判断**（什么时候做、失败怎么办）固化下来。本章只讲 Bash，因为它是主流发行版的默认交互 shell；语法细节以 `man bash` 与 [Bash](https://wiki.archlinux.org/title/Bash) 为准。

> 本章目标：能写出带 shebang、可直接执行的脚本；掌握变量、引号、参数与退出码；会用 `test`/`[[ ]]` 写条件，用 `for`/`while`/`case` 写流程；会定义函数与 `local`；能用 `set -euo pipefail` 与 `trap` 让脚本出错时安全退出；避开词分割、管道子 shell 等常见坑。
> 对应 Wiki：[Bash](https://wiki.archlinux.org/title/Bash)、[Core utilities](https://wiki.archlinux.org/title/Core_utilities)

> **命令来源（本章涉及的命令）**
> 
> | 命令 | 是什么简写 | 由什么命令/机制发展而来 | 参数/选项来源 | 如何记忆 |
> |------|------------|------------------------|---------------|----------|
> | `source` | 英文 source（来源）| shell 内置，在当前 shell 执行文件 | `. 文件` 是 POSIX 等价写法 | source = source，在当前 shell 里“来源”执行一个文件 |
> | `export` | 英文 export（导出）| shell 内置，把变量提升为环境变量 | 见第 10 章 | export = 导出，把变量“导出”给子进程 |
> | `mktemp` | **mk**e **temp**（创建临时文件）| GNU coreutils，创建临时文件/目录 | `-d` 创建临时目录 | mktemp = make temp，创建“临时”资源 |
> | `trap` | 英文 trap（陷阱/捕获）| shell 内置，捕获信号并执行命令 | `EXIT` 伪信号，在脚本退出时触发 | trap = trap，设个“陷阱”捕获退出信号 |
> | `shellcheck` | **shell** **check**（Shell 检查）| 静态分析工具，检查 shell 脚本常见问题 | 直接跟脚本路径 | shellcheck = shell check，检查 shell 脚本 |
> | `curl` | **c**lient **url**（URL 客户端）| 1997 年由 Daniel Stenberg 开发，数据传输工具 | `-fsSL`：失败静默、显示错误、跟随重定向、静默 | curl = client url，客户端工具，传 URL 数据 |
> | `date` | 英文 date（日期）| Unix 第 1 版即有，GNU coreutils | `+%Y%m%d-%H%M%S` 自定义格式 | date = date，显示/设置日期时间 |
> | `basename` | **base** **name**（基名）| 去掉目录前缀，只留文件名 | 直接跟路径 | basename = base name，取路径的“基名” |
> | `dirname` | **dir** **name**（目录名）| 去掉文件名，只留目录部分 | 直接跟路径 | dirname = dir name，取路径的“目录名” |
> | `printf` | **print** **f**ormat（格式化打印）| C 语言 printf 的 shell 版本，GNU coreutils | `'%s\n'` 格式化字符串 | printf = print format，按格式“打印” |
> | `cut` | 英文 cut（切割）| 见第 4 章 | `-d` 分隔符、`-f` 字段 | cut = cut，按列“切开”文本 |
> | `find` | 英文 find（查找）| 见第 3 章 | `-name`、`-type`、`-mtime`、`-delete` | find = find，在目录树里“找”文件 |
> | `tar` | **t**ape **ar**chive（磁带归档）| Unix 第 7 版（1979），原用于磁带归档 | `-c` 创建、`-x` 解包、`-z` gzip、`-v` 详细、`-f` 指定文件 | tar = tape archive，磁带“归档”，打包文件 |
> | `xargs` | **x** **args**（参数展开）| 将 stdin 的参数传给另一命令 | `-r` 无输入不运行、`-0` 配合 NUL 分隔 | xargs = x args，把 stdin 变成另一命令的“参数” |

脚本 = 文本文件 + 执行权限 + 一行 shebang。shebang（`#!`）告诉内核用哪个解释器，没有它就只能靠当前 shell 硬跑（`/tmp` 演练）：

```bash
mkdir -p /tmp/lab12 && cd /tmp/lab12
cat > hello.sh <<'EOF'
#!/usr/bin/env bash
echo "hello from $0"
EOF
chmod +x hello.sh && ./hello.sh
```

三种执行方式的差别必须分清：

| 写法 | 是否新建进程 | 能否改当前 shell | 适用场景 |
| -------------------------------- | -------------------- | ---------------- | ------------------ |
| `./hello.sh` | 是（子进程跑解释器） | 不能 | 日常执行 |
| `bash hello.sh` | 是 | 不能 | 调试、无执行权限时 |
| `source hello.sh` / `. hello.sh` | **否** | **能** | 加载配置、定义函数 |

`source` 是唯一能改变当前 shell 的写法——这解释了第 10 章为什么 `export` 与启动文件必须被 source，而普通脚本改了 `PATH` 出不了脚本。

## 变量与引号

赋值号两边不能有空格；引用时加引号：

```bash
name="arch linux"; echo "hello, ${name}!" # ${} 明确变量边界
count=3; echo $((count * 2)) # 6：算术展开
echo "$((5 / 3))" # 1：整数除法，没有浮点
```

引号是脚本 bug 的头号来源：

| 写法 | 行为 |
| -------- | --------------------------------------------- |
| `"$var"` | 展开为一个参数，**推荐默认写法** |
| `$var` | 展开后按 `IFS` 做**词分割**，还会做通配符展开 |
| `'$var'` | 完全字面量，不展开 |

对照实验：`f="my file.txt"; touch "$f"` 之后，`ls $f` 被拆成两个参数并报 `No such file`，`ls "$f"` 才正确。变量默认只在当前 shell 内有效，要传给子进程必须 `export`（第 10 章）。

## 参数、退出码与信号

| 变量 | 含义 |
| ---- | -------------------------------------------------------------------- |
| `$0` | 脚本名（或 shell 名） |
| `$#` | 参数个数 |
| `$@` | 全部参数；`"$@"` 展开为**每个参数一个词**（正确写法） |
| `$*` | 全部参数；`"$*"` 按 `IFS` 拼成一个字符串，不加引号则与 `$@` 一样分词 |
| `$?` | 上一条命令的退出码：`0` 成功 |

退出码是脚本与外界的唯一契约：`0` 成功、`1` 一般错误、`2` 用法错误、`126` 不可执行、`127` 命令不存在。不写 `exit` 时退出码取最后一条命令的结果，这常是意外来源，显式 `exit` 更稳。

## 条件判断：test、[ ] 与 [[ ]]

`[` 是与 `test` 等价的独立命令/内建（另有 `/usr/bin/[`），不是 alias，方括号**两侧必须有空格**。`[[ ]]` 是 Bash 关键字，支持 `&&`、`||`、`=~`，且不做词分割，**脚本里优先用它**：

```bash
f=/etc/passwd
if [[ -f $f && -r $f ]]; then echo "regular file, readable"; fi
if [[ $# -lt 1 ]]; then echo "usage: $0 <path>" >&2; exit 2; fi
```

常用测试：`-e` 存在、`-f` 普通文件、`-d` 目录、`-L` 符号链接、`-r/-w/-x` 权限、`-s` 非空、`-z` 空、`-n` 非空。**数值比较用 `-eq -ne -lt -le -gt -ge`，字符串用 `=` `!=`**。混用的代价很具体：`[[ 02 = 2 ]]` 为假（字典序），`[[ 02 -eq 2 ]]` 为真。

## 分支与循环

```bash
case "$1" in
 start) echo start ;;
 stop) echo stop ;;
 *) echo "unknown: $1" >&2; exit 2 ;;
esac

for f in /etc/*.conf; do printf '%s\n' "$f"; done
for ((i = 0; i < 3; i++)); do echo "$i"; done

while read -r line; do printf 'line: %s\n' "$line"; done < /etc/hostname
```

两个要点：`for f in *.conf` 在无匹配时（`nullglob` 默认关闭）会把字面量 `*.conf` 当作一个元素，需判断时加 `[[ -e $f ]]` 或 `shopt -s nullglob`；`while read -r` 的 `-r` 防止反斜杠被吞，输入用 `< file` 而不是 `cat file |`——管道会让循环在**子 shell** 里跑，循环内赋的变量出了循环就没了。

## 函数

`local` 限定作用域，`return` 返回的是**退出码而不是值**：

```bash
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
need_root() { local who=${1:-script}; [[ $EUID -eq 0 ]] || die "$who: run as root"; }
need_root backup.sh
```

要「返回值」就让函数 `echo` 输出、调用方用命令替换接收：`size=$(du -sb "$dir" | cut -f1)`。命令替换会去掉末尾换行，且失败不易察觉——判断失败要写成 `if ! out=$(cmd 2>&1); then die "$out"; fi`。

## 健壮性：set、trap 与 shellcheck

生产脚本的开头几乎总是 `set -euo pipefail`：

- `-e`：命令返回非 0 立即退出（但在 `if`、`&&`、`||` 的条件位置**不触发**）；
- `-u`：引用**未定义**变量直接报错。注意它不管空值：`DIR=""` 不会触发，要防「空目录删到根」得写 `${DIR:?未设置}` 或先 `[[ -n $DIR ]]`；
- `-o pipefail`：管道中任一环失败即整体失败——默认只看最后一环，`set -e` 会漏掉前面的失败。

```bash
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
```

`trap ... EXIT` 保证中途失败也不留垃圾。最后用 `shellcheck 脚本.sh` 静态检查，本章列出的坑它能抓出大半；用发行版包管理器安装（Arch：`pacman -S shellcheck`，见第 42 章），说明见 [ShellCheck](https://www.shellcheck.net/)。

## 两个能用的脚本

**带时间戳的备份**——前置检查、失败即止、清理 7 天前的旧备份（`-mtime +7` 按整天取整，实际匹配 8 整天以上，并非「最近 7 份」；按份数裁剪可用 `ls -1t "$dst"/*.tar.gz | tail -n +8 | xargs -r rm`）（`/tmp` 演练）：

```bash
#!/usr/bin/env bash
set -euo pipefail
src=${1:?usage: backup.sh <src-dir>} # 参数为空就报错退出
dst=/tmp/backups; mkdir -p "$dst"
stamp=$(date +%Y%m%d-%H%M%S)
tar -czf "$dst/$(basename "$src")-$stamp.tar.gz" -C "$(dirname "$src")" "$(basename "$src")"
find "$dst" -name '*.tar.gz' -mtime +7 -delete
```

**带重试的下载**——循环、条件与退避：

```bash
#!/usr/bin/env bash
set -euo pipefail
url=${1:?usage: fetch.sh <url>}
for attempt in 1 2 3; do
 if curl -fsSL -o /tmp/fetch.out "$url"; then echo "ok on $attempt"; exit 0; fi
 sleep $((attempt * 2))
done
exit 1
```

第二个脚本里 `if` 包住了 `curl`，所以失败不会触发 `set -e` 的立即退出，而是落到下一次循环——这正是 `-e` 的条件位置例外。

## 常见坑清单

- 不给变量加引号 → 空格与通配符把参数拆散；
- `[ $x = y ]` 中 `x` 为空 → 变成 `[ = y ]`，报 `unary operator expected`，改用 `[[ ]]`；
- `cat file | while read` → 循环在子 shell，变量出不来；
- `for f in $(ls)` → 按空白拆分文件名，遇空格即错，直接 `for f in *`；
- `cd` 失败后继续 → 后续 `rm -rf *` 落在错误目录，写 `cd "$dir" || exit 1`；
- 把 `set -e` 当万灵药 → 它在 `local x=$(cmd)` 里也会被掩盖，应拆成两行；
- 用 `echo` 处理任意文本 → 以 `-` 开头或含转义时出错，改用 `printf '%s\n'`。

进阶内容——数组与 `getopts`、CRLF 排查、退出码 128+N、`mktemp`+`trap` 与调试三板斧——见第 15 章。

## 失败模式

- **变量不加引号**：路径含空格、通配符或为空时，参数会被拆分或吞掉；规则是「默认给所有变量加双引号」，例外只有明确需要分词时。
- **`[ $x = y ]` 遇到空值**：`x` 为空会变成 `[ = y ]`，报 `unary operator expected`；用 `[[ ]]` 或先补默认值。
- **`cat file | while read` 丢变量**：管道右侧在子 shell 执行，循环里赋的值出了循环就没了；改成 `while ...; done < file`。
- **`for f in $(ls)` 拆文件名**：命令替换按空白拆分，文件名带空格就断成两个；用 `for f in *` 或 `find -print0`。
- **`cd` 失败后继续**：后续相对路径的删除/写入会落在错误目录；写 `cd "$dir" || exit 1`。
- **把 `set -e` 当万灵药**：`if`/`&&`/`||` 的条件位置不触发、`local x=$(cmd)` 会掩盖失败；关键命令显式判断，不要只靠 `-e`。
- **`echo` 处理任意文本**：以 `-` 开头会被当成选项、反斜杠可能被解释；用 `printf '%s\n'`。
- **`trap` 没设或设太晚**：`mktemp` 之后才设 `trap`，中间失败会留下临时目录；把 `trap` 紧跟资源创建之后。

## 验证与回滚

| 操作 | 验证 | 回滚 |
| ---------------------- | -------------------------------------- | ------------------------------------------ |
| 改脚本 | `bash -n` 查语法；`shellcheck` 查常见坑 | 版本控制 `git diff`/`git restore` |
| 首次运行 | 在 `/tmp` 副本或测试目录跑；先 `printf` 干跑关键路径 | 删除测试产物，原目录未动 |
| 批量文件操作 | 先打印将处理的文件清单，核对数量 | 提前 `cp -a` 备份或放进 git |
| 改环境变量 | 新开一个 shell 验证，不污染当前会话 | `unset` 或恢复旧值 |

脚本的「回滚」主要靠**运行前的作用域隔离**：能在 `/tmp` 演练就在 `/tmp`，能先 `cp -a` 就先复制。脚本本身很少提供撤销，`rm`/`mv` 一旦执行就没有内置退路。

## 取舍边界

- **shell vs Python**：行与字段的流水线用 shell；嵌套数据结构、异常、并发、可测试逻辑用 Python。判断信号是「数据是否需要对象与关系」，不是代码行数。
- **`set -e` vs 显式错误处理**：小脚本用 `set -euo pipefail` 快速获得健壮性；需要精细控制每一步失败行为的脚本，显式 `if ! cmd; then ...` 更清晰。
- **bash vs POSIX sh**：目标环境确定是 bash 就用 bash 特性（数组、`[[ ]]`）；要跨 busybox/Alpine 运行则写 POSIX sh，并实测。
- **脚本 vs systemd/Makefile**：一次性编排用脚本；需要开机自启、失败重启、日志归集交给 systemd；构建流程交给 Makefile/任务 runner。
- **函数 vs 平铺**：重复三次以上才抽函数；过早抽象会让简单脚本多一层跳转，反而难读。

## 小结

- 脚本 = shebang + 可执行权限；`./`、`bash` 在子进程跑，只有 `source` 能改当前 shell。
- 默认给变量双引号；数值用 `-eq` 系列、字符串用 `=`；`[[ ]]` 比 `[ ]` 安全。
- `"$@"` 保留参数边界，`$*` 会拼接；显式 `exit` 让退出码契约明确。
- `set -euo pipefail` + `trap ... EXIT` 是最小健壮骨架；`shellcheck` 做静态检查。

## 练习

1. 三种执行方式（`/tmp/lab12`）：写只做 `PATH=/tmp/lab12/bin:$PATH` 与 `echo $PATH` 的脚本，分别用 `./`、`bash`、`source` 运行，比较 `PATH` 是否留在当前 shell 并解释原因。
2. 引号实验：创建 `my file.txt`，比较 `ls $f` 与 `ls "$f"`；再对照 `for f in $(ls)` 与 `for f in *`，说明哪个会在含空格的文件名上出错。
3. 参数与退出码：写 `args.sh` 打印 `$0`、`$#`、`"$@"`（每个参数加方括号），参数少于 2 个时以退出码 2 结束，用 `echo $?` 验证。
4. 条件与循环：遍历 `/etc` 下 `.conf` 文件，只对普通文件用 `printf` 输出「文件名: 行数」；无匹配时正常退出而非把 `*.conf` 当文件名。
5. 健壮性改造（`/tmp` 演练）：把「健壮性」一节的 `tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT` 片段扩成十行小脚本（在 `$tmp` 里造文件），分别在「有 trap」与「删掉 trap、删掉 `set -euo pipefail`」两个版本里传入不存在的目录制造中途失败，对比是否留下临时目录。
6. 静态检查：装了 `shellcheck` 就对两个示例脚本运行并逐条解释警告；没装先 `pacman -S shellcheck`（第 42 章）。

## 自检

- [ ] 能说出 `./x.sh`、`bash x.sh`、`source x.sh` 对当前 shell 环境的影响差异
- [ ] 能解释为什么默认给变量加双引号，以及 `$@` 与 `"$@"` 的区别
- [ ] 能说出 `set -e`、`set -u`、`pipefail` 各解决什么问题，`set -e` 在哪些位置不生效
- [ ] 能写出带 `local` 的函数，并说明 `return` 返回的是值还是退出码
- [ ] 能解释 `cat file | while read` 为什么让循环内变量消失，正确写法是什么
- [ ] 知道数值与字符串比较各用什么运算符，混用会出什么错
- [ ] 能用 `trap 'rm -rf "$tmp"' EXIT` 保证临时目录被清理

## 参考

- [Bash](https://wiki.archlinux.org/title/Bash)
- [Bash Reference Manual](https://www.gnu.org/software/bash/manual/)
- [ShellCheck](https://www.shellcheck.net/)
