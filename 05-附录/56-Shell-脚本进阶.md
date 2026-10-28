# 第 56 章 Shell 脚本进阶

第 12 章把脚本写到「能用」：变量、条件、循环、函数、退出码 0/1/126/127。这一章补真正决定脚本可维护性的几块：数组与参数解析、调试手段、退出码 128+N 的来源，以及临时目录与清理的正确姿势。WSL 读者还会撞上一个 Windows 特产：编辑器把脚本存成 CRLF。

> 本章目标：会排查 CRLF 行尾问题；能用数组与 `shift`/`getopts` 组织输入；会用 `bash -n`/`bash -x` 调试并读懂 `128+N` 退出码；能用 `mktemp` + `trap` 写出安全的临时文件脚手架；知道 shellcheck 的用法。
> 对应 Wiki：[Bash](https://wiki.archlinux.org/title/Bash)、[Command-line shell](https://wiki.archlinux.org/title/Command-line_shell)

## 第一坑：CRLF 行尾

Windows 编辑器保存的脚本每行末尾多一个 `\r`，bash 把 `#!/bin/bash\r` 当成不存在的解释器，报 `bad interpreter: /bin/bash^M`；更隐蔽的是 `if`/`fi` 因 `\r` 匹配不上而语法错误。排查与修复（环境：WSL）：

```bash
file script.sh        # 出现 "with CRLF line terminators" 即中招
bash -n script.sh     # 语法检查，常报 $'\r': command not found 类错误
sed -i 's/\r$//' script.sh    # 就地去掉 \r
# 或装 dos2unix 后：dos2unix script.sh
```

预防：编辑器里把该文件的行尾设为 LF；在 `/mnt/c` 上的脚本尤其要查。`tr -d '\r' < file > new` 是不装 dos2unix 时的替代。

## 数组：一组值按序号取

bash 数组从 0 编号，声明与取用各一行（环境：WSL，实跑）：

```bash
files=(a.txt b.txt "c d.txt")
echo "${files[1]}"        # b.txt
echo "${#files[@]}"       # 3，元素个数
echo "${files[@]}"        # 全部元素
for f in "${files[@]}"; do echo ">> $f"; done
```

两条铁律：展开全部元素永远写 `"${arr[@]}"`（不带引号会被空格和通配符拆散）；未赋值下标在 `set -u` 下会报错，用 `"${arr[i]:-默认}"` 兜底。关联数组用 `declare -A map; map[key]=val`，键是字符串。

## 参数解析：shift 与 getopts

`$1..$9`、`$#`、`$@` 是位置参数（第 12 章）；参数一多就该用解析循环：

```bash
#!/bin/bash
while getopts 'n:v' opt; do
  case "$opt" in
    n) name="$OPTARG" ;;
    v) verbose=1 ;;
    *) echo "用法: $0 [-n 名字] [-v]" >&2; exit 2 ;;
  esac
done
shift $((OPTIND - 1))     # 丢掉已解析的选项，剩下的位置参数重新从 $1 开始
echo "name=$name rest=$*"
```

`getopts` 处理短选项（`-n foo`），冒号表示该选项带参数；长选项（`--name`）要手写 `case "$1" in --name) ...; shift ;;` 循环。`shift N` 把前 N 个参数丢掉，是手工解析的标准收尾。

## 退出码 128+N：被信号杀死

第 12 章的 0/1/126/127 之外，还有一段是 `128+N`：进程被信号 N 杀死时退出码为 128+N。常见值：

| 退出码 | 来源 | 场景 |
| --- | --- | --- |
| 130 | 128+SIGINT(2) | 你按了 Ctrl-C |
| 143 | 128+SIGTERM(15) | `kill` 默认、服务停止 |
| 137 | 128+SIGKILL(9) | `kill -9`、OOM killer |

```bash
sleep 100 & pid=$!
kill "$pid"; wait "$pid"; echo "$?"     # 143
```

脚本里判断退出码时把「被信号杀」与「自己 exit 的错误码」分开处理；清理逻辑不要依赖退出码数值，交给 `trap`（下一节）。

## 调试三板斧

```bash
bash -n script.sh        # 只查语法，不执行
bash -x script.sh        # 每条命令展开后打印（+ 前缀），看变量到底是什么
PS4='+ $LINENO: ' bash -x script.sh   # 带行号的跟踪
```

`bash -x` 的输出把变量展开、分支走向全部摊开，是「逻辑明明对却不工作」的首选。注意 `set -u` 的边界：它只拦**未定义**变量，不拦空值——`rm -rf "$DIR"/` 在 `DIR=""` 时仍是删根的元凶，用 `"${DIR:?DIR is empty}"` 或显式 `[ -n "$DIR" ] || exit 1` 兜底（第 51 章有对应的坑）。

## 安全脚手架：mktemp 与 trap

临时目录自己 `mkdir /tmp/my.$$` 有竞态与残留两个问题，标准姿势是 `mktemp -d` 加退出清理：

```bash
#!/bin/bash
set -eu
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT     # 正常退出、报错、Ctrl-C 都会清理
cp -r src/* "$tmp"/
# …在 $tmp 里干活…
```

`trap '…' EXIT` 挂在退出路径上，`set -e` 中途失败也能触发；要区分清理与调试，可临时注释 trap 看中间产物。**删变量拼出来的路径一律加引号与 `--`**：`rm -rf -- "$tmp/"`，别裸拼（`rm -rf $DIR/` 的事故见第 51 章）。

## shellcheck：静态体检

`shellcheck script.sh` 能抓出引号缺失、未引用展开、`$?` 被覆盖这类肉眼难查的问题（安装方法见第 25 章）。它是 lint 不是测试：能指出「哪里可能坏」，不保证「逻辑对」。建议把 `shellcheck` 与 `bash -n` 放进提交前检查。

## 小结

- Windows 编辑器的 CRLF 是脚本第一坑：`file` 查、`dos2unix`/`sed` 修。
- 数组展开永远 `"${arr[@]}"`；`getopts` + `shift $((OPTIND-1))` 是参数解析的标准件。
- 退出码 128+N 表示被信号杀死：130 Ctrl-C、143 TERM、137 KILL。
- 调试用 `bash -n` 查语法、`bash -x` 看展开；`set -u` 不拦空值，空变量删根要用 `${DIR:?}`。
- 临时目录用 `mktemp -d` + `trap … EXIT`；shellcheck 做提交前静态体检。

## 练习

1. 故意造一个 CRLF 脚本（`printf '#!/bin/bash\r\necho hi\r\n' > crlf.sh`），依次用 `file`、`bash` 执行、`dos2unix`/`sed` 修复，记录三步输出（环境：WSL；预期：报 `^M` 相关错误后修复成功）。
2. 写脚本 `args.sh`：用 `getopts` 接受 `-n 名字` 与 `-v`，剩余参数逐行打印（环境：WSL；预期：`args.sh -n foo x y` 输出 `name=foo` 与 x、y）。
3. 观察信号退出码：`sleep 100 &` 后分别用 `kill`（默认）与 `kill -9`，`wait` 读退出码并对照 128+N 表（环境：WSL；预期：143 与 137）。
4. 把练习 2 的脚本改成带 `mktemp -d` + `trap` 的版本，故意在中途 `exit 1`，确认临时目录被清理（环境：WSL；预期：`ls /tmp` 中无残留目录）。
5. 对自己的任意脚本跑 `bash -x`，找一个被展开后才暴露的问题（环境：WSL；预期：能指出一行跟踪输出证明问题）。
6. 阅读题：解释 `set -u` 为什么拦不住 `rm -rf "$DIR"/` 的空值事故（环境：阅读题）。

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
