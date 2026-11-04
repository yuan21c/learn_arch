# 第 15 章 Shell 脚本进阶

第 14 章把脚本写到「能用」：变量、条件、循环、函数、退出码 0/1/126/127。这一章补真正决定脚本可维护性的几块：数组与参数解析、调试手段、退出码 128+N 的来源，以及临时目录与清理的正确姿势。脚本从其他平台拷过来时，还会撞上一个坑：编辑器把行尾存成 CRLF。

> 本章目标：会排查 CRLF 行尾问题；能用数组与 `shift`/`getopts` 组织输入；会用 `bash -n`/`bash -x` 调试并读懂 `128+N` 退出码；能用 `mktemp` + `trap` 写出安全的临时文件脚手架；知道 shellcheck 的用法。
> 对应 Wiki：[Bash](https://wiki.archlinux.org/title/Bash)、[Command-line shell](https://wiki.archlinux.org/title/Command-line_shell)

## 第一坑：CRLF 行尾

从其他平台拷来的脚本每行末尾可能多一个 `\r`，bash 把 `#!/bin/bash\r` 当成不存在的解释器，报 `bad interpreter: /bin/bash^M`；更隐蔽的是 `if`/`fi` 因 `\r` 匹配不上而语法错误。排查与修复：

```bash
file script.sh # 出现 "with CRLF line terminators" 即中招
bash -n script.sh # 只查语法（报 syntax error）；$'\r': command not found 属执行期错误，排查 CRLF 以 file 结果为准
sed -i 's/\r$//' script.sh # 就地去掉 \r
# 或装 dos2unix 后：dos2unix script.sh
```

预防：编辑器里把该文件的行尾设为 LF；从共享目录拷来的脚本尤其要查。`tr -d '\r' < file > new` 是不装 dos2unix 时的替代。

## 数组：一组值按序号取

bash 数组从 0 编号，声明与取用各一行（实跑）：

```bash
files=(a.txt b.txt "c d.txt")
echo "${files[1]}" # b.txt
echo "${#files[@]}" # 3，元素个数
echo "${files[@]}" # 全部元素
for f in "${files[@]}"; do echo ">> $f"; done
```

两条铁律：展开全部元素永远写 `"${arr[@]}"`（不带引号会被空格和通配符拆散）；未赋值下标在 `set -u` 下会报错，用 `"${arr[i]:-默认}"` 兜底。关联数组用 `declare -A map; map[key]=val`，键是字符串。

## 参数解析：shift 与 getopts

`$1..$9`、`$#`、`$@` 是位置参数（第 14 章）；参数一多就该用解析循环：

```bash
#!/bin/bash
while getopts 'n:v' opt; do
 case "$opt" in
 n) name="$OPTARG" ;;
 v) verbose=1 ;;
 *) echo "用法: $0 [-n 名字] [-v]" >&2; exit 2 ;;
 esac
done
shift $((OPTIND - 1)) # 丢掉已解析的选项，剩下的位置参数重新从 $1 开始
echo "name=$name rest=$*"
```

`getopts` 处理短选项（`-n foo`），冒号表示该选项带参数；长选项（`--name`）要手写 `case "$1" in --name) ...; shift ;;` 循环。`shift N` 把前 N 个参数丢掉，是手工解析的标准收尾。

## 退出码 128+N：被信号杀死

第 14 章的 0/1/126/127 之外，还有一段是 `128+N`：进程被信号 N 杀死时退出码为 128+N。注意 `128+N` 是 shell 对 wait status 的报告约定，程序也可以主动 `exit 137`，仅凭数字不能断定是被信号杀死。常见值：

| 退出码 | 来源 | 场景 |
| ------ | --------------- | --------------------- |
| 130 | 128+SIGINT(2) | 你按了 Ctrl-C |
| 143 | 128+SIGTERM(15) | `kill` 默认、服务停止 |
| 137 | 128+SIGKILL(9) | `kill -9`、OOM killer |

```bash
sleep 100 & pid=$!
kill "$pid"; wait "$pid"; echo "$?" # 143
```

脚本里判断退出码时把「被信号杀」与「自己 exit 的错误码」分开处理；可靠区分要看原始 wait status 或日志（如 systemd journal 里的信号记录），不能只凭 `128+N` 反推；清理逻辑不要依赖退出码数值，交给 `trap`（下一节）。

## 调试三板斧

```bash
bash -n script.sh # 只查语法，不执行
bash -x script.sh # 每条命令展开后打印（+ 前缀），看变量到底是什么
PS4='+ $LINENO: ' bash -x script.sh # 带行号的跟踪
```

`bash -x` 的输出把变量展开、分支走向全部摊开，是「逻辑明明对却不工作」的首选。注意 `set -u` 的边界：它只拦**未定义**变量，不拦空值——`rm -rf "$DIR"/` 在 `DIR=""` 时仍会展开成 `rm -rf /`（加引号不解决空值问题；GNU `rm` 默认 `--preserve-root` 会拒绝删根，但不要依赖它，`"$DIR"/*` 仍会清空根下内容），必须用 `"${DIR:?DIR is empty}"` 或显式 `[ -n "$DIR" ] || exit 1` 兜底（第 104 章有对应的坑）。

## 安全脚手架：mktemp 与 trap

临时目录自己 `mkdir /tmp/my.$$` 有竞态与残留两个问题，标准姿势是 `mktemp -d` 加退出清理：

```bash
#!/bin/bash
set -eu
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT # 正常退出、报错、Ctrl-C 都会清理
cp -r src/* "$tmp"/
# …在 $tmp 里干活…
```

`trap '…' EXIT` 挂在退出路径上，`set -e` 中途失败也能触发；要区分清理与调试，可临时注释 trap 看中间产物。**删变量拼出来的路径一律加引号与 `--`**：`rm -rf -- "$tmp/"`，别裸拼（`rm -rf $DIR/` 的事故见第 104 章）。

## shellcheck：静态体检

`shellcheck script.sh` 能抓出引号缺失、未引用展开、`$?` 被覆盖这类肉眼难查的问题（安装方法见第 42 章）。它是 lint 不是测试：能指出「哪里可能坏」，不保证「逻辑对」。建议把 `shellcheck` 与 `bash -n` 放进提交前检查。

## 失败模式

- **数组不加引号展开**：`${arr[@]}` 不加引号会按空白拆分，元素含空格即错；永远写 `"${arr[@]}"`。
- **`getopts` 忘了 `shift $((OPTIND-1))`**：解析完选项后位置参数还停在选项上，后续 `"$@"` 会把 `-n foo` 当成数据。
- **CRLF 混入**：跨平台编辑器保存的脚本带 `\r`，shebang 会变成 `#!/bin/bash\r`，报「找不到命令」；用 `file` 查、`dos2unix` 修。
- **把 `128+N` 当成可靠分类**：程序也可以主动 `exit 137`；只能作为线索，不能作为「被信号杀死」的证据。
- **`mktemp` 之后才 `trap`**：创建与清理之间失败会残留；顺序必须是「先建资源，立刻挂 trap」。
- **`trap` 里再出错**：清理命令失败会掩盖原始退出码；清理逻辑要容错（`rm -f`、`|| true`），并保留原退出码。
- **空变量拼路径**：`rm -rf "$DIR"/` 在 `DIR=""` 时等于清根；用 `"${DIR:?}"` 或显式非空判断。
- **`source` 与执行混淆**：`source` 在当前 shell 生效、能改环境；`bash script.sh` 在子进程跑，变量出不来。

## 验证与回滚

| 操作 | 验证 | 回滚 |
| ------------------------ | ------------------------------------------ | ------------------------------------------ |
| 语法与展开 | `bash -n`；`PS4='+ $LINENO: ' bash -x` 逐行看 | 修脚本，重新运行 |
| 临时目录 | `mktemp -d` 路径打印出来；`trap` 后手动中断验证清理 | 目录在 `/tmp`，删除即可 |
| 参数解析 | 用带空格、带空值、带 `--` 的参数各跑一次 | 调整 `getopts` 循环，不涉及系统状态 |
| 删除类操作 | 先把 `rm` 换成 `printf '%q\n'` 干跑清单 | 有备份/快照才能恢复 |

进阶脚本的风险集中在「看不见的展开」与「清理路径」：`bash -x` 把展开摊开，`trap` 把清理兜住，这两件事做好，大多数事故可以在测试阶段拦住。

## 取舍边界

- **bash 数组 vs 换行分隔的字符串**：数组能保留元素边界，适合参数与文件列表；换行字符串简单，但遇文件名含换行会出错。能选数组就选数组。
- **`getopts` vs 手工长选项**：短选项用 `getopts`；需要 `--name=value` 时手工 `case`/`shift`，或换 Python 的 `argparse`。
- **调试输出 vs 日志**：临时排查用 `bash -x`；长期运行把关键步骤写 stderr，别把调试输出留在生产脚本里。
- **shell 进阶 vs 换语言**：数组、`getopts`、`trap` 足够支撑中等脚本；出现嵌套哈希、并发、重试状态机时，维护成本会超过重写成本。
- **可移植性 vs 可读性**：POSIX sh 能跑在更多环境，但缺少数组与 `[[ ]]`，代码会更啰嗦；目标环境固定时，优先可读的 bash。

## 小结

- 跨平台拷贝的 CRLF 是脚本第一坑：`file` 查、`dos2unix`/`sed` 修。
- 数组展开永远 `"${arr[@]}"`；`getopts` + `shift $((OPTIND-1))` 是参数解析的标准件。
- 退出码 128+N 表示被信号杀死：130 Ctrl-C、143 TERM、137 KILL。
- 调试用 `bash -n` 查语法、`bash -x` 看展开；`set -u` 不拦空值，空变量删根要用 `${DIR:?}`。
- 临时目录用 `mktemp -d` + `trap … EXIT`；shellcheck 做提交前静态体检。

## 练习

1. 故意造一个 CRLF 脚本（`printf '#!/bin/bash\r\necho hi\r\n' > crlf.sh`），依次用 `file`、`bash` 执行、`dos2unix`/`sed` 修复，记录三步输出（预期：报 `^M` 相关错误后修复成功）。
2. 写脚本 `args.sh`：用 `getopts` 接受 `-n 名字` 与 `-v`，剩余参数逐行打印（预期：`args.sh -n foo x y` 输出 `name=foo` 与 x、y）。
3. 观察信号退出码：`sleep 100 &` 后分别用 `kill`（默认）与 `kill -9`，`wait` 读退出码并对照 128+N 表（预期：143 与 137）。
4. 把练习 2 的脚本改成带 `mktemp -d` + `trap` 的版本，故意在中途 `exit 1`，确认临时目录被清理（预期：`ls /tmp` 中无残留目录）。
5. 对自己的任意脚本跑 `bash -x`，找一个被展开后才暴露的问题（预期：能指出一行跟踪输出证明问题）。
6. 阅读题：解释 `set -u` 为什么拦不住 `rm -rf "$DIR"/` 的空值事故。

## 自检

- [ ] 能在 30 秒内定位并修复 CRLF 问题
- [ ] 会写 `"${arr[@]}"` 安全展开与 `getopts` 解析
- [ ] 能说出 130/137/143 各自对应的信号
- [ ] 会用 `bash -n`/`bash -x`/`PS4` 三板斧调试
- [ ] 写脚本时默认带 `mktemp -d` + `trap` 脚手架

## 参考

- [Bash](https://wiki.archlinux.org/title/Bash)
- [Bash/Keyboard shortcuts](https://wiki.archlinux.org/title/Bash/Keyboard_shortcuts)
- [Core utilities](https://wiki.archlinux.org/title/Core_utilities)
