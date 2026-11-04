# 第 64 章 Web 服务：nginx

从这一章起进入「把服务跑起来」的阶段。nginx 是最常见的入口：它既能做静态文件服务器，也能做反向代理，把请求转给后端的应用（Python、Node、Java）。本章按「装 → 配 → 反代 → TLS → 排障」的顺序走，除公网证书申请外全部操作都能在本地 Arch（VM 或真机）上完成。

> 本章目标：能安装并启动 nginx，理解 `nginx.conf` 与 `conf.d` 的分工；会写 server 块托管静态站点，并处理 SPA 的 `try_files`；能把请求反代到本机应用并正确传递 `Host`/`X-Forwarded-*` 头；会用 certbot 配 TLS 并自动续期；能用 `nginx -t`、访问日志与错误日志定位问题。
> 对应 Wiki：[Nginx](https://wiki.archlinux.org/title/Nginx)

## 安装与第一次访问



```bash
sudo pacman -S nginx
sudo systemctl enable --now nginx
systemctl status nginx
curl -I http://127.0.0.1
```

第一次访问看到默认页就说明链路通了。三个要立刻知道的点：

- **Arch 的 nginx 以 `http` 用户运行**，不是 `www-data`（Debian）也不是 `nginx`（RHEL）。文件权限判断要看 `http`。
- 默认站点根目录是 `/usr/share/nginx/html`，主配置在 `/etc/nginx/nginx.conf`。
- **日志分两路**：错误日志以 `--error-log-path=stderr` 编译，默认进 `journalctl -u nginx`（`/var/log/nginx/error.log` 默认不存在）；访问日志默认落文件 `/var/log/nginx/access.log`（配 logrotate 轮转），server 块里可另指路径。

## 配置结构：主文件与片段

`/etc/nginx/nginx.conf` 是主文件，分成 `events`（连接处理）与 `http`（HTTP 相关）两大块。**Arch 的默认配置只 include 了 `modules.d/*.conf` 与 `mime.types`，并没有 `conf.d`**——所以第一步是自己在 `http` 块末尾加一行：

```nginx
include /etc/nginx/conf.d/*.conf;
```

```bash
sudo mkdir -p /etc/nginx/conf.d
sudoedit /etc/nginx/conf.d/site.conf
```

漏了这一行，你写进 `conf.d/` 的站点**完全不会被读取**，而 `nginx -t` 依然通过——这是本章最容易踩的坑。

改完先测语法，再让配置生效：

```bash
sudo nginx -t # 语法与路径检查，输出 syntax is ok / test is successful
sudo systemctl reload nginx # 平滑重载：现有连接不断
```

`reload` 与 `restart` 的区别要记住：`reload` 让 worker 平滑切换，不中断连接；`restart` 会停掉主进程，连接全断。**绝大多数改动（虚拟主机、TLS、`listen` 端口）用 `reload` 即可**——nginx 会先打开新的 listen socket 再平滑换 worker；`user`/`worker_processes` 一类主配置项若 reload 后未生效，再用 `restart`。

## 托管静态站点

一个最小可用的 server 块：

```nginx
server {
 listen 80 default_server; # 抢下默认站点，见下方要点
 server_name example.local;

 root /srv/www/example;
 index index.html;

 # 不写则 error 进 journald、access 落 /var/log/nginx/access.log
 access_log /var/log/nginx/example.access.log;
 error_log /var/log/nginx/example.error.log;

 location / {
 try_files $uri $uri/ =404;
 }
}
```

要点：

- `root` 指向的目录必须让 `http` 用户可读（目录 `755`、文件 `644`）；否则报 `403 Forbidden`。
- `try_files $uri $uri/ =404` 是静态站的标准写法：先找文件，再找目录，都没有才 404。
- **前端 SPA**（React/Vue）要把最后一项换成 `index.html`：`try_files $uri $uri/ /index.html;`，否则刷新子路由会 404。
- 多个站点共用一个 IP 时，`server_name` 决定命中哪个 server 块；**Arch 自带的默认 server（`listen 80; server_name localhost;`）在 `conf.d` include 之前**，按 IP 访问或 Host 不匹配的请求都会落到它（看到默认页就是这个原因）。要抢占就写 `listen 80 default_server;`——同一端口只能有一个 `default_server`，两个都写才会报 duplicate，不需要改主配置；测试时也可用 `curl -H 'Host: example.local'` 命中自己的站点。
- 本章占 80 端口；同机做第 66 章的 Apache/Caddy 实验前先 `systemctl disable --now nginx`，或把对方改到 8080/8081。

## 反向代理：把请求交给应用

应用监听 `127.0.0.1:8000`（由第 63 章的 unit 托管）时，nginx 负责对外：

```nginx
server {
 listen 80;
 server_name app.example.local;

 location / {
 proxy_pass http://127.0.0.1:8000;
 proxy_http_version 1.1;

 proxy_set_header Host $host;
 proxy_set_header X-Real-IP $remote_addr;
 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 proxy_set_header X-Forwarded-Proto $scheme;

 proxy_read_timeout 60s;
 client_max_body_size 20m;
 }
}
```

四个 `proxy_set_header` 通常必须显式设置，不是装饰（`Host` 不传时默认是 `$proxy_host`，反代一般要传原始 Host）：

- 不传 `Host`，后端生成的绝对 URL、重定向会变成 `127.0.0.1:8000`；
- 不传 `X-Real-IP`/`X-Forwarded-For`，应用日志里全是 `127.0.0.1`，限流与审计失效；
- 不传 `X-Forwarded-Proto`，应用无法判断用户走的是 HTTP 还是 HTTPS，可能陷入重定向循环。

`client_max_body_size` 默认只有 1 MB，上传大文件会报 `413 Request Entity Too Large`——这是「本地测都正常，一上线就传不了」的经典原因。

WebSocket 应用还要加升级头：

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

## TLS：certbot 与自动续期

TLS 的信任模型、本地自签与排障见第 65 章；本节只走 certbot 的公网快速路径。

公网域名 + 可达 80 端口时，用 certbot 一条命令搞定（也可在有公网主机时执行；本地域名要拿公网证书只能靠 DNS-01 验证或端口转发，通常直接自签）。若启用了防火墙，记得放行 80/443（见第 24、76 章）：

```bash
sudo pacman -S certbot certbot-nginx
sudo certbot --nginx -d app.example.com
```

certbot 会改写你的 server 块（加 `listen 443 ssl`、证书路径、80→443 跳转）。**续期不是装完就自动**：Arch 的包不会自动启用单元，必须显式启用 timer 并验证：

```bash
sudo systemctl enable --now certbot-renew.timer # 包提供的是 certbot-renew.timer
systemctl list-timers | grep -i certbot # 看到下次触发时间才算生效
sudo certbot renew --dry-run # 演练续期，不真的换证书
```

本地开发不折腾证书，直接用 HTTP + `localhost` 即可；需要 HTTPS 时用自签证书（浏览器会警告，属正常）。

## 排障：三个命令定位八成问题

```bash
sudo nginx -t # 语法/路径错误
sudo journalctl -u nginx -b --no-pager | tail -50 # 默认日志位置（启动失败、502、403 的根因）
sudo tail -20 /var/log/nginx/access.log # 请求是否到达、返回码、耗时（默认即落此文件）
```

对照表：

| 现象 | 常见原因 |
| ----------------- | ------------------------------------------------------------ |
| `502 Bad Gateway` | 后端没起来、端口写错、`proxy_pass` 指向了 `0.0.0.0` 而非回环 |
| `403 Forbidden` | `root` 目录权限不足，或 `autoindex` 关闭且无 `index.html` |
| `404` 但文件存在 | `root` 与 `location` 拼接错位，或 SPA 没配 `try_files` |
| `413` | `client_max_body_size` 太小 |
| 改了配置没生效 | 忘了 `reload`，或改动写在了不生效的文件里 |

`502` 的一个高频细节：后端只监听 `127.0.0.1` 时，`proxy_pass http://127.0.0.1:8000` 可以通；写 `http://localhost:8000` 在某些环境下会先解析到 `::1`（IPv6）导致连不上。**反代地址优先写具体 IP**。

## 失败模式

配置写对却访问不到，八成不是语法问题，而是「文件没被读、站点没命中、权限不够」三类：

- **写进 `conf.d/` 却仍是默认页**：`http {}` 里没有 `include /etc/nginx/conf.d/*.conf;`。`nginx -t` 依然通过，因为没读到的文件不参与检查。
- **`nginx -t` 报 duplicate default server**：同一 `listen` 端口写了两个 `default_server`。保留一个，其余去掉该参数。
- **`403 Forbidden`**：`root` 目录对 `http` 用户不可读（目录要 `755`、文件要 `644`），或目录里没有 `index.html` 且未开 `autoindex`。
- **`502 Bad Gateway` 且后端明明在跑**：`proxy_pass http://localhost:8000` 被解析到 `::1`，而后端只监听 IPv4。改成 `127.0.0.1:8000`。
- **上传报 `413`**：`client_max_body_size` 默认 1 MB，未按业务调大。
- **证书到期**：`certbot-renew.timer` 没有 `enable`，或续期后没有 reload；`certbot renew --dry-run` 能提前暴露。

还有一个隐蔽项：用 `sudoedit` 改配置但改的是 `/etc/nginx/nginx.conf` 的备份文件，`reload` 自然不生效。先 `nginx -T | grep -n 'server_name'` 确认生效配置里真的有你的站点。

## 验证与回滚

改配置的固定动作是「备份 → 测试 → 重载 → 请求验证」：

```bash
sudo cp /etc/nginx/conf.d/site.conf /etc/nginx/conf.d/site.conf.bak
sudo nginx -t
sudo systemctl reload nginx
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: example.local' http://127.0.0.1/
ss -tlnp | grep ':80'
```

`curl` 必须带正确的 `Host`，否则请求落到默认站点，验证的是别人。返回码符合预期后再看日志：

```bash
sudo journalctl -u nginx -b --no-pager | tail -30
sudo tail -5 /var/log/nginx/access.log
```

回滚就是把备份覆盖回来，再走一遍同样的四步：

```bash
sudo cp /etc/nginx/conf.d/site.conf.bak /etc/nginx/conf.d/site.conf
sudo nginx -t && sudo systemctl reload nginx
```

若新配置导致 nginx 起不来，`systemctl status nginx` 会停在 `failed`；此时不要反复 `restart`，先恢复备份再重载。`reload` 失败不会杀掉旧 worker，旧站点通常仍在服务，这给了你修复窗口。

## 取舍边界

- **nginx vs Caddy/Apache**：要最大生态、精细调优、成熟反代选 nginx；不想管证书、配置越短越好选 Caddy；依赖 `.htaccess` 或老应用选 Apache（第 66 章）。
- **反代 vs 直接暴露应用**：应用自己监听公网端口会失去统一的 TLS、限流、日志与灰度入口；多一层 nginx 换来的是可运维性，代价是多一跳与一份配置。
- **TLS 终止在 nginx**：证书与私钥集中一处，后端走明文回环；适合单机。若合规要求链路全程加密，则要反代到后端也走 TLS。
- **`reload` vs `restart`**：虚拟主机、TLS、`listen` 改动用 `reload`，连接不中断；`user`/`worker_processes` 等主配置项若 reload 后未生效，才用 `restart`。
- **抢 `default_server` vs 用 Host 测试**：生产上明确指定默认站点；实验阶段用 `curl -H` 命中目标站点，避免影响同机其他站点。
- **日志粒度**：访问日志保留全量便于审计，但要配 logrotate；调高日志级别会显著增加磁盘与 I/O，排障结束后应降回。

## 小结

- 装完先 `enable --now` 并用 `curl -I` 验证；Arch 的 nginx 以 `http` 用户运行，默认没有 `conf.d`，先在 `http {}` 里加 `include /etc/nginx/conf.d/*.conf;`，改完 `nginx -t` → `reload`。
- 静态站用 `try_files`；SPA 的最后一项换成 `/index.html`。
- 反代的四个头（`Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`）通常要显式设置；上传要调 `client_max_body_size`。
- TLS 交给 certbot，续期靠 `certbot-renew.timer`，用 `--dry-run` 验证。
- 排障三件套：`nginx -t`、`journalctl -u nginx`、`access.log`；`502` 先查后端与地址。

## 练习

1. 静态站：在 `/srv/www/lab` 放一个 `index.html`，写 `conf.d/lab.conf`，用 `curl -I -H 'Host: lab.example.local' http://127.0.0.1/` 验证（不带 Host 会落到默认站点）；故意把目录权限改成 `700`，观察 `403` 并从 `journalctl -u nginx` 找证据（Arch 包默认 `error_log stderr`，日志进 journal）；或先配置 `error_log /var/log/nginx/error.log;` 再从 error.log 看。
2. SPA 路由：把 `try_files` 改成 `/index.html`，用 `curl -I -H 'Host: <你的 server_name>' http://127.0.0.1/some/route` 验证返回 200 而不是 404（不带 Host 会落到默认站点）。
3. 反向代理：用第 63 章的 `demo.service` 或 `python3 -m http.server 8000` 起后端，配反代后用 `curl -H 'Host: app.example.local' http://127.0.0.1/` 验证（Host 必须与 `server_name` 一致，否则会落到默认站点）；再删掉 `proxy_set_header Host`，对比后端看到的头。
4. 413 复现：用 `curl -F file=@大文件` 上传超过 1 MB 的文件触发 `413`，调大 `client_max_body_size` 后重试成功。
5. 502 排查：停掉后端，访问页面记录 `502`；从 `journalctl -u nginx`（或在 server 里配了 `error_log` 后从该文件）找出 `connect() failed` 的具体地址，再改回正确端口。
6. 日志分析：用 `ab` 或循环 `curl` 产生 50 个请求，从 `access.log` 统计状态码分布（`awk` 一行即可）。默认 combined 格式不含请求耗时；要统计平均耗时，先在 server 块加含 `$request_time` 的 `log_format`。

## 自检

- [ ] 能说出 Arch 上 nginx 的运行用户、默认站点根与日志位置
- [ ] 能解释 `nginx.conf` 与 `conf.d` 的分工，以及 `reload` 和 `restart` 的差别
- [ ] 能写出静态站与 SPA 两种 `try_files` 写法并说明差别
- [ ] 能说出反代必需的四个头，以及各自缺失时的症状
- [ ] 知道 `client_max_body_size` 默认值及其导致的经典故障
- [ ] 能用 certbot 配 TLS，并用 `--dry-run` 验证续期
- [ ] 能按「`nginx -t` → error.log → access.log」的顺序定位 `502`/`403`/`413`

## 参考

- [Nginx](https://wiki.archlinux.org/title/Nginx)
- [nginx 官方文档](https://nginx.org/en/docs/)
- [Certbot](https://wiki.archlinux.org/title/Certbot)
