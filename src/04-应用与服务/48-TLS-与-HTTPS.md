# 第 48 章 TLS 与 HTTPS

第 47 章把 nginx 的 HTTP 站点跑通了，但浏览器地址栏的锁、以及「明文传输」这件事，都要靠 TLS 收口。本章自成一块：证书是怎么被信任的、本地自签怎么立刻用起来、公网证书怎么申请与续期。WSL 能做自签全流程；公网申请需要域名与开放的 80/443。

> 本章目标：能解释 CA、证书链与有效期的作用；会用 OpenSSL 自签（含 SAN）并在 nginx 上开 443；能用 certbot 申请公网证书并显式启用自动续期；知道证书文件的路径、权限与排障入口。
> 对应 Wiki：[Transport Layer Security](https://wiki.archlinux.org/title/Transport_Layer_Security)、[nginx](https://wiki.archlinux.org/title/Nginx)

## TLS 在防什么

HTTP 明文传输三宗罪：窃听（谁都能读）、篡改（中间人可改）、冒充（你连的不是你以为的服务器）。TLS 用证书解决后两件：服务器出示由 CA 签发的证书，客户端用内置的 CA 公钥验证签名与域名，再协商出一次性会话密钥加密流量。

| 概念   | 一句话                                        |
| ------ | --------------------------------------------- |
| 证书   | 绑定域名与公钥、由 CA 签名的声明              |
| CA     | 客户端预先信任的签名机构，决定「谁签的才认」  |
| 证书链 | 叶子证书 → 中间 CA → 根 CA，逐级验签          |
| 有效期 | 证书有到期日（公网现约 90 天），过期即告警    |
| 自签   | 自己当 CA，客户端不会预信任，需手动跳过或导入 |

## 本地自签：五分钟开起 443

自签证书浏览器必然告警，但开发与内网验证足够（环境：WSL）：

```bash
sudo mkdir -p /etc/nginx/tls
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout /etc/nginx/tls/lab.key -out /etc/nginx/tls/lab.crt \
  -subj "/CN=example.local" \
  -addext "subjectAltName=DNS:example.local,IP:127.0.0.1"
sudo chmod 600 /etc/nginx/tls/lab.key
```

nginx 侧开一个 443 server，并让 80 跳转过来：

```nginx
server {
    listen 80;
    server_name example.local;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name example.local;
    ssl_certificate     /etc/nginx/tls/lab.crt;
    ssl_certificate_key /etc/nginx/tls/lab.key;
    root /usr/share/nginx/html;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -k https://127.0.0.1/     # -k 跳过自签校验，预期 200
```

`curl` 默认会拒绝自签证书——这是正确行为，`-k` 只用于自测。要用系统级信任就把 `lab.crt` 导入信任库，但更推荐本地验证就停在 `-k`。

## 公网证书：certbot 与自动续期

公网证书由 Let's Encrypt 等 CA 免费签发，前提是 CA 能验证你对域名的控制权（HTTP-01 走 80 端口、DNS-01 走 TXT 记录）。若启用了防火墙，必须放行 80/443（见第 18、53 章），否则 HTTP-01 验证无法完成：

```bash
# 环境：VM 或有公网域名的服务器
sudo pacman -S certbot certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
sudo systemctl enable --now certbot-renew.timer   # 不启用，就不会自动续期
systemctl list-timers | grep -i certbot           # 确认下次触发时间
sudo certbot renew --dry-run                      # 演练续期，预期 Dry run was successful
```

`certbot --nginx` 会自动改 nginx 配置装证书；两个关键运维点：

- **续期要显式启用**：Arch 的包提供 `certbot-renew.service` 与 `certbot-renew.timer`，但不会自动启用；`sudo systemctl enable --now certbot-renew.timer` 后，用 `systemctl list-timers | grep -i certbot` 与 `sudo certbot renew --dry-run` 形成验证闭环。
- **reload 要联动**：用 `certbot --nginx` 时，续期后插件会自动 reload nginx；只有 `certonly`/`webroot` 方案才需要自己配 `--post-hook "systemctl reload nginx"`（写进续期 service 的 `ExecStart`，以 Wiki 为准）。`renew --dry-run` 默认不执行 post/deploy hook，想验证 hook 需加 `--run-deploy-hooks`。

## 证书路径、权限与排障

| 位置                            | 内容                                         | 权限要求                                                         |
| ------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| `/etc/letsencrypt/live/<域名>/` | certbot 产物：`fullchain.pem`、`privkey.pem` | 私钥仅 root 可读                                                 |
| `/etc/nginx/tls/`               | 自签/自管证书                                | 私钥 `chmod 600`                                                 |
| `/var/log/nginx/error.log`      | TLS 握手错误（默认进 journald）              | `journalctl -u nginx` 优先；server 块指定 `error_log` 后才落文件 |
| `/etc/ssl/certs/`               | 系统信任的 CA 根证书                         | 验证 `Verify return code` 时对照                                 |

排障三板斧：

```bash
sudo nginx -t                          # 配置语法先行
openssl s_client -connect 127.0.0.1:443 -servername example.local </dev/null
# 看输出里的 Verify return code 与证书链
curl -vk https://example.local/ 2>&1 | grep -E 'SSL|subject|issuer'
```

常见故障对照：浏览器报「不受信任」= 自签或链不完整（`fullchain.pem` 才含中间证书）；报「已过期」= 续期没跑或没 reload；报「名称不匹配」= 证书 SAN 与访问域名不符（现代客户端只看 SAN，不再看 CN，所以自签时必须用 `-addext "subjectAltName=..."`）。

## 小结

- TLS 解决窃听/篡改/冒充；信任来自 CA 签名链与有效期校验。
- 自签用 `openssl req -x509` + nginx `listen 443 ssl`，`curl -k` 只用于自测。
- 公网证书用 certbot 申请；`enable --now certbot-renew.timer` 后才自动续期，`renew --dry-run` 验证，`--nginx` 方案续期后自动 reload。
- 私钥权限 600；排障顺序 `nginx -t` → `openssl s_client` → `curl -vk`。

## 练习

1. 先让域名可解析：在 `/etc/hosts` 加一行 `127.0.0.1 example.local`（或每次请求用 `curl --resolve example.local:443:127.0.0.1`）。自签一张 CN=example.local 的证书并按上文配置 nginx 443，`curl -k https://example.local/` 验证（环境：WSL；预期：返回 200 且响应走 HTTPS）。
2. 不带 `-k` 跑 `curl https://127.0.0.1/`，记录报错并解释它在防什么（环境：WSL；预期：报证书验证失败）。
3. 用 `openssl s_client -connect 127.0.0.1:443 </dev/null` 输出里的 `subject`/`issuer` 解释自签证书「自己签自己」的体现（环境：WSL；预期：两者相同或均为你自己）。
4. 配好 80→301 跳转后用 `curl -I http://example.local/` 验证（环境：WSL；预期：301 且 Location 为 https；域名解析同练习 1，也可加 `--resolve example.local:80:127.0.0.1`）。
5. 阅读题：解释「续期成功但浏览器仍报过期」最可能漏掉了哪一步（环境：阅读题）。
6. 阅读题：为什么证书要用 `fullchain.pem` 而不是 `cert.pem`（环境：阅读题）。

## 自检

- [ ] 能画出「CA → 证书链 → 客户端验证」的信任路径
- [ ] 会自签证书并配置 nginx 443 与 80 跳转
- [ ] 知道 certbot 申请、dry-run 续期、reload 三步闭环
- [ ] 能说出私钥权限要求与三个排障命令
- [ ] 能对照「不受信任/过期/名称不匹配」三类报错定位原因

## 参考

- [Transport Layer Security](https://wiki.archlinux.org/title/Transport_Layer_Security)
- [nginx](https://wiki.archlinux.org/title/Nginx)
- [Certbot](https://wiki.archlinux.org/title/Certbot)
