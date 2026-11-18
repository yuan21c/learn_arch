# 第 12 章 通向进阶：进程、系统调用与 /proc

到这里，篇一的工具箱已经齐了：命令与路径、文件与文本、目录与权限、账号与环境。但它们全在「用户空间」的视角里——程序跑起来之后发生了什么？程序又是凭什么资格让内核动磁盘、开网络的？本章作为篇一的收官与进阶篇的引子，只讲三个概念：进程、系统调用、`/proc`，把观察窗口交到你手上；完整的进程管理从第二篇第 13 章开始。

> 本章目标：能区分程序与进程，说出 PID、PPID 与 PID 1 的含义，并现场观察进程的生灭；理解系统调用的定位——用户态进入内核态的受控入口、libc 对它的包装、man 第 2 节的来历；会用 `/proc` 只读观察单个进程（`self`、`comm`、`cmdline`、`status`）与整机状态（`uptime`、`loadavg`、`cpuinfo`、`meminfo`）；知道进程管理在第二篇从哪里继续。
> 对应 Wiki：[Process](https://wiki.archlinux.org/title/Process)、[Procfs](https://wiki.archlinux.org/title/Procfs)

> **命令来源（本章涉及的命令）**
> 
> | 命令 | 是什么简写 | 由什么命令/机制发展而来 | 参数/选项来源 | 如何记忆 |
> |------|------------|------------------------|---------------|----------|
> | `ps` | **p**rocess **s**tatus（进程状态） | Unix 第 1 版即有，属于 procps-ng 包 | `-e` 所有进程、`-o` 自定义输出列、`-p` 指定 PID | ps = process status，查看进程“状态” |
> | `top` | 英文 top（顶部/实时监控） | procps-ng 包，交互式进程查看器 | 无常用选项，交互中按 `1`、`P`、`M` 等 | top = top，实时显示资源占用“最顶”的进程 |
> | `strace` | **strace**（系统调用跟踪） | Linux 开发工具，跟踪进程的系统调用 | `-c` 统计汇总、`-o` 输出到文件 | strace = system call trace，跟踪“系统调用” |
> | `kill` | 英文 kill（终止） | shell 内置与外部程序，发送信号 | 无选项默认 TERM、`-9` 强制杀死 | kill = kill，给进程发信号（默认终止） |
> | `uptime` | 英文 uptime（运行时间） | procps-ng 包，显示系统运行时间和负载 | 无常用选项 | uptime = up time，系统已经“运行”了多久 |
> | `free` | 英文 free（空闲内存） | procps-ng 包，显示内存使用情况 | `-h` 人类可读、`-m` 以 MB 显示 | free = free，查看“空闲”内存 |

## 程序与进程：静态与运行时

程序是磁盘上的文件——第 5 章讲过，它躺在 inode 的数据块里，`ls -l` 看到的就是它。进程则是它**运行起来的实例**：同一个 `sleep` 程序可以同时存在多个进程，各自领一个编号——进程 ID（PID）。每个进程还记着父进程（PPID），整棵进程树的树根是 PID 1——它叫 init，现代桌面/服务器发行版常由 `systemd` 担任 PID 1（它就是 1 号进程/初始化系统，实操见第 37 章），但并非全部（如 Alpine 用 OpenRC）。现场观察：

```text
$ cat /proc/1/comm
systemd
```

进程的生与灭可以现场看到（/tmp 演练）：

```bash
sleep 7 & # 放进后台，$! 是刚出生进程的 PID
pid=$!
ls -d /proc/$pid # 数字目录存在：进程活着
cat /proc/$pid/comm # sleep
wait # 等待后台进程结束
ls -d /proc/$pid # No such file or directory：进程已退出，目录随之消失
```

进程由父进程 `fork` 出来、再由 `exec` 装载程序成新映像——shell 执行你敲的**外部命令**时，底下都在重复这两个动作（builtin、函数、alias 不新建进程，下一节细讲）。进程退出后若父进程还没「收尸」，会短暂留下僵尸态。创建、回收、`ps`/`top` 的完整用法、信号与优先级，全部留给第二篇第 13 章；本章只要求建立三条直觉：进程是运行时实体、它有编号、它会消失。

## 系统调用：程序请内核干活的门

进程的大部分代码运行在**用户态**——碰不得磁盘、网卡和内核的数据结构。需要读写文件、创建目录、改权限时，必须发起**系统调用**（syscall）：CPU 切换到**内核态**，由内核代为完成再返回。你在篇一敲过的命令，底下全是这套动作：`ls` 调 `getdents64` 列目录项，`cat` 调 `open/read/write`，`chmod` 调 `chmod`。三层关系要分清：

- **内核**定义每个 syscall 的编号与参数，这是稳定的底层契约；
- **libc** 把 syscall 包装成普通 C 函数，`man 2 open`、`man 2 read` 的「2」正是「手册第 2 节 = 系统调用」（第 2 章讲过 1 是用户命令、5 是文件格式、7 是综述）；
- **程序**调 libc 函数，由 libc 用 `syscall` 指令陷入内核，用户程序自己从不直接碰硬件。

这也反照出第 2 章 builtin 与外部程序的分界：分界在于**是否新建进程**，而非是否陷入内核。`cd` 是 builtin，不 fork/exec，但它改的是 shell 进程自身的工作目录，必须调用 `chdir(2)`；外部程序 `/usr/bin/pwd` 则调用 `getcwd(2)` 向内核询问当前目录。builtin 省掉的是进程创建，不是系统调用。观察它的显微镜是 `strace`（`strace 命令` 打印每个 syscall 的参数与返回值，`strace -c 命令` 做统计汇总）。系统通常不预装它，用发行版包管理器装好再用（Arch：`pacman -S strace`；Debian/Ubuntu：`apt install strace`），用法以 [Strace](https://wiki.archlinux.org/title/Strace) 为准。

## /proc：内核开的一扇窗

第 5 章铺垫过：`/proc` 不是磁盘目录，而是内核导出的虚拟文件系统——现在正式用它。核心机关是 **`/proc/self`：谁读它，它就代表谁**（实跑）：

```text
$ grep -E '^(Name|Pid|PPid|Uid)' /proc/self/status
Name: grep
Pid: 242709
PPid: 242699
Uid: 1000 1000 1000 1000
```

同一条路径，`grep` 读到的是 `grep` 自己的状态；换成 `cat` 就是 `cat` 的。把 `self` 换成具体编号，就得到那个进程的档案：

| 路径/文件 | 内容 |
| ---------------------- | --------------------------------------------------- |
| `/proc/PID/comm` | 可执行文件名（内核截断到 15 字符） |
| `/proc/PID/cmdline` | 完整命令行，参数间是 NUL，用 `tr '\0' ' '` 看 |
| `/proc/PID/status` | 状态汇总：State、Pid、PPid、Uid、Gid… |
| `/proc/PID/cwd`、`exe` | 符号链接，指向工作目录与程序本体（`readlink` 查看） |

上一节的 `sleep` 实验已经演示了生命周期：**PID 目录随进程出生、随进程消失**——`ps` 列出来的那些数字，本质上就是此刻 `/proc` 里存在的进程目录。这些都是只读观察，第二篇会给这套档案配上查询与控制工具。

## 进程状态：R、S、D、T、Z

`ps` 的 `STAT` 列和 `/proc/PID/status` 的 `State` 字段用单字母描述进程此刻在做什么，读懂它比记命令更重要：

| 状态 | 含义 | 典型情形 |
| --- | --- | --- |
| `R` | running / runnable，在 CPU 上或排队等 CPU | 正在计算、刚被唤醒 |
| `S` | 可中断睡眠，等事件（输入、定时器、锁） | 交互 shell、`sleep` |
| `D` | 不可中断睡眠，等 I/O 完成 | 等磁盘、等网络文件系统 |
| `T` | 被作业控制停止（`Ctrl-Z`）或被 `SIGSTOP` 暂停 | 前台任务挂起 |
| `Z` | 僵尸：已退出，只留退出状态等父进程回收 | 父进程忘了 `wait` |

两个高频误判：**`D` 状态连 `SIGKILL` 也杀不掉**，因为内核必须等 I/O 完成才允许进程退出，遇到大量 `D` 应查存储与挂载而不是反复 `kill -9`；**僵尸不能靠杀解决**，它已经没有可执行代码，正确做法是让父进程 `wait`（修程序）或结束父进程，由 PID 1 收养并回收。`ps`（process status，进程状态）属于 procps-ng 包，Unix 第 1 版即有。选项来源：`-e` 所有进程、`-o` 自定义输出列、`-p` 指定 PID。`ps -eo pid,ppid,stat,cmd` 加一列 `stat` 就能现场分辨这些状态。

记忆：ps = process status，查看进程“状态”。

## 整机状态：一页仪表盘

`/proc` 根目录下还挂着整机的仪表，同样只读（实跑）：

```text
$ cat /proc/uptime
77496.91 450232.09 # 开机秒数；空闲秒数（跨 CPU 累计，可大于前者）
$ cat /proc/loadavg
0.27 0.41 0.36 2/1060 242713 # 1/5/15 分钟平均负载；可运行(running+runnable)/总调度实体数；最近新建的 PID
$ grep -c ^processor /proc/cpuinfo
6 # 逻辑 CPU 个数
$ head -3 /proc/meminfo
MemTotal: 14314216 kB
MemFree: 5122888 kB
MemAvailable: 8304120 kB
```

读法要点：`/proc/uptime` 第一字段是开机秒数，换算约 21.5 小时；`uptime -p` 的实测输出是 `up 21 hours, 35 minutes`——两次采样存在时间差，数值接近即可，不必逐分钟对齐；loadavg 三个数字是**可运行（R）+ 不可中断（D）**任务数的 1/5/15 分钟指数衰减平均——负载高而 CPU 空闲时，先查 D 状态进程与 IO；经验判据是看它是否持续超过 CPU 核数，超过即意味着任务在排队；`MemAvailable` 才是「实际还能给程序用多少」，`MemFree` 只统计完全空闲的部分，两者差额大不等于异常。这些仪表在第 13 章（进程）与第二篇第 18 章（磁盘与存储）会反复回看，先把字段混熟。

## 一次 cat 的旅程：把篇一串起来

用本章的三个概念重放 `cat notes.txt`，每一步都落在篇一的某章里：

1. **shell 解析命令**（第 2 章）：`cat` 不是 builtin，于是 shell `fork` 出子进程、`exec` 装载 `/usr/bin/cat`——新进程领到自己的 PID，`/proc/PID` 目录同时出现。
2. **发起系统调用**：`cat` 调 libc 的 `open("notes.txt", O_RDONLY)`，CPU 陷入内核态。
3. **内核查权限**（第 6 章）：对照进程的 UID/GID（含补充组）与 ACL 判 rwx，root 还可凭 CAP_DAC_OVERRIDE 绕过——不放行，`open` 就带着 `EACCES` 返回；随后是 `cat` 把这个错误号翻译成 `Permission denied` 打印出来：**错误编号来自内核，文案出自程序**。
4. **读文件**（第 5 章）：内核经文件系统解析路径、查 inode、定位数据块，`read` 把内容搬进用户态缓冲区。
5. **写到输出**（第 4 章）：`write(1, …)` 写向文件描述符 1——默认是终端；你用 `>` 重定向时，fd 1 已被 shell 改指到文件，数据于是落盘。
6. **退出**：`cat` 返回 EOF 后退出，内核回收内存与文件表，`/proc/PID` 目录随即消失——第 2 步出现、这一步消失，中间就是这个进程的一生。

## 进程观测的失败模式与取舍

| 失败模式 | 原因 | 验证 |
| --- | --- | --- |
| 把 load average 当成 CPU 使用率 | 它包含不可中断 I/O 等待，且是 1/5/15 分钟均值 | `uptime`、`vmstat 1`、`top` 交叉看 |
| 用 RSS 相加估算内存占用 | 共享库/共享页被重复计算 | `/proc/PID/smaps_rollup` 的 `Pss` 更接近真实分摊 |
| 采样一次就下结论 | `/proc` 是瞬时快照，进程可能在两次采样间变化 | `pidstat 1`（`sysstat` 包）或 `vmstat 1` 连续采样 |
| 在容器里看到的进程树不完整 | PID 命名空间隔离 | `ps -ef` 与宿主机 `ps -ef` 对比；看 `/proc/1/cgroup` |
| 把僵尸进程当成「还在运行」 | 僵尸只剩退出状态，等待父进程回收 | `ps -eo pid,ppid,stat,cmd | awk '$3 ~ /Z/'`；处理父进程而非直接杀僵尸 |

**验证与回滚**：观测命令本身基本只读，不需要回滚；但 `kill` 会改变系统状态。发信号前先用 `ps -p PID -o pid,ppid,user,stat,cmd` 确认身份，优先 `TERM`，观察无响应再 `KILL`；对服务用 `systemctl stop`，不要直接杀主进程。`/proc/PID/` 下的 `status`、`cmdline`、`fd/` 是最可靠的现场证据。

**取舍**：`ps` 适合脚本与一次性快照，`top` 适合交互观察，`/proc` 适合精确取证；采样工具越强，开销与依赖越多。排障时先问「我要看的是瞬时状态还是趋势」，再选工具。

## 小结

- 程序是静态文件，进程是带 PID 的运行实例；PPID 串成进程树（`/proc` 里的字段名写作 `PPid`），PID 1 是树根（本机 systemd），`/proc/PID` 目录随进程生灭。
- 系统调用是用户态进入内核态的**主要受控入口**（此外还有中断、异常与 vDSO 等路径）；libc 包装它，man 第 2 节记录它，`strace` 观察它；builtin 与外部程序的差别也由此解释。
- `/proc/self` 谁读代表谁；`comm/cmdline/status/cwd/exe` 是单进程档案，`uptime/loadavg/cpuinfo/meminfo` 是整机仪表。
- 篇一至此收官：命令（2）、文件（3）、文本（4）、文件系统（5）、权限（6-7）、用户与 sudo（8-9）、环境（10）、综合实验（11）全部就位——第 13 章从 `ps`/`top` 与信号开始，把「进程」从概念变成日常操作。

## 练习

1. 「谁是自己」三读（只读）：

 ```bash
 grep -E '^(Name|Pid|PPid)' /proc/self/status
 readlink /proc/self/cwd # 当前进程的工作目录
 echo $$; cat /proc/$$/comm # 本 shell 的 PID 与名字
 ```

2. 进程生灭完整观察：`sleep 10 & pid=$!`，趁活着依次执行 `ls -d /proc/$pid`、`cat /proc/$pid/comm`、`tr '\0' ' ' < /proc/$pid/cmdline`（解释为什么命令行要过 `tr`），再 `wait` 后重复 `ls -d /proc/$pid` 记录报错。
3. 整机仪表解读（只读）：`cat /proc/uptime` 并换算成小时，对照 `uptime -p`（两次采样有时间差，接近即可）；`cat /proc/loadavg` 读出三个负载数字与 `运行中/总线程数`，和 `grep -c ^processor /proc/cpuinfo` 的核数对比，判断此刻系统是否排队；`head -5 /proc/meminfo` 说清 `MemFree` 与 `MemAvailable` 的差别。
4. 系统调用的边界：`type cd`、`type -a pwd` 判断两者形态（注意 bash/zsh 的 `pwd` 也是 builtin，`type -a` 会同时列出 builtin 与 `/usr/bin/pwd`），回答「两个动作各自要不要新建进程、要不要陷入内核」；已安装 `strace` 的环境（Arch：`pacman -S strace`，本机未预装）可选做 `strace -c ls > /dev/null 2> counts.txt; head -5 counts.txt`，从统计里找出 `ls` 调用最多的 syscall。

## 自检

- [ ] 能用「静态文件 vs 运行实例」区分程序与进程，并说出 PID、PPid、PID 1 各是什么
- [ ] 能解释用户态为何不能直接访问内核资源，以及系统调用、libc、man 第 2 节三者的关系
- [ ] 能说明 `/proc/self` 的语义，以及 `/proc/PID` 目录何时存在、何时消失
- [ ] 能读懂 loadavg 四段输出（三个负载、运行中/总线程、最近 PID），并说出与 CPU 核数对照的判据
- [ ] 知道 `cmdline` 为什么要用 `tr` 处理，`comm` 为什么会变短
- [ ] 知道篇一各章各管什么，以及进程管理深讲在第二篇第几章

## 参考

- [Process](https://wiki.archlinux.org/title/Process)
- [Procfs](https://wiki.archlinux.org/title/Procfs)
- [Strace](https://wiki.archlinux.org/title/Strace)
