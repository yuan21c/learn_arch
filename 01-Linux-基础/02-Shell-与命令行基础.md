# 第 2 章 Shell 与命令行基础

打开终端看到的只有一行提示符，但它背后有一整套约定：提示符告诉你「谁在哪、以什么身份」，路径告诉你「相对哪里」，引号决定「哪些字符不用解释」。本章把这套约定讲透——它们是后面所有章节的语法基础。

> 本章目标：能读懂提示符与命令的构成；熟练在绝对路径与相对路径之间切换；掌握 `cd/pwd/ls` 的常用选项、通配符与引号规则；会用 `man`、`--help`、`whatis` 自查，并用历史与补全提高输入效率。
> 对应 Wiki：[Command-line shell](https://wiki.archlinux.org/title/Command-line_shell)

## 提示符与命令的构成

提示符通常由「用户名@主机名:当前目录」加一个结束符构成：`$` 表示普通用户，`#` 表示 root。看到提示符就等于 shell 在问：下一条命令是什么。

一条命令的骨架是 `命令名 选项 参数`：

- 选项分两种：短选项 `-l`（可组合成 `-la`）、长选项 `--all`（可带值，如 `--color=never`）。
- 选项也是参数的一种，位置由各命令自己定义；不确定时看帮助，别背。
- `command not found` 意味着 shell 没找到同名程序，与权限无关。

shell 收到输入后先解析引号与变量，再去 `PATH` 环境变量列出的目录里找程序。有的「命令」根本不是程序，而是 shell 内置的 builtin——`cd` 就是典型：

```bash
type cd          # 输出：cd is a shell builtin
command -v ls    # 输出该程序的绝对路径
```

`type` 回答「这个名字到底是什么」；`command -v` 回答「可执行文件在哪」。分清 builtin 与外部程序，才能理解为什么 `cd` 不需要也不应该写全路径。

## 路径：绝对与相对

Linux 只有一棵树，树根是 `/`。路径就是从树上某个节点走到目标的路线，写法只有两种：

| 写法 | 起点 | 例子 | 含义 |
| --- | --- | --- | --- |
| 绝对路径 | 根 `/` | `/etc/hosts` | 任何位置执行都指向同一文件 |
| 相对路径 | 当前工作目录 | `hosts` | 换个目录就指向别的文件 |

三个特殊名字贯穿全书：`.` 是当前目录，`..` 是上一级目录，`~` 是自己的家目录（root 则是 `/root`）。假设当前在 `/var/log`：`cat syslog` 等价于 `cat /var/log/syslog`，而 `cat ../log/syslog` 是绕路上一级再下来。目录之间一律用 `/` 分隔，结尾没有盘符——Windows 的 `C:\` 在这里不存在。

## cd、pwd 与 ls（深讲）

`cd` 切换目录，它几乎没有选项，但有几种写法值得记住：`cd /etc` 去绝对路径，`cd ..` 上一级，`cd -` 回到上一个目录并把它打印出来，裸 `cd` 回家目录。

`pwd` 打印当前目录，它有两个面孔：默认输出**逻辑路径**（你走进来的样子），`pwd -P` 输出**物理路径**（解析符号链接后的真实位置）。在现代发行版里 `/bin` 是指向 `/usr/bin` 的链接，走进去后两种答案不一样（环境：WSL）：

```bash
cd /bin
pwd            # /bin
pwd -P         # /usr/bin
cd -           # 回到刚才的目录，并回显它
```

`ls` 列出目录内容，是最常用的命令，也是选项最值得投入的一个：

| 选项 | 作用 |
| --- | --- |
| `-l` | 长格式：权限、属主、大小、时间 |
| `-a` | 列出以 `.` 开头的隐藏文件（含 `.`、`..`） |
| `-h` | 配合 `-l`，把字节数换算成 K/M/G |
| `-d` | 列目录本身而不是其内容 |
| `-F` | 给条目加类型后缀：目录加 `/`、链接加 `@` |
| `-t` / `-S` | 按修改时间 / 按大小排序 |

默认排序是字母序，与时间、大小无关；长格式里的颜色和首字母只提示类型，不构成权限结论——权限的正式读法在第 6 章。

## 通配符与引号

通配符（glob）让 shell 在**执行命令之前**替你展开文件名：

| 模式 | 含义 | 例子 |
| --- | --- | --- |
| `*` | 任意长度任意字符 | `*.log` 匹配所有日志 |
| `?` | 恰好一个字符 | `ls.??p` 匹配 `ls.tmp` |
| `[abc]` / `[a-z]` | 集合中的一个字符 | `[ab]*` 以 a 或 b 开头 |

引号决定哪些字符交给 shell 解释（环境：WSL，实跑于 /tmp 演练目录）：

```bash
echo *          # 展开为文件列表
echo "*"        # 原样输出 *
echo 'HOME=$HOME'   # 单引号：一律字面量
echo "HOME=$HOME"   # 双引号：变量照常展开
```

两条容易踩的规则：模式匹配不到任何文件时，bash 把模式原样传给命令（于是 `ls nofile-xyz` 报「No such file」，报错来自 `ls` 而不是 shell）；zsh 则直接中止并提示 `no matches found`——同一份脚本在不同 shell 下行为可能不同，本书命令示例以 bash 为准。

## 查找帮助：man、--help 与 whatis

三个入口覆盖三种场景：

- `命令 --help`：GNU 风格的速查摘要，列全选项与一句话说明，适合「就差一个选项」的时刻。实跑 `ls --help` 的前几行（环境：WSL）：

```text
Usage: ls [OPTION]... [FILE]...
List information about the FILEs (the current directory by default).
Sort entries alphabetically if none of -cftuvSUX nor --sort is specified.
```

- `man 命令`：完整手册。章节按主题编号——`man 1 ls` 是用户命令，`man 5 passwd` 是文件格式，`man 7` 是综述；阅读时空格翻页、`/` 搜索、`q` 退出。
- `whatis 命令`：一行摘要，等价于 `man -k 关键字` 的精确查询，用来快速确认「这个命令是不是干那件事的」。

`man` 通常由 `man-db` 提供：若你的系统里 `man` 或 `whatis` 不存在，先用发行版包管理器安装 `man-db`（见 [Man page](https://wiki.archlinux.org/title/Man_page)）。

## 历史与补全

行编辑器（bash 为 [Readline](https://wiki.archlinux.org/title/Readline)）让重复输入变得廉价：

- 上下方向键（或 `Ctrl-P`/`Ctrl-N`）翻历史；`history` 列出最近命令。
- `!前缀` 重跑历史命令，`!!` 重跑上一条；`Ctrl-R` 反向增量搜索，输一半就能召回。
- `Tab` 补全：前缀唯一就补全，按两次列出全部候选；命令名、路径、部分选项都能补。

历史与补全是交互特性，要在自己的终端里练（环境：WSL）。它们的价值在后面会越来越大：第 9 章的综合实验里，你会庆幸自己不用重敲长命令。

## 小结

- 命令 = 命令名 + 选项 + 参数；`type` 区分 builtin 与外部程序，`command -v` 找到程序位置。
- 路径只有绝对与相对两种；`.`、`..`、`~` 是三个特殊名字；`pwd -P` 显示解析链接后的真实目录。
- 通配符在命令执行前展开；匹配失败时 bash 原样传递、zsh 直接报错；引号控制变量与模式是否被解释。
- 帮助三件套：`--help` 查选项、`man` 查全册、`whatis` 查一句话；历史与补全负责减少重复输入。

## 练习

1. 建一个演练目录并布置文件，验证通配符与引号的差别（环境：WSL）：

   ```bash
   mkdir -p /tmp/shell-lab && cd /tmp/shell-lab
   touch a.txt b.log ab.txt
   echo *.txt; echo [ab]*; echo "*.txt"; echo 'HOME=$HOME'
   ```

2. 运行 `cd /bin && pwd && pwd -P`，解释两个输出为什么不同，再用 `cd -` 返回（环境：WSL）。
3. 用 `ls -lFah ~ | head -8` 逐列读懂长格式输出：首字符、权限、链接数、大小、时间分别是什么（环境：WSL）。
4. 运行 `ls --help | head -20`，找一个你会用的选项并当场验证；再运行 `whatis ls`（环境：WSL）。
5. 在交互 shell 中按 `↑` 翻到本章敲过的某条命令，运行 `history 5`，然后用 `Ctrl-R` 搜出含 `pwd` 的一条（环境：WSL）。

## 自检

- [ ] 能说出提示符中 `$` 与 `#` 的区别
- [ ] 能举例区分绝对路径与相对路径，并解释 `.`、`..`、`~`
- [ ] 能解释 `pwd` 与 `pwd -P` 的差别，并说出什么情况下两者不同
- [ ] 能预测 `echo *.txt` 在有匹配、无匹配两种情况下的输出
- [ ] 能说明单引号与双引号对 `$变量` 的不同处理
- [ ] 知道 `--help`、`man`、`whatis` 各自适合什么问题

## 参考

- [Command-line shell](https://wiki.archlinux.org/title/Command-line_shell)
- [Core utilities](https://wiki.archlinux.org/title/Core_utilities)
- [Man page](https://wiki.archlinux.org/title/Man_page)
- [Readline](https://wiki.archlinux.org/title/Readline)
- [Bash](https://wiki.archlinux.org/title/Bash)
