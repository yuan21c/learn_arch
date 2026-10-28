# 第 10 章 环境变量与 Shell 配置

同一条命令在你这里能跑、在脚本里报 `command not found`，差别几乎总在环境变量与启动文件。本章讲清三件事：变量如何变成环境传给子进程、`PATH` 如何决定命令查找、shell 启动时按什么顺序读哪些文件——掌握这三件，「我的环境不对」类问题就有了排查路径。

> 本章目标：区分 shell 变量与环境变量，会用 `export`、`env`、`printenv`、`unset` 管理并解释作用域；能拆解 `PATH`、用 `type -a`/`command -v`/`hash` 诊断命令查找；能说出 bash 登录式与交互式启动各自读哪些文件并实测验证；掌握 alias 的展开时机与脚本中的限制；知道常用 shell 的差异与切换入口。
> 对应 Wiki：[Environment variables](https://wiki.archlinux.org/title/Environment_variables)、[Bash](https://wiki.archlinux.org/title/Bash)

## 变量、环境与 export

shell 里定义变量写作 `NAME=value`（等号两边都不能有空格），读取写作 `$NAME`。关键在于**作用域**：普通变量只活在当前 shell，`export` 过的变量会进入「环境」，被子进程继承。实跑对照（环境：WSL）：

```bash
export MYVAR=hello
bash -c 'echo "child sees: $MYVAR"'    # child sees: hello
unset MYVAR
bash -c 'echo "child after unset: [$MYVAR]"'    # child after unset: []
```

`export 变量名` 把已有的 shell 变量提升为环境变量，`declare -x` 同义（`declare -p 名字` 查看单个变量的完整声明）；`export -p` 与 `env`、`printenv` 都能列出当前环境（`env` 还能带着环境执行命令）。`unset` 删除变量。一个常见误会：`MYV=only-this bash -c 'echo $MYV'` 能打印值，但**只对这一条命令生效**——外层 shell 并没有这个变量，这种临时赋值是脚本里限定作用域的常用手法。

系统自带一批重要变量，用途先混个脸熟：

| 变量     | 作用                                    |
| -------- | --------------------------------------- |
| `PATH`   | 命令查找目录列表（下一节的主角）        |
| `HOME`   | 家目录，`~` 就是它                      |
| `PWD`    | 当前工作目录                            |
| `PS1`    | 交互提示符的样式                        |
| `LANG`   | 语言与区域设置（中文乱码先查它）        |
| `TERM`   | 终端类型，决定转义序列怎么发            |
| `EDITOR` | 默认编辑器，很多工具（含 `visudo`）读它 |

排查环境被污染时，`env -i 命令` 在**空环境**里执行（实测 `env -i ls` 正常工作）——如果空环境下就好了，说明问题出在某个变量上，再逐个加回来。

## PATH：命令查找的全部真相

第 2 章说过 shell 到 `PATH` 列出的目录里找程序；现在把这句话拆到底。`PATH` 是**冒号分隔的目录列表**，查找按书写顺序进行，命中即止。`type -a` 会按 PATH 顺序列出一个名字的全部匹配（环境：WSL，实跑）：

```text
$ type -a ls
ls is /usr/sbin/ls
ls is /usr/bin/ls
ls is /sbin/ls
ls is /bin/ls
```

四个路径其实指向同一个程序（`/usr/sbin`、`/sbin` 在 Arch 上是链接），但顺序暴露了 PATH 的排列。三个配套工具：`command -v 名字` 输出**第一个**匹配（脚本里判断「程序存在吗」用它）；`type` 区分别名/函数/内置/外部程序；`hash` 是 bash 的查找缓存——它记住上次执行的位置（实测 `hash -r` 后显示 `hash table empty`），程序路径变动后用 `hash -r` 清缓存。

PATH 的四个事故多发点：

- **顺序错**：自装的同名程序排在系统目录前，会遮蔽正版命令；反之排太后则「装了找不到」。
- **被整体覆盖**：脚本里写 `PATH=/my/tools` 会把系统路径冲掉，后面 `ls` 全部阵亡——正确写法 `PATH=/my/tools:$PATH`。
- **空条目**：PATH 里出现连续冒号或以冒号结尾，等于把**当前目录**加入查找，恶意同名文件可能被你误执行——生产环境不要留空条目。
- **sudo 重置 PATH**：`sudo -l` 输出里有 `secure_path=/usr/local/sbin:/usr/local/bin:/usr/bin`——sudo 执行命令时换成这条固定 PATH，你个人目录（如 `~/.local/bin`）里的程序在 `sudo` 下找不到——正确做法是装进 `/usr/local/bin` 这类 secure_path 目录，**不要让 root 去执行用户可写的目录里的程序**。

## 常见环境问题排查表

把上面的知识排成一张出诊表（精讲）：

| 症状                      | 可能原因                      | 处置                                 |
| ------------------------- | ----------------------------- | ------------------------------------ |
| `command not found`       | 未安装 / PATH 错 / 只有 alias | `command -v` 确认；`echo $PATH` 检查 |
| 新装命令不生效            | hash 缓存或 PATH 未刷新       | `hash -r`，或重开 shell              |
| 脚本里 alias 报 not found | 非交互 shell 默认不展开 alias | `shopt -s expand_aliases`（见下文）  |
| 子进程读不到变量          | 忘了 `export`                 | `export 变量名`                      |
| `sudo` 下找不到命令       | `secure_path` 重置            | 装入 `/usr/local/bin` 等 secure_path 目录 |
| 提示符/中文显示异常       | `PS1`、`LANG` 被启动文件改坏  | 从启动文件顺序排查（下一节）         |

## shell 启动文件：登录与非登录

shell 启动时读哪些文件，取决于两个正交的维度：**登录 shell**（`bash --login`、开机登录、图形终端打开 login shell）与**交互 shell**（你在敲命令的终端）。bash 的完整顺序，全部在本机实测过（环境：WSL）：

- **登录 shell**：先读 `/etc/profile`（系统级，里面会向 PATH 追加 `/usr/local/sbin` 等目录并加载 `/etc/profile.d/*.sh`），再按顺序读**第一个存在**的 `~/.bash_profile`、`~/.bash_login`、`~/.profile`。Arch 的 skel 模板让 `~/.bash_profile` 的有效内容只有一行 `[[ -f ~/.bashrc ]] && . ~/.bashrc`——所以登录与非登录最终汇合到 `~/.bashrc`。
- **交互非登录 shell**：先读 `/etc/bash.bashrc`，再读 `~/.bashrc`。实测对照（`HOME` 指向空目录，隔离个人配置）：

```text
$ env -i HOME=/tmp/e8 bash --norc -i -c 'echo [$PS1]'
[\s-\v\$ ]            # --norc：什么都不读，bash 出厂提示符
$ env -i HOME=/tmp/e8 bash -i -c 'echo [$PS1]'
[[\u@\h \W]\$ ]        # 读了 /etc/bash.bashrc：Arch 默认提示符
```

- **非交互 shell**（脚本）：默认不读以上任何文件，需要时用 `BASH_ENV` 变量指定一个要先执行的文件（细节以 [Bash](https://wiki.archlinux.org/title/Bash) 为准）。

改了配置怎么生效？两条路：`source 文件`（或等价的 POSIX 写法 `. 文件`）在**当前 shell** 立即执行它（bash 帮助原话 “Execute commands from a file in the current shell”），或开一个新 shell 让启动流程重走一遍。启动文件速查：**交互+登录**读 `/etc/profile` → `~/.bash_profile`→`~/.bash_login`→`~/.profile`（首个存在者）→ `~/.bashrc`；**交互+非登录**只读 `~/.bashrc`；**非交互**（脚本）读 `BASH_ENV` 指向的文件，通常没有。`sudo -i`、`su -` 会以目标用户身份**重置整个环境**重走登录流程，`sudo 命令`/`su 用户` 则保留大部分当前变量。系统级入口还有三个：`/etc/environment`（`pam_env` 读取）、`/etc/security/pam_env.conf`、`~/.config/environment.d/*.conf`（systemd 用户会话）。惯例分工：别名、提示符、`PATH` 追加写 `~/.bashrc`；只想要登录时执行一次的放 `~/.bash_profile`。zsh、fish 各有自己的一套启动文件（如 zsh 的 `~/.zshrc`），以对应 Wiki 为准。

## alias 与提示符

alias 是交互利器：`alias ll='ls -l'` 定义，`alias` 列出全部，`unalias ll` 删除（环境：WSL）。但它有一条反直觉规则——**alias 在命令被「读取解析」时展开，而不是执行时**：

```bash
# 脚本 t2.sh：alias hi='echo hello'; hi      → hi: command not found（退出码 127）
# 脚本 t1.sh：开头加 shopt -s expand_aliases  → 正常输出 hello（实测）
```

交互 shell 默认开启 alias 展开，脚本（非交互）默认关闭：写进脚本要在使用之前加 `shopt -s expand_aliases`。另一条实用结论：名字的解析顺序是 **alias → 函数 → 内置命令 → PATH 文件**，`type cd` 实测输出 `cd is a shell builtin`、`type -a ls` 会先列 alias 再列 PATH 文件（只想看 PATH 用 `command -v ls`），各自印证了所处的层级——这也是第 2 章 `cd` 不需要路径的原因。

提示符由 `PS1` 控制，Arch 的默认样式（`[\u@\h \W]\$ `）不是 bash 出厂值，而是 `/etc/bash.bashrc` 判断后改写的——上面的实测对照正是它在起作用。自定义提示符（颜色、git 分支、时间）写进 `~/.bashrc`，成法见 [Bash/Prompt customization](https://wiki.archlinux.org/title/Bash/Prompt_customization)。

## 换一个 shell（精讲）

当前用什么 shell，记录在 `/etc/passwd` 的第七字段（实测本机 arch 用户为 `/usr/bin/zsh`），普通用户改自己的用 `chsh`，管理员改别人的用 `usermod -s`——都是第 8 章的内容。选型一览：

| shell            | 一句话定位                                      |
| ---------------- | ----------------------------------------------- |
| `bash`           | 事实标准，本书示例以它为准                      |
| `zsh`            | 兼容 bash 的增强版，插件生态繁荣（本机默认）    |
| `dash`           | 极轻量的 POSIX shell，Debian 常拿它当 `/bin/sh` |
| `fish`           | 开箱即用的现代交互体验，语法自成一派            |
| `nushell`        | 用结构化数据（表/列）重新设计的实验派           |
| `oil`(Oil Shell) | 兼容 bash 的 POSIX 化重构                       |
| `powershell`     | 微软的跨平台对象式 shell                        |

换 shell 只影响交互体验；写脚本与自动化仍以 `bash` 为准（`#!/bin/bash`），保证可移植。

## 小结

- shell 变量不进环境，`export` 后子进程才能看见；临时前缀赋值只作用于一条命令；`env -i` 是环境问题的隔离起点。
- `PATH` 按顺序查找：`type -a` 看全部匹配、`command -v` 拿第一个、`hash -r` 清缓存；整体覆盖、空条目、`sudo` 的 `secure_path` 是三大事故源。
- bash 登录式读 `/etc/profile` + 首个 `~/.bash_profile`，交互非登录读 `/etc/bash.bashrc` + `~/.bashrc`，脚本默认都不读；`source` 在当前 shell 立即生效。
- alias 解析时展开，脚本里要 `shopt -s expand_aliases`；名字解析顺序 alias → 函数 → 内置 → PATH。
- 提示符看 `PS1`（Arch 在 `/etc/bash.bashrc` 改写）；换 shell 用 `chsh`，脚本继续用 bash。

## 练习

1. 变量作用域三连（环境：WSL）：

   ```bash
   MYV=inner bash -c 'echo "临时前缀可见: $MYV"'   # 可见
   echo "外层: [$MYV]"                            # 空
   export MYV=exported; bash -c 'echo "子进程: $MYV"'; unset MYV
   env | grep -E '^(HOME|USER|PATH)=' | cut -c1-60
   ```

2. 拆解 PATH（环境：WSL）：`echo $PATH | tr ':' '\n' | head -8` 按行列出；`type -a ls` 对照查找顺序；`command -v vim` 输出第一个匹配；`PATH=/tmp command -v ls; echo $?` 与 `PATH=/tmp:$PATH command -v ls` 对照，解释退出码差异。
3. 实测启动文件（环境：WSL）：

   ```bash
   mkdir -p /tmp/e8
   env -i HOME=/tmp/e8 bash --norc -i -c 'echo [$PS1]'
   env -i HOME=/tmp/e8 bash -i -c 'echo [$PS1]'
   echo 'export LAB8=from-rc' > /tmp/e8/.bashrc
   env -i HOME=/tmp/e8 bash -i -c 'echo $LAB8'
   ```

   前两行对比确认 `/etc/bash.bashrc` 被读取，第三行验证 `~/.bashrc` 是你自己的入口；再用 `env -i HOME=/tmp/e8 bash -lc 'echo $PATH'` 观察登录式会读 `/etc/profile`。
4. alias 的脚本限制（环境：WSL）：把 `alias hi='echo hello'` 与 `hi` 两行写进 `/tmp/e8/t2.sh` 用 `bash t2.sh` 运行（预期 127），复制为 `t1.sh` 并在首行加 `shopt -s expand_aliases` 再运行，对比结果。
5. 排查表实战（环境：WSL）：`bash -c 'definitely-not-a-cmd'` 记录报错与 `$?`；`type cd`、`type -a ls` 判定解析层级；`sudo -l | grep secure_path` 找出 sudo 的固定 PATH，解释为什么 `~/.local/bin` 里的工具在 `sudo` 下会失踪。

## 自检

- [ ] 能解释 shell 变量与环境变量的区别，以及临时前缀赋值的作用域
- [ ] 能说出 `env`、`printenv`、`export -p`、`declare -x` 各自的典型用法
- [ ] 能背出 bash 登录式与交互非登录两条启动链，并说明 Arch 如何让它们汇合到 `~/.bashrc`
- [ ] 能给出 PATH 三大事故（覆盖、空条目、secure_path）的机理与对策
- [ ] 能解释 alias 为什么在脚本里失灵、加什么修复，以及名字解析的四个层级
- [ ] 知道当前 shell 记在哪、如何切换，以及脚本为什么固定用 bash

## 参考

- [Environment variables](https://wiki.archlinux.org/title/Environment_variables)、[Bash](https://wiki.archlinux.org/title/Bash)、[Command-line shell](https://wiki.archlinux.org/title/Command-line_shell)
- 工作机制：[Alias](https://wiki.archlinux.org/title/Alias)、[Export](https://wiki.archlinux.org/title/Export)、[Source](https://wiki.archlinux.org/title/Source)、[Cd](https://wiki.archlinux.org/title/Cd)、[Bash/Prompt customization](https://wiki.archlinux.org/title/Bash/Prompt_customization)、[Category:Shell builtins](https://wiki.archlinux.org/title/Category%3AShell_builtins)
- 其他 shell：[Zsh](https://wiki.archlinux.org/title/Zsh)、[Dash](https://wiki.archlinux.org/title/Dash)、[Fish](https://wiki.archlinux.org/title/Fish)、[Nushell](https://wiki.archlinux.org/title/Nushell)、[Oil Shell](https://wiki.archlinux.org/title/Oil_Shell)、[PowerShell](https://wiki.archlinux.org/title/PowerShell)、[Category:Command-line shells](https://wiki.archlinux.org/title/Category%3ACommand-line_shells)
