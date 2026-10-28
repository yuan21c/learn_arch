# 第 49 章 Web 服务：Apache 与 Caddy

第 47 章用 nginx 走了完整流程：装、配、反代、TLS、排障。本章不重复那套流程，只做**横向对照**：什么情况下该选 Apache、什么情况下 Caddy 更省事，以及从 nginx 迁过去时哪些概念是同一回事。两个服务都只讲「够用 + 能排障」的程度，细节以 Wiki 为准。

> 本章目标：能说出 nginx、Apache、Caddy 三者在配置模型、TLS 自动化、扩展方式上的差别；能读懂 Apache 的 `httpd.conf`/vhost 结构并配一个反向代理；能用 Caddyfile 配站点与反代，理解它为何默认就有 HTTPS；知道三者互迁时哪些配置需要重写、哪些只是换个写法。
> 对应 Wiki：[Apache HTTP Server](https://wiki.archlinux.org/title/Apache_HTTP_Server)、[Caddy](https://wiki.archlinux.org/title/Caddy)

## 三者定位一张表

| 维度     | nginx                                  | Apache httpd                             | Caddy                              |
| -------- | -------------------------------------- | ---------------------------------------- | ---------------------------------- |
| 配置模型 | 层级块（`http`/`server`/`location`）   | 全局指令 + `<VirtualHost>` + `.htaccess` | 极简 DSL（Caddyfile）或 JSON       |
| 进程模型 | 事件驱动，少量 worker                  | 多进程/多线程（MPM 可配）                | Go 写的，事件驱动                  |
| TLS      | 需 certbot 或手工配证书                | 需 mod_ssl + certbot                     | **默认自动申请与续期**             |
| 扩展     | 模块需重编译（多数发行版已带常用模块） | 模块动态加载（`LoadModule`）             | 插件需重编译（官方版内置常用能力） |
| 典型优势 | 高并发静态与反代、生态最大             | 目录级 `.htaccess`、历史应用兼容         | 零配置 HTTPS、配置短               |
| 典型代价 | 配置语法坑多                           | 配置冗长、性能调优复杂                   | 生态与排障资料少于前两者           |

选择建议：新项目做反向代理或静态站，nginx 与 Caddy 都合适——**不想折腾证书选 Caddy，需要最大生态与调优空间选 nginx**；已有大量 `.htaccess` 或老应用只支持 Apache 时，继续用 Apache。

## Apache：全局指令与 vhost

（环境：WSL）

```bash
sudo pacman -S apache
sudo systemctl enable --now httpd
curl -I http://127.0.0.1
```

80 端口与第 47 章的 nginx 冲突：同机做本章实验前先 `systemctl disable --now nginx`，或把 vhost 改到 8080/8081。排障看 `/var/log/httpd/` 里的 `*_log`；Caddy 则看 `journalctl -u caddy`，两边都先过 `configtest`/`caddy validate`。

Arch 上的几个固定事实：运行用户是 `http`、站点根是 `/srv/http`、主配置 `/etc/httpd/conf/httpd.conf`、日志在 `/var/log/httpd/`（`access_log`、`error_log`）。语法检查用：

```bash
sudo apachectl configtest      # 输出 Syntax OK
```

一个 vhost（放在 `/etc/httpd/conf/extra/httpd-vhosts.conf`，并在主文件里 uncomment 对应的 `Include`）：

```apache
<VirtualHost *:80>
    ServerName app.example.local
    DocumentRoot "/srv/http/app"

    ErrorLog  "/var/log/httpd/app-error_log"
    CustomLog "/var/log/httpd/app-access_log" combined

    ProxyPreserveHost On
    ProxyPass        "/" "http://127.0.0.1:8000/"
    ProxyPassReverse "/" "http://127.0.0.1:8000/"
</VirtualHost>
```

反代需要 `mod_proxy` 与 `mod_proxy_http`。**Arch 默认的 `httpd.conf` 里这两行 `LoadModule` 是注释状态**，直接写 `ProxyPass` 会报 `Invalid command 'ProxyPass'`——先取消这两行注释，`httpd -M | grep proxy` 确认模块已加载，`configtest` 通过再 reload。`ProxyPassReverse` 负责改写后端返回的重定向地址，漏了它会出现「登录后跳回 127.0.0.1:8000」。

改完统一 `configtest` → `systemctl reload httpd`。Apache 的 `reload` 会重启 worker，短暂抖动比 nginx 明显。

**`.htaccess` 是 Apache 独有的双刃剑**：它让目录级配置可以随代码走，但也意味着每次请求都要检查目录里的文件——生产环境通常用 `AllowOverride None` 关掉它，把规则写进 vhost。

## Caddy：一个文件搞定站点与证书

（环境：WSL）

```bash
sudo pacman -S caddy
sudo systemctl enable --now caddy
```

配置文件是 `/etc/caddy/Caddyfile`，Arch 默认以 `caddy` 用户运行、站点根是 `/usr/share/caddy`。一个反代站点：

```caddy
app.example.com {
    reverse_proxy 127.0.0.1:8000
    encode gzip
}

:8080 {
    root * /srv/www/lab
    file_server
}
```

对照 nginx 的差别立刻能看出来：没有 `proxy_set_header` 一大堆——Caddy 的 `reverse_proxy` **自动设置** `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`；没有证书配置——域名可达 80/443 时它自动向 Let's Encrypt 申请并续期。

```bash
sudo caddy validate --config /etc/caddy/Caddyfile   # 语法检查
sudo caddy fmt --overwrite /etc/caddy/Caddyfile     # 格式化
sudo systemctl reload caddy
```

三个必须知道的边界：

- **自动 HTTPS 依赖域名可达**：本地 `localhost` 或内网域名拿不到公网证书，Caddy 会退回内部 CA（浏览器会警告）。本地开发用 `:8080` 这种端口写法即可。
- **证书状态**：Arch 的 `caddy.service` 把证书与账户数据放在 `/var/lib/caddy`（具体以 `systemctl cat caddy` 里的 `Environment`/`User` 为准），备份它等于备份了续期能力。
- **插件要重编译**：Caddy 的模块不像 Apache 那样 `LoadModule`，需要 `xcaddy` 重新构建——这是它生态较小的主要原因。

## 互迁时哪些要重写

| 概念       | nginx                               | Apache                                   | Caddy                          |
| ---------- | ----------------------------------- | ---------------------------------------- | ------------------------------ |
| 站点根     | `root /srv/www/x;`                  | `DocumentRoot "/srv/http/x"`             | `root * /srv/www/x`            |
| 反代       | `proxy_pass http://127.0.0.1:8000;` | `ProxyPass "/" "http://127.0.0.1:8000/"` | `reverse_proxy 127.0.0.1:8000` |
| 传 Host    | `proxy_set_header Host $host;`      | `ProxyPreserveHost On`                   | 自动                           |
| 客户端 IP  | 手工设 `X-Real-IP`                  | `mod_remoteip` 或依赖 `X-Forwarded-For`  | 自动                           |
| 大文件上传 | `client_max_body_size 20m;`         | `LimitRequestBody`                       | 默认无硬限制                   |
| 配置检查   | `nginx -t`                          | `apachectl configtest`                   | `caddy validate`               |
| TLS        | certbot / 手工                      | mod_ssl + certbot                        | 自动                           |

迁移时真正会出问题的从来不是这些语法，而是**隐式行为**：谁负责传 `Host`、谁限制了请求体大小、谁处理了 gzip、谁决定了重定向的协议。迁移前把这几项在新旧两边各验证一次，比逐行翻译配置有效得多。

## 小结

- 三者都能做静态站与反代；差别在配置模型、TLS 自动化与扩展方式。
- nginx 生态最大、调优空间足；Apache 适合 `.htaccess` 与老应用；Caddy 以「零配置 HTTPS」取胜。
- Apache：`httpd.conf` + vhost + `LoadModule`；`ProxyPassReverse` 不能漏；生产环境关掉 `.htaccess`。
- Caddy：Caddyfile 极简，`reverse_proxy` 自动补转发头，域名可达即自动签证书；插件需重编译。
- 互迁先对齐「谁传 Host、谁限体积、谁做 gzip、谁管重定向」，再谈语法翻译。

## 练习

1. Apache 起站（环境：WSL）：装好后在 `/srv/http/lab` 放一个页面，用 vhost 指向它，`apachectl configtest` 通过后 `reload`，`curl -H 'Host: lab.local'` 验证。
2. Apache 反代（环境：WSL）：给 vhost 加 `ProxyPass`/`ProxyPassReverse` 指向 8000 端口，验证访问日志里能看到后端响应；再删掉 `ProxyPassReverse`，解释出现什么差异。
3. Caddy 起站（环境：WSL）：用 `:8080` 写一个 `file_server` 站点，`caddy validate` 后 `reload`，`curl -I` 验证；对比 nginx 同样功能所需的行数。
4. Caddy 反代（环境：WSL）：`reverse_proxy 127.0.0.1:8000`，在后端打印请求头，确认 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto` 都是自动带上来的。
5. 迁移演练（环境：WSL）：把第 47 章的 nginx 反代配置翻译成 Caddyfile，逐项核对「传 Host / 限制体积 / gzip」三项行为是否等价。
6. 结论输出（环境：阅读题）：为三个场景各选一个服务并给出两条理由——(a) 个人项目要 HTTPS；(b) 公司老系统依赖 `.htaccess`；(c) 高并发静态站 + 精细调优。

## 自检

- [ ] 能用一张表说清三者的配置模型、TLS 与扩展方式差异
- [ ] 能说出 Apache 的运行用户、站点根、日志位置与语法检查命令
- [ ] 能解释 `ProxyPassReverse` 缺了会出现什么现象
- [ ] 能写出 Caddyfile 的站点与反代，并说明它自动带上了哪些头
- [ ] 知道 Caddy 自动 HTTPS 的前提，以及证书目录为什么要备份
- [ ] 能列出互迁时必须重新验证的四项隐式行为

## 参考

- [Apache HTTP Server](https://wiki.archlinux.org/title/Apache_HTTP_Server)
- [Caddy](https://wiki.archlinux.org/title/Caddy)
- [Nginx](https://wiki.archlinux.org/title/Nginx)
