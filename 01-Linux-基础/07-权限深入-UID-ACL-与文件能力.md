# 第 7 章 权限深入：UID、ACL 与文件能力

第 6 章的九位权限回答了「属主/属组/其他各能做什么」，但有三个问题它答不了：`passwd` 凭什么替你改 shadow（有效身份是什么）、脚本加 SUID 为什么没用、怎么只给张三授权而不影响李四。这三问分别落到 UID 三元组、file capabilities 与 ACL，也正是理解 `sudo`、容器隔离与提权攻击的基础。

> 本章目标：能区分 real/effective/saved UID 并解释提权工具的原理；知道脚本 SUID 无效与 `nosuid` 挂载的作用；会用 `getcap/setcap` 管理文件能力；掌握 ACL 的按名授权、mask、默认 ACL 继承与清理。
> 对应 Wiki：[File permissions and attributes](https://wiki.archlinux.org/title/File_permissions_and_attributes)、[Access Control Lists](https://wiki.archlinux.org/title/Access_Control_Lists)、[Capabilities](https://wiki.archlinux.org/title/Capabilities)

## 三个 UID：real、effective、saved

一个进程不是「一个身份」，而是三个：**real UID**（谁启动的）、**effective UID**（此刻以谁的权限干活）、**saved UID**（之前的有效身份，供回落）。内核判权限看的是 effective；`ps` 的 `USER`/`UID` 列默认显示的也是 effective（要看 real 用 `ps -o ruid=`），审计日志则另外记录登录身份 `auid`。看自己的三元组（环境：WSL）：

```bash
grep '^Uid' /proc/self/status
# Uid:  1000  1000  1000  1000      依次是 real、effective、saved、fs
```

SUID 程序是三元组的日常表演者：你（real=1000）执行 `/usr/bin/passwd` 的瞬间，effective 变成文件属主 root（0），于是能读写 shadow；程序退出后回到你。`sudo` 走的是另一条路：它 exec 的目标进程四个 UID 全部被置为目标用户（`0 0 0 0`），而不是像 SUID 那样只改 effective/saved、保留 real——对比两者能看清「借身份」与「换身份」的差别，策略由 `/etc/sudoers` 决定（见《sudo 与提权安全》章）。root 的特权还常被拆成 capabilities，下一节讲。

## 脚本上的 SUID/SGID 无效

内核**忽略解释型脚本上的 SUID/SGID 位**：`chmod u+s backup.sh` 之后执行它，effective UID 仍然是你自己。原因是执行脚本的其实是 `bash`/`python`，被 SUID 的文件从未作为可执行映像被加载——否则任何人都能复制你的脚本、改一行就提权。

```bash
# 环境：WSL，/tmp 演练
printf '#!/bin/bash\nid -u\n' > /tmp/suid.sh && chmod 4755 /tmp/suid.sh
/tmp/suid.sh                # 输出 1000，不是 0——SUID 被忽略
ls -l /tmp/suid.sh          # -rwsr-xr-x（位还在，但不起作用）
```

需要提权的脚本有两条正路：编译成二进制（C/Rust/Go），或包一层经过审计的专用包装器（例如由 sudo 规则调用的极小二进制，或以 root 运行的服务）。**不要给 `bash`/`python` 等通用解释器设置 file capabilities**——脚本执行时生效的是解释器二进制的能力，等于给该解释器运行的所有脚本乃至交互 shell 开了同一个提权口子，与「SUID bash」同级高危（机制见上一节，ArchWiki Capabilities 亦有警示）。

**`nosuid` 挂载选项**把这类保护从「文件行为」上升到「挂载点」：`mount -o nosuid` 后该文件系统上所有 SUID/SGID 与 file capabilities 一概失效，网络共享（如 NFS）常带此选项；容器内 SUID 失效则更多来自 capability 边界集与运行时默认安全配置，不宜只归因于 `nosuid`（以所用容器运行时的文档为准）。

## file capabilities：SUID 的精细替代

Capabilities 把「root 无所不能」拆成单点能力（`cap_setuid`、`cap_net_bind_service`、`cap_sys_admin`……），程序只带需要的几块：

```bash
# 环境：WSL，需 sudo；setcap/getcap 来自 libcap 包
getcap /usr/bin/ping          # 当前 iputils 的 ping 无文件能力（输出为空）；旧版常见 cap_net_raw=ep
getcap -r /usr 2>/dev/null    # 想观察真实的能力文件，看 newuidmap/newgidmap 一类
sudo setcap cap_net_bind_service=+ep /usr/local/bin/myserver   # 换成你自己的二进制，该文件须已存在
getcap /usr/local/bin/myserver
sudo setcap -r /usr/local/bin/myserver   # 清除
```

`cap_net_bind_service=+ep` 的 `e/p` 是 effective/permitted 两集的开关。相比 SUID root：给一个专用二进制（不是脚本）设 `cap_dac_override`，它只能绕权限检查，给不了关机、改内核参数的能力，爆炸半径小得多。排查特权入口的两个口子：`find /usr/bin -perm -4000` 列 SUID 文件，`getcap -r /usr` 列能力文件——审计系统改动都该扫这两处。

## ACL：按名字授权的完整图景

ugo 之外，ACL 给文件挂一张按名字的授权表，`ls -l` 权限位后的 `+` 是它的存在标志。`setfacl -m u:nobody:r acl.txt` 之后 `getfacl` 显示 `user:nobody:r--` 条目；`-m g:组:权限` 加组条目，`-x u:名` 删单条。三条进阶规则决定最终效果：

- **mask 是上限**：除属主与 other 外，一切条目（具名用户、具名组、属组）的有效权限都被压到 mask 之内，`getfacl` 用 `#effective:` 标注实际值。改大授权后务必看 mask。
- **默认 ACL 让子条目自动继承**：`setfacl -d -m g:wheel:rwx 目录` 后其中新建文件自带 wheel 条目。**目录有默认 ACL 时 umask 不参与**——继承的 ACL 与创建时的 mode 共同决定权限，umask 022 与 077 下新建文件的 `getfacl` 输出可以逐行相同。
- **清理有两条**：`setfacl -k 目录` 只删默认条目，`setfacl -b 文件` 清掉全部扩展条目（`+` 消失）；`setfacl -R` 递归套用，规则同 `chmod -R` 一样要先在 `/tmp` 演练。

```bash
# 环境：WSL，/tmp 演练
mkdir -p /tmp/lab7 && cd /tmp/lab7 && touch acl.txt
setfacl -m u:nobody:r acl.txt && getfacl acl.txt | grep -E 'user|mask'
mkdir dir && setfacl -d -m g:wheel:rwx dir
touch dir/new.txt && getfacl dir/new.txt | grep -E 'group|mask'
setfacl -k dir          # 删默认条目，dir 已有文件的条目不受影响
setfacl -b acl.txt      # 全部清理
```

## 文件属性：rwx 之外的开关

文件系统层还有一组与 rwx 正交的属性位，`lsattr` 查看、`chattr` 修改（需要 root，且依赖文件系统支持）：

| 属性        | 作用                                   | 典型场景                                 |
| ----------- | -------------------------------------- | ---------------------------------------- |
| `+i` 不可变 | root 也不能改写/删除，只能先 `-i` 解除 | 保护 `/etc/passwd`、冻结配置             |
| `+a` 只追加 | 只能追加不能覆盖                       | 日志文件防篡改                           |
| `+C` 关 COW | btrfs 上关闭写时复制                   | 数据库文件、swapfile（见《存储进阶》章） |

```bash
# 环境：WSL，需 sudo，/tmp 演练
cd /tmp/lab7 && echo data > attr.txt
sudo chattr +i attr.txt && lsattr attr.txt      # 显示 ----i----
echo more >> attr.txt                           # Operation not permitted
sudo chattr -i attr.txt                         # 解除后可继续写
```

属性位是「连 root 也管住」的最后一层，排查「root 删不掉文件」时先 `lsattr`。

## 判断「能不能」的顺序

遇到权限报错，按内核实际的判断顺序排查，比试错快得多：

1. **挂载选项**：`findmnt -o TARGET,OPTIONS` 看 `nosuid`/`ro`——这一层否决一切。
2. **DAC**：属主/属组/其他九位，加上 ACL 条目与 mask。
3. **特权身份**：effective UID 是不是属主/0；不是的话看 capabilities 与 SUID。
4. **强制机制**：SELinux/AppArmor 策略（第 53 章）可拒绝即使 DAC 放行的操作。

## 小结

- 三 UID：real 管「你是谁」，effective 管「你现在能干什么」，saved 管「回得去」；SUID 只借 effective/saved，`sudo` 则把四个 UID 全部换成目标用户。
- 解释型脚本的 SUID/SGID 被内核忽略；`nosuid` 挂载连二进制的 SUID 与 capabilities 一起关掉。
- file capabilities 把 root 拆成单点能力，`getcap/setcap` 管理，审计入口是 `getcap -r /usr`。
- ACL 按名授权：mask 是上限，默认 ACL 让子条目继承（此时 umask 不参与），`-k`/`-b`/`-R` 管清理与递归。
- 排查顺序：挂载选项 → DAC/ACL → 有效身份与能力 → 强制机制。

## 练习

1. 用 `grep '^Uid' /proc/self/status` 记录自己的 UID 三元组，再跑一次 `sudo grep '^Uid' /proc/self/status`，解释两行差异（环境：WSL；预期：第二组变成 `0 0 0 0`，而 `passwd` 执行时 real 仍是 1000）。
2. 按上文造 `/tmp/suid.sh` 验证脚本 SUID 无效，再做一个真正的二进制副本对比：`sudo cp /usr/bin/id /tmp/lab7/idcopy && sudo chown root:root /tmp/lab7/idcopy && sudo chmod 4755 /tmp/lab7/idcopy`，随后 `/tmp/lab7/idcopy -u`；先 `findmnt /tmp` 确认未挂 `nosuid`（环境：WSL；预期：脚本输出自身 UID，二进制输出 0）。
3. ACL 全流程：授权 → 看 mask 与 `#effective:` → 建默认 ACL → 验证继承 → `setfacl -k` 与 `-b` 清理（环境：WSL；预期：`+` 标志随 `-b` 消失，`-k` 后新建文件不再继承）。
4. `getcap -r /usr 2>/dev/null | head` 列出系统上带能力的文件，任选两个查它的包归属（环境：WSL；预期：能说出每个文件的能力含义）。
5. 阅读题：解释「给脚本加 SUID root」为什么在 Linux 上不成立，并说出两条正确替代；再解释为什么「给 `bash` 设 file capabilities」同样是危险做法（环境：阅读题）。

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
