# 第 7 章 权限深入：UID、ACL 与文件能力

第 6 章的九位权限回答了「属主/属组/其他各能做什么」，但有三个问题它答不了：`passwd` 凭什么替你改 shadow（有效身份是什么）、脚本加 SUID 为什么没用、怎么只给张三授权而不影响李四。这三问分别落到 UID 三元组、file capabilities 与 ACL，也正是理解 `sudo`、容器隔离与提权攻击的基础。

> 本章目标：能区分 real/effective/saved UID 并解释提权工具的原理；知道脚本 SUID 无效与 `nosuid` 挂载的作用；会用 `getcap/setcap` 管理文件能力；掌握 ACL 的按名授权、mask、默认 ACL 继承与清理。
> 对应 Wiki：[File permissions and attributes](https://wiki.archlinux.org/title/File_permissions_and_attributes)、[Access Control Lists](https://wiki.archlinux.org/title/Access_Control_Lists)、[Capabilities](https://wiki.archlinux.org/title/Capabilities)

> **命令来源（本章涉及的命令）**
> 
> | 命令 | 是什么简写 | 由什么命令/机制发展而来 | 参数/选项来源 | 如何记忆 |
> |------|------------|------------------------|---------------|----------|
> | `getcap` | **get capability**（获取能力） | Linux 2.6 引入 file capabilities，由 libcap 包提供 | 无常用选项，直接跟文件名；`-r` 递归 | getcap = get capability，读取文件的“能力” |
> | `setcap` | **set capability**（设置能力） | 同上，给文件授予单点能力 | `cap_xxx=+ep`（effective/permitted）、`-r` 移除 | setcap = set capability，给文件“设置”能力 |
> | `setfacl` | **set file ACL**（设置文件 ACL） | ACL 机制源自 POSIX 1003.1e 扩展，Linux 由 `acl` 包提供 | `-m` modify（修改/添加条目）、`-x` remove（删除条目）、`-b` remove all（全部清除）、`-k` 删除默认 ACL、`-d` 默认 ACL、`-R` 递归 | setfacl = set file ACL，给文件“设置”访问控制列表 |
> | `getfacl` | **get file ACL**（获取文件 ACL） | 同上 | 无常用选项，直接跟文件名；`-p` 保留路径格式 | getfacl = get file ACL，读取文件的 ACL 条目 |
> | `chattr` | **change attribute**（改变属性） | ext2/ext3/ext4 文件系统层属性，由 `e2fsprogs` 包提供 | `+i` 不可变、`+a` 只追加、`+C` 关 COW、`-i` 解除 | chattr = change attribute，改文件系统“属性” |
> | `lsattr` | **ls attribute**（列出属性） | 同上，配合 chattr 使用 | 无常用选项，直接跟文件名 | lsattr = ls attribute，像 ls 一样列出文件属性 |
> | `namei` | **name i**node（路径名到 inode） | util-linux 包，逐级解析路径 | `-l` 详细模式，显示每层权限 | namei = name to inode，把路径名“翻译”成 inode，逐级看权限 |
> | `getfattr` | **get file attribute**（获取扩展属性） | 扩展属性（xattr）机制，由 `attr` 包提供 | `-d` 显示所有用户属性 | getfattr = get file attribute，读取扩展属性 |

## 三个 UID：real、effective、saved

一个进程不是「一个身份」，而是三个：**real UID**（谁启动的）、**effective UID**（此刻以谁的权限干活）、**saved UID**（之前的有效身份，供回落）。内核判权限看的是 effective；`ps` 的 `USER`/`UID` 列默认显示的也是 effective（要看 real 用 `ps -o ruid=`），审计日志则另外记录登录身份 `auid`。看自己的三元组：

```bash
grep '^Uid' /proc/self/status
# Uid: 1000 1000 1000 1000 依次是 real、effective、saved、fs
```

SUID 程序是三元组的日常表演者：你（real=1000）执行 `/usr/bin/passwd` 的瞬间，effective 变成文件属主 root（0），于是能读写 shadow；程序退出后回到你。`sudo` 走的是另一条路：它 exec 的目标进程四个 UID 全部被置为目标用户（`0 0 0 0`），而不是像 SUID 那样只改 effective/saved、保留 real——对比两者能看清「借身份」与「换身份」的差别，策略由 `/etc/sudoers` 决定（见《sudo 与提权安全》章）。root 的特权还常被拆成 capabilities，下一节讲。

## 脚本上的 SUID/SGID 无效

内核**忽略解释型脚本上的 SUID/SGID 位**：`chmod u+s backup.sh` 之后执行它，effective UID 仍然是你自己。原因是执行脚本的其实是 `bash`/`python`，被 SUID 的文件从未作为可执行映像被加载——否则任何人都能复制你的脚本、改一行就提权。

```bash
# 在 /tmp 演练，不需要 root
printf '#!/bin/bash\nid -u\n' > /tmp/suid.sh && chmod 4755 /tmp/suid.sh
/tmp/suid.sh # 输出 1000，不是 0——SUID 被忽略
ls -l /tmp/suid.sh # -rwsr-xr-x（位还在，但不起作用）
```

需要提权的脚本有两条正路：编译成二进制（C/Rust/Go），或包一层经过审计的专用包装器（例如由 sudo 规则调用的极小二进制，或以 root 运行的服务）。**不要给 `bash`/`python` 等通用解释器设置 file capabilities**——脚本执行时生效的是解释器二进制的能力，等于给该解释器运行的所有脚本乃至交互 shell 开了同一个提权口子，与「SUID bash」同级高危（机制见上一节，ArchWiki Capabilities 亦有警示）。

**`nosuid` 挂载选项**把这类保护从「文件行为」上升到「挂载点」：`mount -o nosuid` 后该文件系统上所有 SUID/SGID 与 file capabilities 一概失效，网络共享（如 NFS）常带此选项；容器内 SUID 失效则更多来自 capability 边界集与运行时默认安全配置，不宜只归因于 `nosuid`（以所用容器运行时的文档为准）。

## file capabilities：SUID 的精细替代

`getcap`（get capability，获取能力）与 `setcap`（set capability，设置能力）来自 libcap 包，用于管理 Linux file capabilities。Capabilities 把「root 无所不能」拆成单点能力（`cap_setuid`、`cap_net_bind_service`、`cap_sys_admin`……），程序只带需要的几块：

选项来源：`getcap` 直接跟文件名，`-r` 递归；`setcap` 用 `cap_xxx=+ep`（effective/permitted）授予，`-r` 移除。

记忆：getcap = get capability，读取文件的“能力”；setcap = set capability，给文件“设置”能力。

```bash
# 需 sudo；setcap/getcap 来自 libcap 包
getcap /usr/bin/ping # 当前 iputils 的 ping 无文件能力（输出为空）；旧版常见 cap_net_raw=ep
getcap -r /usr 2>/dev/null # 想观察真实的能力文件，看 newuidmap/newgidmap 一类
sudo setcap cap_net_bind_service=+ep /usr/local/bin/myserver # 换成你自己的二进制，该文件须已存在
getcap /usr/local/bin/myserver
sudo setcap -r /usr/local/bin/myserver # 清除
```

`cap_net_bind_service=+ep` 的 `e/p` 是 effective/permitted 两集的开关。相比 SUID root：给一个专用二进制（不是脚本）设 `cap_dac_override` 要格外谨慎——它可绕过全部 DAC 读/写/执行检查，在文件非 immutable、所在挂载点非只读、且没有 SELinux/AppArmor 等强制访问控制拦截时，可改写 `/etc/shadow`、`/etc/sudoers` 等 root 文件，等价 root 权限；只能授予 root 属主、普通用户不可改写、经过审计的二进制。想演示低风险能力，用 `cap_net_bind_service`（仅允许绑定 1024 以下端口）。排查特权入口的两个口子：`find / -xdev -type f -perm -4000` 列全盘 SUID 文件，`getcap -r / 2>/dev/null` 列全盘能力文件——审计系统改动都该扫这两处。全盘扫描较慢，`-xdev` 已避免跨挂载点，也可按目录分批。

## ACL：按名字授权的完整图景

`setfacl`（set file ACL，设置文件 ACL）与 `getfacl`（get file ACL，获取文件 ACL）来自 `acl` 包。ACL 机制源自 POSIX 1003.1e 扩展标准，Linux 内核对其支持逐步完善。ugo 之外，ACL 给文件挂一张按名字的授权表，`ls -l` 权限位后的 `+` 是它的存在标志。选项来源：`setfacl` 的 `-m` = modify（修改/添加条目）、`-x` = remove（删除单条）、`-b` = remove all（全部清除）、`-k` = 删除默认 ACL、`-d` = 默认 ACL、`-R` = 递归；`getfacl` 直接跟文件名，`-p` 保留路径格式。

记忆：setfacl = set file ACL，给文件“设置”访问控制列表；getfacl = get file ACL，读取文件的 ACL 条目。

`setfacl -m u:nobody:r acl.txt` 之后 `getfacl` 显示 `user:nobody:r--` 条目；`-m g:组:权限` 加组条目，`-x u:名` 删单条。三条进阶规则决定最终效果：

- **mask 是上限**：除属主与 other 外，一切条目（具名用户、具名组、属组）的有效权限都被压到 mask 之内，`getfacl` 用 `#effective:` 标注实际值。改大授权后务必看 mask。
- **默认 ACL 让子条目自动继承**：`setfacl -d -m g:wheel:rwx 目录` 后其中新建文件自带 wheel 条目。**目录有默认 ACL 时 umask 不参与**——继承的 ACL 与创建时的 mode 共同决定权限，umask 022 与 077 下新建文件的 `getfacl` 输出可以逐行相同。
- **清理有两条**：`setfacl -k 目录` 只删默认条目，`setfacl -b 文件` 清掉全部扩展条目（`+` 消失）；`setfacl -R` 递归套用，规则同 `chmod -R` 一样要先在 `/tmp` 演练。

```bash
# 在 /tmp 演练，不需要 root
mkdir -p /tmp/lab7 && cd /tmp/lab7 && touch acl.txt
setfacl -m u:nobody:r acl.txt && getfacl acl.txt | grep -E 'user|mask'
mkdir dir && setfacl -d -m g:wheel:rwx dir
touch dir/new.txt && getfacl dir/new.txt | grep -E 'group|mask'
setfacl -k dir # 删默认条目，dir 已有文件的条目不受影响
setfacl -b acl.txt # 全部清理
```

## 文件属性：rwx 之外的开关

`chattr`（change attribute，改变属性）与 `lsattr`（ls attribute，列出属性）来自 `e2fsprogs` 包，用于管理 ext2/ext3/ext4 文件系统层属性位（需要 root，且依赖文件系统支持）。选项来源：`chattr` 的 `+i` 不可变、`+a` 只追加、`+C` 关 COW，`-i` 解除属性；`lsattr` 直接跟文件名。

记忆：chattr = change attribute，改文件系统“属性”；lsattr = ls attribute，像 ls 一样列出文件属性。

文件系统层还有一组与 rwx 正交的属性位：

| 属性 | 作用 | 典型场景 |
| ----------- | -------------------------------------- | ---------------------------------------- |
| `+i` 不可变 | root 也不能改写/删除，只能先 `-i` 解除 | 保护 `/etc/passwd`、冻结配置 |
| `+a` 只追加 | 只能追加不能覆盖 | 日志文件防篡改 |
| `+C` 关 COW | btrfs 上关闭写时复制 | 数据库文件、swapfile（见《存储进阶》章） |

```bash
# 需 sudo，/tmp 演练
cd /tmp/lab7 && echo data > attr.txt
sudo chattr +i attr.txt && lsattr attr.txt # 显示 ----i----
echo more >> attr.txt # Operation not permitted
sudo chattr -i attr.txt # 解除后可继续写
```

`namei`（name to inode，路径名到 inode）属于 util-linux 包，逐级解析路径并显示每层权限，适合排查「目录缺 x 位导致进不去」的问题。选项来源：`-l` 详细模式，显示每层权限。记忆：namei = name to inode，把路径名“翻译”成 inode，逐级看权限。

`getfattr`（get file attribute，获取扩展属性）来自 `attr` 包，读取扩展属性（xattr，如 ACL、SELinux 标签、文件能力等存储位置）。选项来源：`-d` 显示所有用户属性。记忆：getfattr = get file attribute，读取扩展属性。

属性位是「连 root 也管住」的最后一层，排查「root 删不掉文件」时先 `lsattr`。

## 判断「能不能」的顺序

遇到权限报错，按内核实际的判断顺序排查，比试错快得多：

1. **挂载选项**：`findmnt -o TARGET,OPTIONS` 看 `nosuid`/`ro`——这一层否决一切。
2. **DAC**：属主/属组/其他九位，加上 ACL 条目与 mask。
3. **特权身份**：effective UID 是不是属主/0；不是的话看 capabilities 与 SUID。
4. **强制机制**：SELinux/AppArmor 策略（第 76 章）可拒绝即使 DAC 放行的操作。

## 权限判断的失败模式与取舍

**失败模式**（按排查顺序）：

1. **只看九位权限，忽略 ACL**。`ls -l` 的 `+` 只表示「有 ACL」，真实授权要看 `getfacl` 的 `user:`、`group:`、`mask` 与 `#effective:`。
2. **忽略目录的 `x` 位**。对目录来说，`r` 能列名，`x` 能穿越，`w` 能增删条目；缺 `x` 时文件权限再大也进不去。用 `namei -l` 逐级验证。
3. **以为脚本上的 SUID 有效**。内核忽略脚本的 SUID/SGID；需要提权逻辑时用二进制、capabilities 或受控服务。
4. **capabilities 在复制/打包后丢失**。`cp` 默认不保留 xattr，`tar`/`rsync` 需要显式保留；用 `getcap` 复核。
5. **ACL mask 把权限截断**。给用户加了 `rw`，但 `mask` 只有 `r`，实际仍是只读；`getfacl` 的 `#effective` 是最终答案。
6. **在带 `nosuid` 的 `/tmp` 做 SUID 实验**。Arch 的 `/tmp` 是 tmpfs 且挂 `nosuid`，其上的 SUID 与 file capabilities 全部失效；先 `findmnt -no OPTIONS /tmp`，换到不带 `nosuid` 的目录（如家目录）再试。

**验证与回滚**：

```bash
namei -l /path/to/file          # 逐级权限
getfacl -p /path/to/file        # ACL 与 mask
getcap -r /usr 2>/dev/null | head
getfattr -d /path/to/file       # 扩展属性（attr 包）
```

ACL 备份用 `getfacl -R 目录 > acl.bak`，回滚用 `setfacl --restore=acl.bak`；文件属性（`chattr +i`）回滚要先 `chattr -i`，否则连 root 也改不了。

ACL 依赖底层文件系统支持：ext4/xfs/btrfs 默认开启，部分网络文件系统或带 `noacl` 的挂载会禁用；遇到 `setfacl` 报 `Operation not supported` 时先用 `findmnt -T 路径` 看挂载选项，不要反复重试。备份/恢复也要注意路径：`getfacl -R 目录 > acl.bak` 记录的是相对路径，`setfacl --restore=acl.bak` 需在生成备份时的同一目录下执行，否则条目会套错文件。

**取舍边界**：`chmod` 管「属主/属组/其他人」三段，ACL 管「按名字授权」，capabilities 管「给单个二进制一项特权」，三者粒度递增、可读性递减。团队共享优先「组 + setgid 目录 + umask 002」；跨组零散授权用 ACL；需要「只给绑定低端口」这类单项特权才用 capabilities。不要用 SUID 一把梭。

## 小结

- 三 UID：real 管「你是谁」，effective 管「你现在能干什么」，saved 管「回得去」；SUID 只借 effective/saved，`sudo` 则把四个 UID 全部换成目标用户。
- 解释型脚本的 SUID/SGID 被内核忽略；`nosuid` 挂载连二进制的 SUID 与 capabilities 一起关掉。
- file capabilities 把 root 拆成单点能力，`getcap/setcap` 管理，审计入口是全盘 `getcap -r / 2>/dev/null`。
- ACL 按名授权：mask 是上限，默认 ACL 让子条目继承（此时 umask 不参与），`-k`/`-b`/`-R` 管清理与递归。
- 排查顺序：挂载选项 → DAC/ACL → 有效身份与能力 → 强制机制。

## 练习

1. 用 `grep '^Uid' /proc/self/status` 记录自己的 UID 三元组，再跑一次 `sudo grep '^Uid' /proc/self/status`，解释两行差异（预期：第二组变成 `0 0 0 0`，而 `passwd` 执行时 real 仍是 1000）。
2. 按上文造 `/tmp/suid.sh` 验证脚本 SUID 无效，再做一个真正的二进制副本对比：

   ```bash
   mkdir -p /tmp/lab7 # 目录不存在时 cp 会直接失败
   sudo cp /usr/bin/id /tmp/lab7/idcopy
   sudo chown root:root /tmp/lab7/idcopy
   sudo chmod 4755 /tmp/lab7/idcopy
   findmnt -no TARGET,OPTIONS /tmp # 先看 /tmp 挂着什么选项
   /tmp/lab7/idcopy -u
   ```

   Arch 默认把 `/tmp` 挂成 tmpfs 且带 `nosuid`（本书验证环境实测 `findmnt -no OPTIONS /tmp` 含 `nosuid`），此时二进制副本同样输出你自己的 UID——SUID 位被挂载选项否决。要看到 0，换到不带 `nosuid` 的目录：先 `findmnt -T "$HOME" -no OPTIONS` 确认家目录没有 `nosuid`，再把实验移到 `$HOME/lab7` 重做。预期：脚本在任何位置都输出自身 UID；二进制在带 `nosuid` 的 `/tmp` 输出自身 UID，在不带 `nosuid` 的目录输出 `0`。
3. ACL 全流程：授权 → 看 mask 与 `#effective:` → 建默认 ACL → 验证继承 → `setfacl -k` 与 `-b` 清理（预期：`+` 标志随 `-b` 消失，`-k` 后新建文件不再继承）。
4. `getcap -r /usr 2>/dev/null | head` 演示列出带能力的文件（只看 /usr 是为了快；全盘审计用 `getcap -r / 2>/dev/null`），任选两个查它的包归属（预期：能说出每个文件的能力含义）。
5. 阅读题：解释「给脚本加 SUID root」为什么在 Linux 上不成立，并说出两条正确替代；再解释为什么「给 `bash` 设 file capabilities」同样是危险做法。

## 自检

- [ ] 能画出三 UID 在 `passwd` 执行期间的变化
- [ ] 能解释脚本 SUID 无效的原因与 `nosuid` 的作用层面
- [ ] 会用 `getcap/setcap` 授予和回收单点能力
- [ ] 能解释 mask、默认 ACL 继承与「umask 不参与」
- [ ] 遇到权限报错能按四层顺序排查

## 参考

- [File permissions and attributes](https://wiki.archlinux.org/title/File_permissions_and_attributes)
- [Access Control Lists](https://wiki.archlinux.org/title/Access_Control_Lists)
- [Capabilities](https://wiki.archlinux.org/title/Capabilities)
- [Sudo](https://wiki.archlinux.org/title/Sudo)
