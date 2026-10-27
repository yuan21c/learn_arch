# 02 用户权限与 sudo

WSL 的 Arch 镜像默认可能直接以 root 登录。这在第一次配置时方便，但长期使用会掩盖权限问题。本章把普通用户、wheel 组和 sudo 配置一次做对。

> 本章目标：创建普通用户，配置 sudo，设置 WSL 默认用户，并验证权限边界。
> 对应 Wiki：[Users and groups](https://wiki.archlinux.org/title/Users_and_groups)

## root 与普通用户

| 身份     | UID   | 能力                       | 风险                     |
| -------- | ----- | -------------------------- | ------------------------ |
| root     | 0     | 绕过权限检查，可改任何文件 | 一条错误命令即可破坏系统 |
| 普通用户 | ≥1000 | 受权限约束，提权需 sudo    | 误操作影响范围有限       |

不应长期用 root 的原因：

- 权限模型失效，任何程序都以最高权限运行。
- 误删、误改没有缓冲，`rm -rf` 的代价不可逆。
- 日常操作与系统管理混在一起，难以判断哪些操作真的需要提权。
- 很多软件拒绝以 root 运行，或以 root 运行时不加载用户配置。

```bash
# 确认当前身份
whoami
id
```

如果 `id -u` 是 0，你正在 root 下操作。

## 创建普通用户

```bash
sudo useradd -m -G wheel -s /bin/bash arch
sudo passwd arch
```

| 参数           | 作用                    |
| -------------- | ----------------------- |
| `-m`           | 创建家目录 `/home/arch` |
| `-G wheel`     | 加入附加组 wheel        |
| `-s /bin/bash` | 指定登录 shell          |
| `arch`         | 用户名                  |

## 配置 sudo

sudo 的授权规则在 `/etc/sudoers`，必须用 `visudo` 编辑，因为它在保存时会检查语法。

```bash
sudo pacman -S --needed vim
sudo EDITOR=vim visudo
```

找到这一行并取消注释：

```text
%wheel ALL=(ALL:ALL) ALL
```

含义：

| 部分        | 含义                 |
| ----------- | -------------------- |
| `%wheel`    | wheel 组的所有成员   |
| `ALL`       | 可在所有主机执行     |
| `(ALL:ALL)` | 可切换为任意用户和组 |
| `ALL`       | 可执行任意命令       |

`/etc/sudoers` 的基本结构是“谁、在哪台主机、以谁的身份、执行什么”。不要直接用普通编辑器改这个文件，语法错误会让 sudo 无法使用。

```bash
# 检查 sudoers 语法
sudo visudo -c
```

## 设置 WSL 默认用户

编辑 `/etc/wsl.conf`：

```ini
[user]
default=arch
```

在 Windows PowerShell 中关闭 WSL：

```powershell
wsl --shutdown
```

重新进入后验证：

```bash
whoami
id
```

如果你在 `wsl.conf` 中写了 `default=arch` 但用户不存在，进入时会回退到 root。先建用户，再改默认值。

## sudo、sudo -i 与 su

| 命令        | 行为                      | 适用场景                       |
| ----------- | ------------------------- | ------------------------------ |
| `sudo 命令` | 以 root 执行单条命令      | 安装包、改系统配置             |
| `sudo -i`   | 启动一个 root 登录 shell  | 需要连续执行多条管理命令       |
| `su -`      | 切换到 root，需 root 密码 | 系统未装 sudo 或需要 root 环境 |
| `su - 用户` | 切换到指定用户            | 验证另一个用户的权限与环境     |

```bash
# 单条命令提权
sudo systemctl status

# 进入 root 登录 shell，处理完立即 exit
sudo -i

# 切换到普通用户验证环境
su - arch
```

`sudo -i` 模拟 root 登录，加载 root 的环境和家目录；`sudo 命令` 默认重置环境变量，只保留少量变量。不要用 `sudo su` 这种混合写法，行为容易混淆。

## 修改默认 shell

```bash
chsh -s /bin/bash arch
```

`chsh` 修改的是登录 shell。修改后需要重新登录（或 `wsl --shutdown` 后重进）才生效。可用 shell 列表见 `/etc/shells`；如果 shell 不在其中，`chsh` 可能拒绝，先安装对应 shell 包再修改。

## 验证

```bash
whoami
id
groups
sudo -v
```

期望结果：`whoami` 为 `arch`，`id` 含 `uid=1000(arch)` 和 `wheel`，`groups` 含 `wheel`，`sudo -v` 首次要求输入 arch 的密码且成功后无输出。`sudo -v` 只刷新凭据缓存，适合验证 sudo 是否可用。

## 小结

- root 用于系统管理，不应作为日常身份。
- 用 `useradd -m -G wheel -s /bin/bash` 创建用户，用 `passwd` 设密码。
- sudo 授权在 `/etc/sudoers`，必须用 `visudo` 编辑，取消 `%wheel` 注释。
- 用 `/etc/wsl.conf` 的 `[user] default` 设置默认用户，并 `wsl --shutdown`。
- `sudo` 执行单条命令，`sudo -i` 进入 root shell，`su -` 切换用户。

## 练习

1. 创建用户 `arch`，加入 wheel，设置密码，并验证 `id`。
2. 用 `visudo` 取消 `%wheel` 注释，用 `sudo visudo -c` 检查语法。
3. 设置默认用户后 `wsl --shutdown`，重新进入确认 `whoami`。
4. 分别用 `sudo 命令`、`sudo -i`、`su - arch` 完成一个操作，记录差异。
5. 用 `chsh` 修改 shell，并用 `cat /etc/shells` 验证。

## 自检

- [ ] 能解释为什么不应长期使用 root
- [ ] 能独立创建用户并配置 wheel 组 sudo
- [ ] 知道 sudoers 必须用 visudo 编辑
- [ ] 能说清 sudo、sudo -i、su 的区别
- [ ] 能设置并验证 WSL 默认用户

## 参考

- [Users and groups](https://wiki.archlinux.org/title/Users_and_groups)
- [Sudo](https://wiki.archlinux.org/title/Sudo)
- [WSL](https://wiki.archlinux.org/title/WSL)
