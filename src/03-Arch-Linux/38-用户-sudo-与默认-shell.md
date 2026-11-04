# 第 38 章 用户、sudo 与默认 shell

篇一第 8–9 章已经把用户、用户组与 sudo 的语法和安全模型讲全了：三本账（`passwd`/`shadow`/`group`）、`useradd` 系命令、`id`、`su` 与 `sudo` 的原理、密码策略。`sudo` 的日常动词与审计在第 9 章，本章不重复那些内容，只处理 Arch 特有的三件事：**wheel 组与 sudo 的授权方式、首个普通用户的创建、默认 shell 的修改**。

> 本章目标：能创建加入 wheel 组的普通用户并用 drop-in 方式授权 sudo；理解 `/etc/sudoers` 与 `/etc/sudoers.d/` 的分工及为什么必须用 `visudo`；会用 `chsh` 修改登录 shell 并知道它何时生效。
> 对应 Wiki：[Users and groups](https://wiki.archlinux.org/title/Users_and_groups)、[Sudo](https://wiki.archlinux.org/title/Sudo)

## wheel 组：Arch 的提权惯例

不同发行版用不同的组来标记「可提权用户」：Debian 系常用 `sudo` 组，Arch 用 **wheel** 组。这个差别不是风格问题——`/etc/sudoers` 里默认被注释掉的那一行写的就是 `%wheel`，所以新用户不加进 wheel，就没法用 sudo。

```bash
id -nG # 当前用户所属的组
getent group wheel # wheel 组有哪些成员
```

`getent` 比 `cat /etc/group` 更可靠：它走完整的 nsswitch 链路，能反映 LDAP 等非本地来源（第 24 章讲过这个原理）。

## 创建首个普通用户

（需要 root 或已有 sudo 权限）

```bash
sudo useradd -m -G wheel -s /bin/bash arch
sudo passwd arch
```

| 参数 | 作用 |
| -------------- | ----------------------------------------------------- |
| `-m` | 创建家目录 `/home/arch` 并复制 `/etc/skel` 的初始文件 |
| `-G wheel` | 加入附加组 wheel（决定能否 sudo） |
| `-s /bin/bash` | 指定登录 shell |
| `arch` | 用户名 |

`-m` 不能省：Arch 的 `useradd` 默认**不**创建家目录，漏了它会出现「能登录但没有 `~`」的怪状态。家目录的初始文件来自 `/etc/skel`，这也是第 10 章讲启动文件的落点。

创建后立刻验证：

```bash
id arch
getent passwd arch
ls -ld /home/arch
```

`id` 输出里应出现 `wheel`，`ls -ld` 应显示家目录属主为 `arch`。三者有一次不符，就回到 `useradd` 参数检查，不要带着半成品继续授权。

## 授权 sudo：改主文件还是加 drop-in

`/etc/sudoers` 的主文件末尾有一行被注释掉的 `%wheel ALL=(ALL:ALL) ALL`。取消注释就能授权，但**更推荐的做法是写一个 drop-in 文件**：

```bash
sudo visudo -f /etc/sudoers.d/10-wheel
```

在打开的文件里写：

```text
%wheel ALL=(ALL:ALL) ALL
```

保存退出后用 `visudo -c` 检查全部规则：

```bash
sudo visudo -c # 语法检查，输出 parsed OK 才算成功
```

四个要点：

- **首选 `visudo`**（编辑 drop-in 用 `visudo -f 文件`）：它在保存时做语法检查，写坏时不落盘并进入 `What now?` 询问——`e` 重新编辑；`x` 不保存退出；`Q` 是带语法错误强存（危险），任何时候都不要选。直接用编辑器改 sudoers 出错，会让所有 sudo 失效——包括修它自己的 sudo。
- **drop-in 优先**：`/etc/sudoers.d/` 下的文件由主文件里的 `@includedir` 加载，升级时不会被包管理器覆盖；主文件则可能被更新为 `.pacnew`（第 52 章）。
- **文件名有约定**：不要用带 `.` 或以 `~` 结尾的名字，`sudo` 会忽略它们；常见写法是 `10-wheel`、`20-deploy`。
- **权限必须是 `0440`**：`visudo -f` 是否自动设置权限随版本而定，稳妥做法是显式 `sudo chown root:root 文件 && sudo chmod 0440 文件`，再用 `sudo -l` 确认授权生效。

授权粒度可以更细，例如只允许 wheel 组管理服务：

```text
%wheel ALL=(root) /usr/bin/systemctl
```

但限制得过细反而增加维护成本——大多数桌面/开发机用整组全权即可，服务器才需要按命令拆分（第 76 章的安全加固会再谈）。

## 默认 shell

```bash
sudo chsh -s /bin/bash arch # 改指定用户的登录 shell（改别人需 root）
chsh -l # 列出 /etc/shells 中允许的 shell
```

三个注意点：`chsh` 改的是**登录 shell**，已在运行的会话不受影响，需要重新登录才生效；目标 shell 必须列在 `/etc/shells` 里，否则 `chsh` 拒绝——想用 zsh 得先装包再改；`chsh` 不带用户名时改的是自己，改别人需要 root。

脚本的 shebang 与登录 shell 是两件事：shebang 指定的是「用哪个解释器跑这个脚本」，与你的登录 shell 无关（第 14 章）。

## 验证与边界

```bash
whoami # arch
id # uid=1000(arch) gid=1000(arch) groups=1000(arch),998(wheel)
id -nG # 含 wheel
sudo -v # 刷新凭据缓存；要求输入 arch 的密码，成功则无输出
sudo -l # 列出当前用户被允许执行的命令
```

`sudo -v` 是判断「sudo 是否可用」最轻的动作：它不执行任何命令，只验证密码与授权。`sudo -l` 则能看清到底授了什么权——排查「为什么这条命令提权被拒」时先看它。

`su`、`sudo -i`、`sudo 命令` 三者的区别、`sudo` 默认重置环境变量的行为，都在篇一第 8–9 章讲过了，这里不再复述。

## 失败模式

- **`useradd` 漏掉 `-m`**：Arch 默认不创建家目录，用户能登录却没有 `~`，后续配置全部落空；补建家目录还要修复属主。
- **忘了 `-G wheel`**：账户存在但 sudo 一定失败；`/etc/sudoers` 里默认生效的是 `%wheel`，不是所有用户。
- **直接编辑 `/etc/sudoers`**：写坏一行会让所有 sudo 失效，包括修它自己的 sudo；必须用 `visudo`。
- **drop-in 权限或文件名不合规**：文件必须是 `root:root`、`0440`，文件名不能带 `.` 或以 `~` 结尾，否则 sudo 静默忽略。
- **`chsh` 目标 shell 不在 `/etc/shells`**：命令直接拒绝；先装包，再把路径加入 `/etc/shells`。
- **改完 shell 不重新登录**：`chsh` 只改登录 shell，当前会话仍是旧 shell；验证必须开新会话。
- **用 `sudo -i` 当权限测试**：它开一个 root shell，容易在错误身份下继续操作；轻量验证用 `sudo -v` 与 `sudo -l`。

## 验证与回滚

```bash
sudo visudo -c # 语法检查全部 sudoers，输出 parsed OK
id lab # uid/gid 与 wheel 组
id -nG lab # 组列表含 wheel
getent passwd lab # 家目录与登录 shell
ls -ld /home/lab # 属主应为 lab
sudo -l -U lab # 该用户被授予哪些命令
su - lab -c 'sudo -v' # 以 lab 身份验证 sudo 可用
```

`visudo -c` 是改 sudo 配置后的第一道门；`sudo -l -U` 不执行命令就能看清授权。回滚：删除或修正 drop-in 后再 `visudo -c`；撤销用户用 `userdel -r lab`（会删家目录，先确认里面没有要保留的数据）；shell 改回 `chsh -s /bin/bash lab`。实验可在一次性虚拟机中创建 `lab`、完成授权与验证后删除，属于可逆操作；不要在主账号上试错。

## 取舍边界

- **drop-in vs 主文件**：drop-in 不被包升级覆盖、便于按用途拆分；只有需要改全局默认（如 `Defaults`）时才动主文件。
- **整组全权 vs 按命令授权**：桌面/开发机用 `%wheel ALL=(ALL:ALL) ALL` 足够；服务器按命令拆分，降低误操作半径。
- **`/bin/bash` vs zsh/fish**：登录 shell 应选自己熟悉的；交互体验可以靠终端复用器与配置补，不必为此换 shell。
- **`su` vs `sudo`**：`su` 切换身份但保留较多环境，`sudo` 按命令提权并有审计；日常提权用 `sudo`，完整会话才用 `su -`。
- **密码缓存时长**：默认缓存方便但共享账号有风险；多用户机器可用 `sudo -k` 或配置更短超时。

## 小结

- Arch 用 wheel 组标记可提权用户；不加进 wheel，sudo 一定失败。
- 建用户用 `useradd -m -G wheel -s /bin/bash`，`-m` 不能省（Arch 默认不建家目录）。
- 授权优先写 `/etc/sudoers.d/10-wheel`（drop-in），而不是改主文件；编辑一律用 `visudo`，改完 `visudo -c`。
- 创建完立刻用 `id`、`getent passwd`、`ls -ld /home` 三处验证，再谈授权。
- `chsh` 改登录 shell，必须重新登录才生效，且目标 shell 要在 `/etc/shells` 里。
- 验证三件套：`id -nG`、`sudo -v`、`sudo -l`。

## 练习

1. 建用户并验证：创建 `lab` 用户加入 wheel，`sudo passwd lab` 设密码（不设则账号锁定、`su - lab` 必然认证失败），`id lab` 确认 UID、GID 与 wheel；再按练习 2 落好 drop-in 授权后 `su - lab`，用 `sudo -v` 验证提权可用（预期：要求输入 lab 的密码，成功则无输出）。
2. drop-in 授权：删掉主文件里 `%wheel` 的注释（若本来就没开），改用 `/etc/sudoers.d/10-wheel` 授权，`visudo -c` 验证；再用 `sudo -l -U lab` 查看授权结果。
3. 语法检查的价值：用 `visudo -f` 打开 drop-in，故意写一行语法错误，观察保存时是否被拒绝；恢复后确认 `sudo` 仍可用。
4. 默认 shell：`chsh -l` 查看允许的 shell，把 `lab` 的 shell 改成 `/etc/shells` 中另一个（如 `/bin/zsh`，未装则先 `sudo pacman -S zsh`），重新登录验证 `echo $SHELL` 与 `getent passwd lab` 的最后一段；再用 `chsh -s /bin/bash lab` 改回并验证。
5. 凭据缓存：以 `lab` 登录，`sudo -v` 刷新凭据后再执行一条提权命令，确认不再要求密码；随后 `sudo -k` 清除缓存，再执行提权命令（预期：重新要求输入密码）。说明为什么共享账号下这个缓存需要手动清除。
6. 权限边界：用 `lab` 尝试 `sudo -l` 之外的两条命令——`cat /etc/shadow`（应失败）与 `sudo cat /etc/shadow`（应成功），解释两次结果差异来自哪一层检查。

## 自检

- [ ] 能说出 Arch 为什么用 wheel 组，以及不加组时 sudo 会怎样
- [ ] 能独立创建普通用户，并解释 `useradd -m` 为什么不能省
- [ ] 能说出 drop-in 相对改主文件的两个好处
- [ ] 能解释为什么必须用 `visudo`，以及 `visudo -c` 检查什么
- [ ] 能说明创建用户后如何验证 wheel 与 sudo 是否生效
- [ ] 能说出 `chsh` 改的是什么、何时生效、为什么目标 shell 要在 `/etc/shells` 里
- [ ] 能用 `id -nG`、`sudo -v`、`sudo -l` 三项验证权限配置

## 参考

- [Users and groups](https://wiki.archlinux.org/title/Users_and_groups)
- [Sudo](https://wiki.archlinux.org/title/Sudo)
- 上一章：[第 37 章 首次启动与基础验收](37-首次启动与基础验收.md)
- 下一章：[第 39 章 安装后配置与镜像源备份](39-安装后配置与镜像源备份.md)
