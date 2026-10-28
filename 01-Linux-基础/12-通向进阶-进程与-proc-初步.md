# 第 12 章 通向进阶：进程、系统调用与 /proc

到这里，篇一的工具箱已经齐了：命令与路径、文件与文本、目录与权限、账号与环境。但它们全在「用户空间」的视角里——程序跑起来之后发生了什么？程序又是凭什么资格让内核动磁盘、开网络的？本章作为篇一的收官与进阶篇的引子，只讲三个概念：进程、系统调用、`/proc`，把观察窗口交到你手上；完整的进程管理从第二篇第 13 章开始。

> 本章目标：能区分程序与进程，说出 PID、PPID 与 PID 1 的含义，并现场观察进程的生灭；理解系统调用的定位——用户态进入内核态的受控入口、libc 对它的包装、man 第 2 节的来历；会用 `/proc` 只读观察单个进程（`self`、`comm`、`cmdline`、`status`）与整机状态（`uptime`、`loadavg`、`cpuinfo`、`meminfo`）；知道进程管理在第二篇从哪里继续。
> 对应 Wiki：[Process](https://wiki.archlinux.org/title/Process)、[Procfs](https://wiki.archlinux.org/title/Procfs)

## 程序与进程：静态与运行时

程序是磁盘上的文件——第 5 章讲过，它躺在 inode 的数据块里，`ls -l` 看到的就是它。进程则是它**运行起来的实例**：同一个 `sleep` 程序可以同时存在多个进程，各自领一个编号——进程 ID（PID）。每个进程还记着父进程（PPid），整棵进程树的树根是 PID 1（init），本机实测由 `systemd` 担任（环境：WSL）：

```text
$ cat /proc/1/comm
systemd
```

进程的生与灭可以现场看到（环境：WSL，/tmp 演练）：

```bash
sleep 7 &                 # 放进后台，$! 是刚出生进程的 PID
pid=$!
ls -d /proc/$pid          # 数字目录存在：进程活着
cat /proc/$pid/comm       # sleep
wait                      # 等待后台进程结束
ls -d /proc/$pid          # No such file or directory：进程已退出，目录随之消失
```

进程由父进程 `fork` 出来、再由 `exec` 装载程序成新映像——shell 执行你敲的**外部命令**时，底下都在重复这两个动作（builtin、函数、alias 不新建进程，下一节细讲）。进程退出后若父进程还没「收尸」，会短暂留下僵尸态。创建、回收、`ps`/`top` 的完整用法、信号与优先级，全部留给第二篇第 13 章；本章只要求建立三条直觉：进程是运行时实体、它有编号、它会消失。

## 系统调用：程序请内核干活的门

进程的大部分代码运行在**用户态**——碰不得磁盘、网卡和内核的数据结构。需要读写文件、创建目录、改权限时，必须发起**系统调用**（syscall）：CPU 切换到**内核态**，由内核代为完成再返回。你在篇一敲过的命令，底下全是这套动作：`ls` 调 `getdents64` 列目录项，`cat` 调 `open/read/write`，`chmod` 调 `chmod`。三层关系要分清：

- **内核**定义每个 syscall 的编号与参数，这是稳定的底层契约；
- **libc** 把 syscall 包装成普通 C 函数，`man 2 open`、`man 2 read` 的「2」正是「手册第 2 节 = 系统调用」（第 2 章讲过 1 是用户命令、5 是文件格式、7 是综述）；
- **程序**调 libc 函数，由 libc 用 `syscall` 指令陷入内核，用户程序自己从不直接碰硬件。

这也反照出第 2 章 builtin 与外部程序的分界：分界在于**是否新建进程**，而非是否陷入内核。`cd` 是 builtin，不 fork/exec，但它改的是 shell 进程自身的工作目录，必须调用 `chdir(2)`；外部程序 `/usr/bin/pwd` 则调用 `getcwd(2)` 向内核询问当前目录。builtin 省掉的是进程创建，不是系统调用。观察它的显微镜是 `strace`（`strace 命令` 打印每个 syscall 的参数与返回值，`strace -c 命令` 做统计汇总）。系统通常不预装它，Arch 下 `pacman -S strace` 装好再用，用法以 [Strace](https://wiki.archlinux.org/title/Strace) 为准。

## /proc：内核开的一扇窗

第 5 章铺垫过：`/proc` 不是磁盘目录，而是内核导出的虚拟文件系统——现在正式用它。核心机关是 **`/proc/self`：谁读它，它就代表谁**（环境：WSL，实跑）：

```text
$ grep -E '^(Name|Pid|PPid|Uid)' /proc/self/status
Name:   grep
Pid:    242709
PPid:   242699
Uid:    1000    1000    1000    1000
```

同一条路径，`grep` 读到的是 `grep` 自己的状态；换成 `cat` 就是 `cat` 的。把 `self` 换成具体编号，就得到那个进程的档案：

| 路径/文件              | 内容                                                |
| ---------------------- | --------------------------------------------------- |
| `/proc/PID/comm`       | 可执行文件名（内核截断到 15 字符）                  |
| `/proc/PID/cmdline`    | 完整命令行，参数间是 NUL，用 `tr '\0' ' '` 看       |
| `/proc/PID/status`     | 状态汇总：State、Pid、PPid、Uid、Gid…               |
| `/proc/PID/cwd`、`exe` | 符号链接，指向工作目录与程序本体（`readlink` 查看） |

上一节的 `sleep` 实验已经演示了生命周期：**PID 目录随进程出生、随进程消失**——`ps` 列出来的那些数字，本质上就是此刻 `/proc` 里存在的进程目录。这些都是只读观察，第二篇会给这套档案配上查询与控制工具。

## 整机状态：一页仪表盘

`/proc` 根目录下还挂着整机的仪表，同样只读（环境：WSL，实跑）：

```text
$ cat /proc/uptime
77496.91 450232.09             # 开机秒数；空闲秒数（跨 CPU 累计，可大于前者）
$ cat /proc/loadavg
0.27 0.41 0.36 2/1060 242713   # 1/5/15 分钟负载；运行中/总线程数；最近新建的 PID
$ grep -c ^processor /proc/cpuinfo
6                              # 逻辑 CPU 个数
$ head -3 /proc/meminfo
MemTotal:       14314216 kB
MemFree:         5122888 kB
MemAvailable:    8304120 kB
```

读法要点：`/proc/uptime` 第一字段是开机秒数，换算约 21.5 小时，与 `uptime -p` 的实测输出 `up 21 hours, 35 minutes` 相互印证；loadavg 三个数字是**可运行任务数**按 1、5、15 分钟的滑动平均，经验判据是看它是否持续超过 CPU 核数（本机 6 核），超过即意味着任务在排队；`MemAvailable` 才是「实际还能给程序用多少」，`MemFree` 只统计完全空闲的部分，两者差额大不等于异常。这些仪表在第 13 章（进程）与第二篇第 16 章（磁盘与存储）会反复回看，先把字段混熟。

## 一次 cat 的旅程：把篇一串起来

用本章的三个概念重放 `cat notes.txt`，每一步都落在篇一的某章里：

1. **shell 解析命令**（第 2 章）：`cat` 不是 builtin，于是 shell `fork` 出子进程、`exec` 装载 `/usr/bin/cat`——新进程领到自己的 PID，`/proc/PID` 目录同时出现。
2. **发起系统调用**：`cat` 调 libc 的 `open("notes.txt", O_RDONLY)`，CPU 陷入内核态。
3. **内核查权限**（第 6 章）：按文件属主/属组对照进程的 UID 判 rwx——不放行，`open` 就带着 `EACCES` 返回；随后是 `cat` 把这个错误号翻译成 `Permission denied` 打印出来：**错误编号来自内核，文案出自程序**。
4. **读文件**（第 5 章）：内核经文件系统解析路径、查 inode、定位数据块，`read` 把内容搬进用户态缓冲区。
5. **写到输出**（第 4 章）：`write(1, …)` 写向文件描述符 1——默认是终端；你用 `>` 重定向时，fd 1 已被 shell 改指到文件，数据于是落盘。
6. **退出**：`cat` 返回 EOF 后退出，内核回收内存与文件表，`/proc/PID` 目录随即消失——第 2 步出现、这一步消失，中间就是这个进程的一生。

## 小结

- 程序是静态文件，进程是带 PID 的运行实例；PPid 串成进程树，PID 1 是树根（本机 systemd），`/proc/PID` 目录随进程生灭。
- 系统调用是用户态进入内核态的唯一受控入口；libc 包装它，man 第 2 节记录它，`strace` 观察它；builtin 与外部程序的差别也由此解释。
- `/proc/self` 谁读代表谁；`comm/cmdline/status/cwd/exe` 是单进程档案，`uptime/loadavg/cpuinfo/meminfo` 是整机仪表。
- 篇一至此收官：命令（2）、文件（3）、文本（4）、文件系统（5）、权限（6）、用户（7）、环境（8）、综合实验（9）全部就位——第 13 章从 `ps`/`top` 与信号开始，把「进程」从概念变成日常操作。

## 练习

1. 「谁是自己」三读（环境：WSL，只读）：

   ```bash
   grep -E '^(Name|Pid|PPid)' /proc/self/status
   readlink /proc/self/cwd          # 当前进程的工作目录
   echo $$; cat /proc/$$/comm       # 本 shell 的 PID 与名字
   ```

2. 进程生灭完整观察（环境：WSL）：`sleep 10 & pid=$!`，趁活着依次执行 `ls -d /proc/$pid`、`cat /proc/$pid/comm`、`tr '\0' ' ' < /proc/$pid/cmdline`（解释为什么命令行要过 `tr`），再 `wait` 后重复 `ls -d /proc/$pid` 记录报错。
3. 整机仪表解读（环境：WSL，只读）：`cat /proc/uptime` 并换算成小时，对照 `uptime -p`；`cat /proc/loadavg` 读出三个负载数字与 `运行中/总线程数`，和 `grep -c ^processor /proc/cpuinfo` 的核数对比，判断此刻系统是否排队；`head -5 /proc/meminfo` 说清 `MemFree` 与 `MemAvailable` 的差别。
4. 系统调用的边界（环境：WSL）：`type cd`、`type -a pwd` 判断两者形态（注意 bash/zsh 的 `pwd` 也是 builtin，`type -a` 会同时列出 builtin 与 `/usr/bin/pwd`），回答「两个动作各自要不要新建进程、要不要陷入内核」；已安装 `strace` 的环境（Arch：`pacman -S strace`，本机未预装）可选做 `strace -c ls > /dev/null 2> counts.txt; head -5 counts.txt`，从统计里找出 `ls` 调用最多的 syscall。

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
