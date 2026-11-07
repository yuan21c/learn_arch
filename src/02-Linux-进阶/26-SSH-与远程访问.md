# 第 26 章 SSH 与远程访问

第 24 章把 SSH 当成「远程登录的默认答案」：生成密钥、写 `~/.ssh/config`、三种端口转发、sshd 最小加固。这一章往前一步，处理**规模**带来的问题：十台机器、一百个用户时，还靠把公钥逐个贴进 `authorized_keys` 就会失控；跳板机、会话复用、agent 转发又各自有新的攻击面。本章只讲这些「多机与多用户」场景下的机制与边界，密钥生成与隧道用法不重复。

> 本章目标：能按「传输层 → 主机认证 → 用户认证」说明 SSH 的认证顺序；理解 `authorized_keys` 与 CA 证书两种信任模型的差别；会用 `ssh-keygen -s` 签发用户证书并用 `TrustedUserCAKeys` 让 sshd 接受；会用 `ProxyJump` 与 `ControlMaster` 管理多机连接；能说清 agent 转发的具体风险与替代方案；会用 `sshd -t`/`sshd -T` 与 `ssh -G` 验证配置。
> 对应 Wiki：[OpenSSH](https://wiki.archlinux.org/title/OpenSSH)、[OpenSSH/Cookbook/Certificate-based Authentication](https://wiki.archlinux.org/title/OpenSSH/Cookbook/Certificate-based_Authentication)

## 原理：三段认证与两种信任模型

一次 SSH 连接按固定顺序走三段，任何一段失败都不会进入下一段：

| 阶段 | 谁在验证谁 | 关键材料 |
| ---------- | ------------------------------ | ---------------------------------- |
| 密钥交换 | 双方协商会话密钥 | KEX 算法、服务器主机密钥 |
| 主机认证 | 客户端验证「对面是那台机器」 | `known_hosts`、主机证书 |
| 用户认证 | 服务器验证「你是谁」 | 公钥、证书、密码、键盘交互 |

主机认证发生在用户认证之前，这是 SSH 防中间人的基础：`known_hosts` 里的指纹变了，客户端会拒绝连接（或要求确认），而不是继续把口令发过去。用户认证可以叠加多种方法，例如「公钥 + 动态口令」；`AuthenticationMethods` 就是用来声明「必须依次通过哪几种」的。

### authorized_keys vs CA 证书

两种信任模型的区别不在密码学，而在**信任的落点**：

| 对比 | authorized_keys | CA 证书 |
| ---------- | ------------------------------------ | -------------------------------------- |
| 信任单元 | 每个用户的每一把公钥 | 一个 CA 公钥 |
| 新用户 | 逐台机器追加公钥 | 用 CA 签一张证书 |
| 吊销 | 逐台删行（容易漏） | 短有效期 + 吊销列表（`RevokedKeys`） |
| 权限约束 | 靠 `authorized_keys` 行首选项 | 写进证书（有效期、principal、扩展） |
| 适用 | 单机、少量用户 | 多机、多用户、临时访问 |

证书里几个字段必须认识：**principals** 决定「这张证书能以哪些用户名登录」，**validity** 决定有效期，**extensions** 决定允不允许端口转发、agent 转发、PTY 等。`ssh-keygen -L` 能把一张证书的全部内容打印出来。

关键一点：证书是**由 CA 私钥签名**的，服务器只需要信任 CA 公钥（`TrustedUserCAKeys`），不再需要为每个用户维护 `authorized_keys`。这把「用户管理」从「每台机器都改」变成了「在 CA 处签一次」。

## 步骤：从签发到登录

### 1. 建 CA、签用户证书

以下命令已在本书验证环境中实测，全部在 `/tmp` 下完成，不碰系统密钥：

```bash
mkdir -p /tmp/lab26 && cd /tmp/lab26
ssh-keygen -q -t ed25519 -N '' -f ca # CA 私钥 ca + 公钥 ca.pub
ssh-keygen -q -t ed25519 -N '' -f user # 用户密钥对
ssh-keygen -s ca -I alice -n alice,backup -V +1h user.pub
ssh-keygen -L -f user-cert.pub # 检查证书内容
```

`-I` 是证书的 Key ID（便于审计），`-n` 是 principals（能用哪些用户名登录），`-V +1h` 是有效期。签发后会生成 `user-cert.pub`。`ssh-keygen -L` 的预期输出包含 `Type: ssh-ed25519-cert-v01@openssh.com user certificate`、`Principals: alice, backup`，以及默认扩展 `permit-X11-forwarding`、`permit-agent-forwarding`、`permit-port-forwarding`、`permit-pty`、`permit-user-rc`——**默认是全开的**，需要收紧时用 `-O` 显式关闭（如 `-O no-port-forwarding`）。

### 2. 让 sshd 信任 CA

服务端只需要一行配置：

```text
TrustedUserCAKeys /etc/ssh/ca.pub
```

之后任何由该 CA 签发、principal 与目标用户名匹配、且在有效期内的证书都能登录。要把 principal 与系统用户解耦，再加 `AuthorizedPrincipalsFile`（列出该用户接受哪些 principal）。证书登录与 `authorized_keys` 可以并存，迁移期两者都开，稳定后再关掉后者。

**可复现的端到端实验**：在 127.0.0.1 的 2200 端口起一个临时 sshd，不碰系统 sshd：

```bash
# 把 y2c 换成你的用户名
ssh-keygen -q -s ca -I test -n y2c -V +1h user.pub # 用你的用户名作为 principal
cat > sshd.conf <<'EOF'
Port 2200
ListenAddress 127.0.0.1
HostKey /etc/ssh/ssh_host_ed25519_key
PidFile /tmp/lab26/sshd.pid
AuthorizedKeysFile none
TrustedUserCAKeys /tmp/lab26/ca.pub
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
LogLevel VERBOSE
EOF
sudo sshd -t -f sshd.conf # 先验语法，预期无输出、退出码 0
sudo /usr/bin/sshd -f /tmp/lab26/sshd.conf -E /tmp/lab26/sshd.log
ssh -p 2200 -i user -o CertificateFile=user-cert.pub \
  -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no y2c@127.0.0.1 'echo CERT_LOGIN_OK'
sudo kill "$(sudo cat /tmp/lab26/sshd.pid)" # 结束临时 sshd
```

`AuthorizedKeysFile none` 明确关掉传统公钥路径，这样能证明登录成功**只可能**来自证书。`StrictHostKeyChecking=no` 与 `UserKnownHostsFile=/dev/null` 只用于这个一次性实验，生产环境不要这么写。

### 3. 跳板与连接复用

多机环境里两条最常用的路径：

```bash
ssh -J jump@bastion deploy@10.0.0.20 # 经跳板直连内网机（ProxyJump）
```

`ProxyJump` 在客户端与目标机之间建立一条转发通道，跳板机只看得到加密流量，不需要在跳板上装任何工具。配置里写成：

```text
Host internal
  HostName 10.0.0.20
  User deploy
  ProxyJump bastion
Host bastion
  HostName 203.0.113.10
  User jump
```

连接复用（ControlMaster）把多次连接共享同一条 TCP 与同一次认证，适合频繁执行远端命令：

```text
Host *
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 10m
```

```bash
ssh -O check internal # 检查复用主连接是否还在
ssh -O exit internal # 主动关闭主连接
```

`ControlPath` 是本地 Unix socket，权限要受限；多人共用一台跳板机时，`ControlPath` 不要放在全局可写目录。

### 4. Match 块：按用户/来源收紧策略

`sshd_config` 的 `Match` 块让同一台服务器对不同来源应用不同策略：

```text
Match User backup
    AllowTcpForwarding no
    ForceCommand /usr/local/bin/backup-shell
Match Address 203.0.113.0/24
    PasswordAuthentication yes
```

两条规则：**Match 块里只能使用部分关键字**（不是所有全局选项都能放进去），**同一关键字在多个匹配块中只有第一个生效**。改完必须 `sshd -t` 查语法，再用 `sshd -T -C user=...,host=...,addr=...` 看某个具体场景下的**最终生效值**——这比人眼推断 Match 的叠加顺序可靠。

### 5. 客户端侧的验证工具

```bash
ssh -G prod # 打印解析后的最终配置（不连接）
ssh -G -F /tmp/lab26/config prod # 用指定配置文件解析
ssh -vvv user@host # 三段握手的详细过程，看用了哪把钥匙、哪条认证路径
ssh-keygen -lf ~/.ssh/id_ed25519.pub # 指纹
```

`ssh -G` 是排查「配置为什么不生效」的首选：它把 `Host` 匹配、默认值、命令行覆盖全部展开成最终结果。配置优先级从高到低是命令行 `-o`、用户 `~/.ssh/config`、系统 `/etc/ssh/ssh_config`；同一关键字**第一次出现的值生效**，所以 `Host *` 要放在文件末尾。

## 失败模式

- **agent 转发被滥用**：`ssh -A` 会把本地的 `SSH_AUTH_SOCK` 暴露到远端。远端 root 或同用户下的任意进程都能借用你的私钥去登录**其他**机器。风险不在「这台机器」，而在「你的钥匙能去的所有地方」。替代方案优先 `ProxyJump`；必须开时用 `ssh-add -c`（每次使用需确认）或 `ssh-add -t`（限时）。
- **证书 principal 不匹配**：证书签的是 `alice`，却用 `bob` 登录，sshd 会拒绝。用 `ssh-keygen -L` 确认 principals，用 `ssh -vvv` 看服务端拒绝原因。
- **CA 私钥没有隔离**：CA 私钥能签任何用户、任何 principal 的证书，等于最高权限。它应离线保存或放在受控的签名服务里，绝不能和普通用户密钥混在一起。
- **`AllowUsers` 与证书冲突**：`AllowUsers` 按用户名过滤，证书 principal 也必须落在允许范围内；迁移时容易「证书签了但用户被 AllowUsers 挡住」。
- **`Match` 顺序误判**：多个 Match 块命中同一关键字时只有第一个生效，且部分关键字不允许出现在 Match 中；`sshd -t` 会报错，`sshd -T -C` 才能看到最终值。
- **主机指纹变化**：可能是重装系统，也可能是中间人。先通过带外渠道核对指纹，不要直接删 `known_hosts`。
- **`reload` 与 `restart` 混淆**：`systemctl reload sshd` 重读配置但保留现有连接；`restart` 会断开所有会话。改配置后先 `sshd -t`，再 reload，并**保留一个已登录会话**验证新连接。
- **ControlMaster socket 泄漏**：socket 权限过宽，同机其他用户可能复用你的已认证连接；放在 `~/.ssh` 下并确保目录 `700`。

## 验证与回滚

| 操作 | 验证 | 回滚 |
| ---------------------- | ---------------------------------------------- | ------------------------------------------ |
| 改 sshd 配置 | `sshd -t` 语法检查；`sshd -T -C ...` 看生效值 | 恢复备份文件后 reload |
| 启用 CA 登录 | 用证书登录一次，再用无证书的密钥登录确认被拒 | 注释 `TrustedUserCAKeys` 并 reload |
| 收紧 Match 策略 | `sshd -T -C` 对应场景；实连验证 | 删除 Match 块，reload |
| 开 agent 转发 | `ssh-add -l` 在远端能看到钥匙即证明已暴露 | 客户端 `ForwardAgent no`，重连 |
| 改客户端配置 | `ssh -G host` 对比前后最终值 | 恢复 `~/.ssh/config` |

一条纪律：**每次改 sshd 都保留一个已登录会话**。新配置有问题时，旧会话还能进去修；如果只靠新连接，一旦认证路径被关掉就只能上控制台。

## 取舍边界

- **密码 vs 公钥 vs 证书**：密码最易用但可被撞库；公钥安全但分发麻烦；证书把分发变成「签一次」，适合多机。单机个人用公钥足够，超过几台机器就该考虑 CA。
- **authorized_keys vs CA**：前者简单、可见、无需额外服务；后者集中、可吊销、可约束。小规模别过度设计，大规模别手工维护。
- **ProxyJump vs agent 转发**：ProxyJump 只转发网络通道，不暴露私钥；agent 转发方便但把钥匙的使用权交给了远端。能用 ProxyJump 就不要用 `-A`。
- **ControlMaster vs 独立连接**：复用减少握手开销，适合脚本化频繁操作；但它把「认证状态」留在本地 socket 上，共享机器上要谨慎。
- **主机证书 vs known_hosts**：主机证书让新机器第一次连接就能被验证（客户端只信任 CA），适合大规模；known_hosts 简单，但每台新机都要人工确认一次。
- **2FA 的强度**：`AuthenticationMethods publickey,keyboard-interactive` 能显著提高门槛，但也引入「第二因素服务不可用就没人能登录」的可用性风险；关键系统要保留应急路径。

## 小结

- SSH 三段：密钥交换 → 主机认证 → 用户认证；`known_hosts` 保护的是第二段。
- 两种信任模型：`authorized_keys` 信任每把钥匙，CA 信任一个签名者；证书把用户、有效期、权限写在一起。
- `ssh-keygen -s ca -I id -n principals -V +1h user.pub` 签发；`TrustedUserCAKeys` 让 sshd 接受；`ssh-keygen -L` 检查证书。
- 跳板优先 `ProxyJump`（`-J`）；频繁操作可用 ControlMaster，`ssh -O check/exit` 管理主连接。
- agent 转发会把私钥使用权交给远端，能不用就不用；必须用时加确认或限时。
- `Match` 只支持部分关键字，同一关键字第一个匹配生效；用 `sshd -T -C` 看最终值。
- 改 sshd 的固定流程：`sshd -t` → reload → 保留旧会话验证新连接。

## 练习

1. 证书检查（`/tmp` 演练）：建 CA 与用户密钥，签发一张带两个 principal、有效期 1 小时的证书，用 `ssh-keygen -L` 读出 Type、Principals、Valid、Extensions 五项（预期：能看到 `permit-agent-forwarding` 等默认扩展）。
2. 收紧证书（`/tmp` 演练）：重新签发一张证书，用 `-O no-port-forwarding -O no-agent-forwarding` 关闭两项扩展，再用 `ssh-keygen -L` 对比差异；说明为什么「默认全开」是一个需要主动处理的边界。
3. 端到端登录（按正文在本机临时起 sshd）：按正文在 2200 端口起临时 sshd，用证书登录成功；再把 `TrustedUserCAKeys` 注释掉重载，确认同一把证书被拒（预期：第一次输出 `CERT_LOGIN_OK`，第二次 `Permission denied`）。
4. 配置解析：写一个含 `Host prod` 与 `Host *` 的配置文件，用 `ssh -G -F <文件> prod` 看 hostname/user/port/identityfile 的最终值；再在命令行加 `-p 2222`，确认命令行覆盖配置文件。
5. Match 验证（按正文在本机临时起 sshd）：写两个 Match 块（按 User 与按 Address），用 `sshd -T -C user=...,host=...,addr=...` 分别模拟命中的场景，记录最终生效的 `passwordauthentication` 与 `allowtcpforwarding`。
6. 风险分析题：解释「`ssh -A` 到一台不可信机器」与「`ProxyJump` 到同一台机器」在私钥暴露上的差别；再给出两条不用 agent 转发也能访问内网的办法。

## 自检

- [ ] 能按顺序说出 SSH 的三段认证，并解释主机认证为什么在用户认证之前
- [ ] 能对比 authorized_keys 与 CA 证书两种信任模型，说出各自的吊销方式
- [ ] 能默写签发用户证书的命令，并用 `ssh-keygen -L` 读出 principals 与有效期
- [ ] 能配置 `TrustedUserCAKeys` 并说明 principal 与系统用户名的关系
- [ ] 能写出 ProxyJump 配置与 ControlMaster 的三行配置
- [ ] 能具体说明 agent 转发的风险，以及两种替代方案
- [ ] 会用 `sshd -t`、`sshd -T -C`、`ssh -G` 验证配置，并知道改 sshd 要保留旧会话

## 参考

- [OpenSSH](https://wiki.archlinux.org/title/OpenSSH)
- [OpenSSH/Cookbook/Certificate-based Authentication](https://wiki.archlinux.org/title/OpenSSH/Cookbook/Certificate-based_Authentication)
- [ssh(1)](https://man.archlinux.org/man/ssh.1)
- [sshd_config(5)](https://man.archlinux.org/man/sshd_config.5)
