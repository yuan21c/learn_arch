# 第 27 章 Arch 的用户、sudo 与默认 shell

篇一第 8 章已经把用户与用户组讲全了：三本账（`passwd`/`shadow`/`group`）、`useradd` 系命令、`id`、`su` 与 `sudo` 的原理、密码策略。本章不重复那些内容，只处理 Arch 与 WSL 特有的三件事：**wheel 组与 sudo 的授权方式、WSL 的默认用户、默认 shell 的修改**。

> 本章目标：能创建加入 wheel 组的普通用户并用 drop-in 方式授权 sudo；理解 `/etc/sudoers` 与 `/etc/sudoers.d/` 的分工及为什么必须用 `visudo`；会用 `/etc/wsl.conf` 设置 WSL 默认用户并处理「改错后回退 root」的情况；会用 `chsh` 修改登录 shell 并知道它何时生效。
> 对应 Wiki：[Users and groups](https://wiki.archlinux.org/title/Users_and_groups)、[Sudo](https://wiki.archlinux.org/title/Sudo)、[WSL](https://wiki.archlinux.org/title/WSL)

## wheel 组：Arch 的提权惯例

不同发行版用不同的组来标记「可提权用户」：Debian 系常用 `sudo` 组，Arch 用 **wheel** 组。这个差别不是风格问题——`/etc/sudoers` 里默认被注释掉的那一行写的就是 `%wheel`，所以新用户不加进 wheel，就没法用 sudo。

```bash
id -nG              # 当前用户所属的组
getent group wheel  # wheel 组有哪些成员
```

`getent` 比 `cat /etc/group` 更可靠：它走完整的 nsswitch 链路，能反映 LDAP 等非本地来源（第 18 章讲过这个原理）。

## 创建首个普通用户

（环境：WSL，需要 root 或已有 sudo 权限）

```bash
sudo useradd -m -G wheel -s /bin/bash arch
sudo passwd arch
```

| 参数 | 作用 |
| --- | --- |
| `-m` | 创建家目录 `/home/arch` 并复制 `/etc/skel` 的初始文件 |
| `-G wheel` | 加入附加组 wheel（决定能否 sudo） |
| `-s /bin/bash` | 指定登录 shell |
| `arch` | 用户名 |

`-m` 不能省：Arch 的 `useradd` 默认**不**创建家目录，漏了它会出现「能登录但没有 `~`」的怪状态。家目录的初始文件来自 `/etc/skel`，这也是第 10 章讲启动文件的落点。

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
sudo visudo -c          # 语法检查，输出 parsed OK 才算成功
```

四个要点：

- **必须用 `visudo`**：它在保存时做语法检查，并在你写坏时拒绝保存。直接用编辑器改 sudoers 出错，会让所有 sudo 失效——包括修它自己的 sudo。
- **drop-in 优先**：`/etc/sudoers.d/` 下的文件由主文件里的 `@includedir` 加载，升级时不会被包管理器覆盖；主文件则可能被更新为 `.pacnew`（第 38 章）。
- **文件名有约定**：不要用带 `.` 或以 `~` 结尾的名字，`sudo` 会忽略它们；常见写法是 `10-wheel`、`20-deploy`。
- **权限必须是 `0440`**：`visudo -f` 会自动处理，手工 `chmod` 时要记得。

授权粒度可以更细，例如只允许 wheel 组管理服务：

```text
%wheel ALL=(root) /usr/bin/systemctl
```

但限制得过细反而增加维护成本——大多数桌面/开发机用整组全权即可，服务器才需要按命令拆分（第 53 章的安全加固会再谈）。

## WSL 的默认用户

WSL 的 Arch 镜像首次进入时常常直接是 root。改默认用户要动 `/etc/wsl.conf`：

```ini
[user]
default=arch
```

在 Windows 侧执行：

```powershell
wsl --shutdown
```

重新进入后验证 `whoami` 与 `id`。有两个坑：

- **用户必须已存在**：`default=arch` 而 `arch` 不存在时，WSL 会回退到 root，看起来像「配置没生效」；先建用户再改配置。
- **改坏了怎么进**：配置写错导致进不去时，用 `wsl -u root` 以 root 身份进入并修文件，不必卸载重装。

`/etc/wsl.conf` 还管其他行为（`[interop]`、`[automount]`、`[boot]`），第 26 章已经配置过首次启动所需的部分。

## 默认 shell

```bash
chsh -s /bin/bash arch     # 改指定用户的登录 shell
chsh -l                    # 列出 /etc/shells 中允许的 shell
```

三个注意点：`chsh` 改的是**登录 shell**，已在运行的会话不受影响，需要重新登录（或 `wsl --shutdown` 后重进）；目标 shell 必须列在 `/etc/shells` 里，否则 `chsh` 拒绝——想用 zsh 得先装包再改；`chsh` 不带用户名时改的是自己，改别人需要 root。

脚本的 shebang 与登录 shell 是两件事：shebang 指定的是「用哪个解释器跑这个脚本」，与你的登录 shell 无关（第 14 章）。

## 验证与边界

```bash
whoami                  # arch
id                      # uid=1000(arch) gid=1000(arch) groups=1000(arch),998(wheel)
id -nG                  # 含 wheel
sudo -v                 # 刷新凭据缓存；要求输入 arch 的密码，成功则无输出
sudo -l                 # 列出当前用户被允许执行的命令
```

`sudo -v` 是判断「sudo 是否可用」最轻的动作：它不执行任何命令，只验证密码与授权。`sudo -l` 则能看清到底授了什么权——排查「为什么这条命令提权被拒」时先看它。

`su`、`sudo -i`、`sudo 命令` 三者的区别、`sudo` 默认重置环境变量的行为，都在篇一第 8 章讲过了，这里不再复述。

## 小结

- Arch 用 wheel 组标记可提权用户；不加进 wheel，sudo 一定失败。
- 建用户用 `useradd -m -G wheel -s /bin/bash`，`-m` 不能省（Arch 默认不建家目录）。
- 授权优先写 `/etc/sudoers.d/10-wheel`（drop-in），而不是改主文件；编辑一律用 `visudo`，改完 `visudo -c`。
- WSL 默认用户在 `/etc/wsl.conf` 的 `[user] default`，改完 `wsl --shutdown`；配置坏了用 `wsl -u root` 进去修。
- `chsh` 改登录 shell，必须重新登录才生效，且目标 shell 要在 `/etc/shells` 里。
- 验证三件套：`id -nG`、`sudo -v`、`sudo -l`。

## 练习

1. 建用户并验证（环境：WSL）：创建 `lab` 用户加入 wheel，`id lab` 确认 UID、GID 与 wheel；再 `su - lab` 后用 `sudo -v` 验证提权可用。
2. drop-in 授权（环境：WSL）：删掉主文件里 `%wheel` 的注释（若本来就没开），改用 `/etc/sudoers.d/10-wheel` 授权，`visudo -c` 验证；再用 `sudo -l -U lab` 查看授权结果。
3. 语法检查的价值（环境：WSL）：用 `visudo -f` 打开 drop-in，故意写一行语法错误，观察保存时是否被拒绝；恢复后确认 `sudo` 仍可用。
4. WSL 默认用户（环境：WSL + PowerShell）：设置 `[user] default=lab`，`wsl --shutdown` 后重进验证 `whoami`；再把用户名改成不存在的 `nobodyx`，重进观察是否回退 root，最后用 `wsl -u root` 修回。
5. 默认 shell（环境：WSL）：`chsh -l` 查看允许的 shell，把 `lab` 的 shell 改成 `/bin/bash`，重新登录验证 `echo $SHELL` 与 `getent passwd lab` 的最后一段。
6. 权限边界（环境：WSL）：用 `lab` 尝试 `sudo -l` 之外的两条命令——`cat /etc/shadow`（应失败）与 `sudo cat /etc/shadow`（应成功），解释两次结果差异来自哪一层检查。

## 自检

- [ ] 能说出 Arch 为什么用 wheel 组，以及不加组时 sudo 会怎样
- [ ] 能独立创建普通用户，并解释 `useradd -m` 为什么不能省
- [ ] 能说出 drop-in 相对改主文件的两个好处
- [ ] 能解释为什么必须用 `visudo`，以及 `visudo -c` 检查什么
- [ ] 能配置 WSL 默认用户，并知道配置写坏时怎么进系统修
- [ ] 能说出 `chsh` 改的是什么、何时生效、为什么目标 shell 要在 `/etc/shells` 里
- [ ] 能用 `id -nG`、`sudo -v`、`sudo -l` 三项验证权限配置

## 参考

- [Users and groups](https://wiki.archlinux.org/title/Users_and_groups)
- [Sudo](https://wiki.archlinux.org/title/Sudo)
- [WSL](https://wiki.archlinux.org/title/WSL)
