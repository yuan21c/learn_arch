# 第 41 章 Web 服务：nginx

从这一章起进入「把服务跑起来」的阶段。nginx 是最常见的入口：它既能做静态文件服务器，也能做反向代理，把请求转给后端的应用（Python、Node、Java）。本章按「装 → 配 → 反代 → TLS → 排障」的顺序走，全部操作在 WSL 的 Arch 上完成。

> 本章目标：能安装并启动 nginx，理解 `nginx.conf` 与 `conf.d` 的分工；会写 server 块托管静态站点，并处理 SPA 的 `try_files`；能把请求反代到本机应用并正确传递 `Host`/`X-Forwarded-*` 头；会用 certbot 配 TLS 并自动续期；能用 `nginx -t`、访问日志与错误日志定位问题。
> 对应 Wiki：[Nginx](https://wiki.archlinux.org/title/Nginx)

## 安装与第一次访问

（环境：WSL）

```bash
sudo pacman -S nginx
sudo systemctl enable --now nginx
systemctl status nginx
curl -I http://127.0.0.1
```

第一次访问看到默认页就说明链路通了。三个要立刻知道的点：

- **Arch 的 nginx 以 `http` 用户运行**，不是 `www-data`（Debian）也不是 `nginx`（RHEL）。文件权限判断要看 `http`。
- 默认站点根目录是 `/usr/share/nginx/html`，配置在 `/etc/nginx/nginx.conf`。
- 日志在 `/var/log/nginx/access.log` 与 `error.log`，排障先看后者。

## 配置结构：主文件与片段

`/etc/nginx/nginx.conf` 是主文件，分成 `events`（连接处理）与 `http`（HTTP 相关）两大块。Arch 的默认配置在 `http` 块里 include 了 `/etc/nginx/conf.d/*.conf`（以你机器上的实际内容为准），所以**站点配置应该写到 `conf.d/` 下**，而不是改主文件：

```bash
sudo mkdir -p /etc/nginx/conf.d
sudoedit /etc/nginx/conf.d/site.conf
```

改完先测语法，再让配置生效：

```bash
sudo nginx -t                 # 语法与路径检查，输出 syntax is ok / test is successful
sudo systemctl reload nginx   # 平滑重载：现有连接不断
```

`reload` 与 `restart` 的区别要记住：`reload` 让 worker 平滑切换，不中断连接；`restart` 会停掉主进程，连接全断。**改站点配置用 `reload`，改端口/用户等需要重新绑定 socket 的配置才用 `restart`**（实际上 reload 也能处理端口变化，但重启更直观）。

## 托管静态站点

一个最小可用的 server 块：

```nginx
server {
    listen 80;
    server_name example.local;

    root /srv/www/example;
    index index.html;

    access_log /var/log/nginx/example.access.log;
    error_log  /var/log/nginx/example.error.log;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

要点：

- `root` 指向的目录必须让 `http` 用户可读（目录 `755`、文件 `644`）；否则报 `403 Forbidden`。
- `try_files $uri $uri/ =404` 是静态站的标准写法：先找文件，再找目录，都没有才 404。
- **前端 SPA**（React/Vue）要把最后一项换成 `index.html`：`try_files $uri $uri/ /index.html;`，否则刷新子路由会 404。
- 多个站点共用一个 IP 时，`server_name` 决定命中哪个 server 块；没有匹配的落到 `default_server`。

## 反向代理：把请求交给应用

应用监听 `127.0.0.1:8000`（由第 40 章的 unit 托管）时，nginx 负责对外：

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

四个 `proxy_set_header` 是必需的，不是装饰：

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

公网域名 + 可达 80 端口时，用 certbot 一条命令搞定（环境：VM 或公网主机；WSL 本地只能自签）：

```bash
sudo pacman -S certbot certbot-nginx
sudo certbot --nginx -d app.example.com
```

certbot 会改写你的 server 块（加 `listen 443 ssl`、证书路径、80→443 跳转）。续期由 `certbot.timer` 负责，检查它是否在跑：

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run    # 演练续期，不真的换证书
```

本地开发不折腾证书，直接用 HTTP + `localhost` 即可；需要 HTTPS 时用自签证书（浏览器会警告，属正常）。

## 排障：三个命令定位八成问题

```bash
sudo nginx -t                                  # 语法/路径错误
sudo tail -50 /var/log/nginx/error.log         # 启动失败、502、403 的根因
sudo tail -20 /var/log/nginx/access.log        # 请求是否到达、返回码、耗时
```

对照表：

| 现象 | 常见原因 |
| --- | --- |
| `502 Bad Gateway` | 后端没起来、端口写错、`proxy_pass` 指向了 `0.0.0.0` 而非回环 |
| `403 Forbidden` | `root` 目录权限不足，或 `autoindex` 关闭且无 `index.html` |
| `404` 但文件存在 | `root` 与 `location` 拼接错位，或 SPA 没配 `try_files` |
| `413` | `client_max_body_size` 太小 |
| 改了配置没生效 | 忘了 `reload`，或改动写在了不生效的文件里 |

`502` 的一个高频细节：后端只监听 `127.0.0.1` 时，`proxy_pass http://127.0.0.1:8000` 可以通；写 `http://localhost:8000` 在某些环境下会先解析到 `::1`（IPv6）导致连不上。**反代地址优先写具体 IP**。

## 小结

- 装完先 `enable --now`，用 `curl -I` 验证；Arch 的 nginx 以 `http` 用户运行。
- 站点配置放 `/etc/nginx/conf.d/*.conf`；改完 `nginx -t` → `reload`，不要直接 `restart`。
- 静态站用 `try_files`；SPA 的最后一项换成 `/index.html`。
- 反代的四个头（`Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`）必须有；上传要调 `client_max_body_size`。
- TLS 交给 certbot，续期靠 `certbot.timer`，用 `--dry-run` 验证。
- 排障三件套：`nginx -t`、`error.log`、`access.log`；`502` 先查后端与地址。

## 练习

1. 静态站（环境：WSL）：在 `/srv/www/lab` 放一个 `index.html`，写 `conf.d/lab.conf`，用 `curl -I` 与浏览器各访问一次；故意把目录权限改成 `700`，观察 `403` 并从 error.log 里找到证据。
2. SPA 路由（环境：WSL）：把 `try_files` 改成 `/index.html`，用 `curl -I http://127.0.0.1/some/route` 验证返回 200 而不是 404。
3. 反向代理（环境：WSL）：用第 40 章的 `demo.service` 或 `python3 -m http.server 8000` 起后端，配反代后用 `curl -H 'Host: app.local' http://127.0.0.1/` 验证；再删掉 `proxy_set_header Host`，对比后端看到的头。
4. 413 复现（环境：WSL）：用 `curl -F file=@大文件` 上传超过 1 MB 的文件触发 `413`，调大 `client_max_body_size` 后重试成功。
5. 502 排查（环境：WSL）：停掉后端，访问页面记录 `502`；从 `error.log` 找出 `connect() failed` 的具体地址，再改回正确端口。
6. 日志分析（环境：WSL）：用 `ab` 或循环 `curl` 产生 50 个请求，从 `access.log` 统计状态码分布与平均耗时（`awk` 一行即可）。

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
