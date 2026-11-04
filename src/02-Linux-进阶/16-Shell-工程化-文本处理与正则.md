# 第 16 章 Shell 工程化、文本处理与正则

第 14、15 章解决的是「一段脚本能不能正确运行」：引号、条件、循环、`set -euo pipefail`、`trap`、CRLF 与退出码。这一章换一个问法：**同一套脚本要交给别人用、要在半年后自己还看得懂、要在出错时查得出来**，需要哪些约定与工具。语法在第 14 章已经讲完，本章不再重复；这里只处理三件事的边界——工程化的目录与接口、文本处理的工具分工、正则的方言差异。

> 本章目标：能为一个多脚本项目划出可维护的目录与入口约定；分清 `grep`/`sed`/`awk`/`find`/`xargs` 各自该干什么、不该干什么；理解 BRE、ERE、PCRE 三种正则方言的差异并知道何时该换工具；掌握「先干跑、再就地改、留备份」的文本修改闭环；能判断什么时候 shell 已经不够、应该改用 Python。
> 对应 Wiki：[Bash](https://wiki.archlinux.org/title/Bash)、[Core utilities](https://wiki.archlinux.org/title/Core_utilities)、[Grep](https://wiki.archlinux.org/title/Grep)

## 工程化：从「一个 .sh」到「一个能维护的项目」

单人临时脚本可以只有五行；一旦要被别人调用、被定时任务调用、在另一台机器上跑，就必须固定四样东西。它们不是风格偏好，而是失败时能不能定位的前提：

| 约定 | 具体做法 | 不这么做会怎样 |
| ---------- | ---------------------------------------------- | ---------------------------------- |
| 入口唯一 | `bin/` 下每个脚本一个入口，文件名即命令名 | 调用方靠记忆敲路径，改名即断链 |
| 配置外置 | 环境变量或 `config/` 文件，脚本内不写死机器相关值 | 换机器要改代码，改动无法评审 |
| 日志统一 | 全部写 stderr，格式固定，需要落盘时由调用方重定向 | 日志散落各处，出事无法按时间线拼接 |
| 依赖显式 | 开头检查命令是否存在（`command -v`），缺了就退出 | 跑到一半才报 `command not found`，留下半成品 |

一个够用的骨架（`/tmp` 演练，不依赖任何外部项目）：

```bash
mkdir -p /tmp/lab16/{bin,lib,config,var/log} && cd /tmp/lab16
cat > bin/report.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
readonly SELF_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../lib/common.sh
source "$SELF_DIR/../lib/common.sh"
need curl jq
main() { log "start"; "$@"; log "done"; }
main "$@"
EOF
cat > lib/common.sh <<'EOF'
log() { printf '%s %s\n' "$(date -Is)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
need() { for c in "$@"; do command -v "$c" >/dev/null || die "missing: $c"; done; }
EOF
chmod +x bin/report.sh
```

`BASH_SOURCE[0]` 取脚本自身路径，再 `cd` 到它所在目录，是为了让脚本**从任何工作目录调用都成立**——`$0` 在 `source` 场景下指向调用者，不可靠；`BASH_SOURCE` 才指向被 source 的文件。`readonly` 防止后续代码意外覆盖路径。`log` 全部走 stderr，是为了让 stdout 保持「只输出数据」，这样脚本可以安全地出现在管道里。

## 文本处理：四件工具的分工

Linux 的文本处理工具不是互相替代，而是各管一段。把它们混用的典型症状是「一条命令写了三层管道，还看不懂中间结果」：

| 工具 | 输入 | 输出 | 该干的事 | 不该干的事 |
| -------- | -------------- | -------------- | ------------------------ | -------------------------- |
| `grep` | 行流 | 匹配的行 | 筛选、计数、取行号 | 改内容、做字段运算 |
| `sed` | 行流 | 改写的行 | 单行替换、删除、按行范围处理 | 跨行结构化计算 |
| `awk` | 行流（分字段） | 计算后的行/数值 | 字段提取、聚合、条件统计 | 复杂状态机、多文件关联 |
| `find` | 目录树 | 路径列表 | 按属性找文件、批量执行 | 处理文件内容 |

一条命令只做一段，中间结果可疑就拆开看。下面是同一次任务的三种写法，差别不在长短，而在**出错时能不能定位**（`/tmp` 演练，先造样本）：

```bash
mkdir -p /tmp/lab16/data && cd /tmp/lab16/data
printf 'alpha 10\nbeta 20\ngamma 30\nalpha 40\n' > a.txt
printf 'beta 50\ndelta 60\n' > b.txt
grep -c '^alpha' a.txt # 2：计数，只读
awk '$2 > 25 { print $1, $2 * 2 }' a.txt # 字段运算，只读
awk '{ s[$1] += $2 } END { for (k in s) print k, s[k] }' a.txt b.txt # 跨文件聚合
```

`awk` 的 `$1`、`$2` 是按字段取，默认分隔符是「连续空白」；要按冒号切 `/etc/passwd`，写 `awk -F: '{ print $1, $3 }'`。`sed` 与 `grep` 都是**行流**工具，不会替你理解 CSV 的引号转义——遇到真正的结构化格式（CSV、JSON、YAML），正确做法是换 `jq`、`yq` 或 Python，而不是把正则越写越长。

## 正则：三种方言，别拿一种的经验套另一种

同一个「提取 IPv4 地址」的表达式，在三种方言里写法不同，能用的语法也不同：

| 方言 | 谁在用 | 特点 | 典型差异 |
| -------- | ---------------------------- | ------------------------------ | ------------------------------------ |
| BRE | `grep` 默认、`sed` 默认 | 元字符要转义才有特殊含义 | `\+`、`\?`、`\|` 才表示量词与或 |
| ERE | `grep -E`、`awk` | 元字符默认特殊 | `+`、`?`、`|`、`()` 直接可用 |
| PCRE | `grep -P`、`perl`、多数语言 | 功能最全，支持惰性、断言、命名组 | `\d`、`\b`、`(?=...)` 可用 |

三条硬事实：`grep` 默认是 BRE，写 `grep 'a+'` 会去找字面量 `a+`，要写成 `grep -E 'a+'` 或 `grep 'a\+'`；`sed` 的替换里 `\(` `\)` 是分组，`\1` 是反向引用，而 `sed -E` 下分组写成 `()`；`grep -P` 在 GNU grep 上可用，但**不是所有系统都有**，脚本里依赖它要先 `command -v grep` 并实测（`grep -P` 在部分 BSD 系与旧版本上不可用）。

```bash
printf 'ip=192.0.2.10\n' | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}' # ERE：提取地址
printf 'a1b22\n' | sed -E 's/([a-z])([0-9]+)/\2-\1/g' # ERE 分组与反向引用
printf 'x=1 y=2\n' | grep -P '(?<=x=)\d+' # PCRE 后行断言，仅 -P 支持
```

正则的**边界**比语法更重要：正则匹配的是**行**，不是文档结构；`.*` 在默认模式下不跨行；贪婪匹配在长行上会回溯到卡死（对大文件用 `grep -F` 做字面量匹配，或用 `awk index()`）。遇到「匹配嵌套括号」「解析 HTML/JSON」这类需求，说明正则已到能力边界，该换解析器。

## 文件级操作：find 与 xargs 的安全组合

`find` 输出路径，`xargs` 把路径变成参数——两个工具之间最容易出事的地方是**文件名里的空格与换行**。正确写法是两端都用 NUL 分隔：

```bash
find /tmp/lab16/data -type f -name '*.txt' -print0 | xargs -0 wc -l # 安全：空格/换行都不拆
find /tmp/lab16 -type f -name '*.log' -mtime +7 -print # 先只打印，确认范围
```

不要写 `for f in $(find ...)`：命令替换会按空白拆分，文件名带空格就断成两个参数；也不要在 `find` 的 `-exec` 里拼未加引号的 `{}`。`find ... -delete` 与 `-exec rm {} \;` 都是**写操作**，执行前先用 `-print` 干跑一遍——这一步能拦住绝大多数误删。

## 就地修改：先干跑，再备份，最后替换

`sed -i` 直接改原文件，没有撤销。工程上的固定闭环是三步：

```bash
sed 's/old/new/g' file > /tmp/preview && diff -u file /tmp/preview # 1. 干跑：看差异
sed -i.bak 's/old/new/g' file # 2. 就地改，同时留 file.bak
diff -u file.bak file && echo "verify ok" # 3. 验证；不满意就 mv file.bak file 回滚
```

`-i.bak` 的后缀是备份文件扩展名，`sed -i` 不带后缀时不留备份。批量改多个文件时，`sed -i.bak` 会为每个文件生成独立备份，回滚要逐个恢复——更稳的做法是整目录先 `cp -a` 或放进 git，改完用 `git diff` 审阅。**任何「一次改上百个文件」的操作，都应该先有版本控制或快照，`sed -i` 本身不提供回滚。**

## 失败模式

- **方言错配**：在 `sed` 里写 ERE 的 `+`，结果没替换却也不报错——静默失败最危险，先小样本验证一条规则。
- **贪婪与回溯**：长行上的 `.*.*` 会指数级回溯，表现为命令「卡住」；用 `grep -F` 或换 `awk` 按字段处理。
- **`grep` 退出码**：`grep` 没匹配到返回 `1`，在 `set -e` 脚本里会直接终止——这是「正常无匹配」被当成错误，要么用 `grep ... || true`，要么放进 `if`。
- **管道吞掉失败**：`cmd | grep ...` 里前一段失败但 `grep` 成功，整条管道仍算成功；`set -o pipefail` 才能暴露。
- **xargs 无输入仍执行**：某些实现下空输入会跑一次不带参数的命令，加 `-r`（GNU）避免。
- **原地改编码**：`sed -i` 按字节处理，遇到 UTF-8 多字节字符做「按字符」的替换会错位；需要字符级处理时用 `perl -CSD -i` 或 Python。

## 验证与回滚

| 操作 | 验证 | 回滚 |
| ------------------ | ------------------------------------ | ------------------------------------ |
| 批量筛选 | 先用小样本跑，`grep -c` 对数量 | 只读，无副作用 |
| `sed` 替换 | `diff -u 原文件 预览` | 保留 `.bak`，`mv` 回去 |
| 批量改文件 | 改前 `git status` 干净、改后 `git diff` | `git restore`（仅已跟踪文件） |
| `find -delete` | 先用 `-print` 干跑，核对数量 | 无内置回滚，只能靠备份或快照 |

判断标准很具体：**改动前后的差异必须能在一屏内看完**。如果 `diff` 输出几百行，说明这次改动范围过大，应该拆成几批，每批一个可验证的小目标。

## 取舍边界

什么时候不该用 shell：shell 擅长「调用命令 + 串流程」，不擅长「数据结构 + 错误处理 + 并发」。出现以下任一信号，就该换 Python（或 Go）：

- 需要解析 JSON/XML/YAML/CSV 的嵌套结构，正则越写越长；
- 需要真正的数组、字典、异常栈，而不是字符串拼装；
- 需要并发、重试策略、超时控制，且要求可测试；
- 逻辑超过约 200 行，或有两个以上人维护。

反过来，**能用 shell 就别上 Python**：一次性文件整理、服务启停编排、CI 里的几步命令，shell 更短、更贴近系统、无需运行时。分界线不是语言优劣，而是**数据结构的复杂度**：数据是「行与字段」用 shell，是「对象与关系」用 Python。

## 小结

- 工程化四约定：入口唯一、配置外置、日志走 stderr、依赖显式检查；`BASH_SOURCE` 取自身路径，保证从任意目录可调用。
- 四件工具分工：`grep` 筛行、`sed` 改行、`awk` 算字段、`find` 找路径；结构化格式换 `jq`/`yq`/Python。
- 三种正则方言：BRE（默认，元字符需转义）、ERE（`-E`，元字符默认特殊）、PCRE（`-P`，功能最全但非处处可用）。
- 文件名安全：`find -print0` 配 `xargs -0`；永不 `for f in $(find ...)`。
- 就地修改闭环：干跑 → `-i.bak`/版本控制 → `diff` 验证 → 可回滚；差异要能一屏看完。
- shell 与 Python 的分界是数据结构复杂度，不是代码行数的绝对门槛。

## 练习

1. 工程骨架（`/tmp` 演练）：按正文建 `/tmp/lab16`，从 `/` 和 `/tmp` 两个不同目录各调用一次 `bin/report.sh`，验证 `SELF_DIR` 解析正确；故意把 `lib/common.sh` 改名，观察 `source` 失败时的报错。
2. 方言对照（`/tmp` 演练）：对 `printf 'aaa\n'` 依次运行 `grep 'a\+'`、`grep -E 'a+'`、`grep 'a+'`，记录哪条匹配、哪条不匹配，并解释 BRE 与 ERE 的差异。
3. 字段与聚合：用正文的 `a.txt`/`b.txt`，写 `awk` 统计每个名字的总和并按数值降序输出（提示：`END` 里存数组，输出后交给 `sort -k2 -nr`）。
4. 空格文件名（`/tmp` 演练）：创建 `my file.txt` 与 `other.txt`，分别用 `for f in $(find ...)` 和 `find -print0 | xargs -0` 统计行数，记录前者如何出错、后者为何正确。
5. 就地修改闭环（`/tmp` 演练）：复制一份 `/etc/hosts` 到 `/tmp`，用 `sed -i.bak` 把 `127.0.0.1` 改成 `127.0.0.2`，`diff` 验证后 `mv` 回滚；再用不带 `.bak` 的版本重复一次，说明为什么第二次没有退路。
6. 边界判断：给出四个任务——(a) 找出 `/var/log` 下 7 天前的 `.log`；(b) 统计 JSON 日志里每个状态码的数量；(c) 把一批文件名里的空格换成下划线；(d) 解析 YAML 配置并合并两个文件。分别判断用 shell 还是 Python，并写出理由。

## 自检

- [ ] 能说出工程化四约定，以及 `BASH_SOURCE` 与 `$0` 的区别
- [ ] 能按「筛行/改行/算字段/找路径」给 `grep`、`sed`、`awk`、`find` 分工
- [ ] 能说出 BRE、ERE、PCRE 三者的元字符规则差异，并知道 `grep -P` 不保证可用
- [ ] 能写出 `find -print0 | xargs -0` 并解释它解决什么问题
- [ ] 能完整描述「干跑 → 备份 → 替换 → diff 验证 → 回滚」的闭环
- [ ] 能判断一个文本任务该留在 shell 还是换 Python，并给出具体信号

## 参考

- [Bash](https://wiki.archlinux.org/title/Bash)
- [Core utilities](https://wiki.archlinux.org/title/Core_utilities)
- [Grep](https://wiki.archlinux.org/title/Grep)
- [Bash Reference Manual](https://www.gnu.org/software/bash/manual/)
