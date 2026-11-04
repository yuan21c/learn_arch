# 第 70 章 Web 可观测性与部署

服务能启动不等于能运营。上线之后要回答三个问题：**它现在健康吗、用户慢在哪、出问题怎么退回**。这一章把第 63–68 章的服务接上「可观测性」与「可回滚的部署」：健康检查怎么设计、指标与日志从哪来、灰度与回滚怎么做，以及哪些监控工具适合单机。

> 本章目标：能区分 liveness/readiness/startup 三种健康检查并各写一个端点；能从 nginx 访问日志算出请求耗时分布；能说出指标、日志、追踪三者的用途与成本；会用「版本目录 + current 符号链接」做单机部署与回滚；知道 Netdata、Monit、Munin、Monitorix、Ganglia、lm_sensors 的定位；能识别「健康检查查依赖」「没有回滚路径」两类部署反模式。
> 对应 Wiki：[Netdata](https://wiki.archlinux.org/title/Netdata)、[Monit](https://wiki.archlinux.org/title/Monit)、[Munin](https://wiki.archlinux.org/title/Munin)、[Monitorix](https://wiki.archlinux.org/title/Monitorix)、[Nginx](https://wiki.archlinux.org/title/Nginx)

## 可观测性的三根支柱

| 支柱 | 回答的问题 | 数据形态 | 成本 |
| -------- | ------------------------------ | ------------------------ | -------------------------- |
| 指标 | 整体趋势如何、是否越线 | 数值 + 标签 + 时间戳 | 低（聚合后存储） |
| 日志 | 这一次请求/错误发生了什么 | 结构化或半结构化文本 | 中（量大、需轮转） |
| 追踪 | 一次请求慢在哪个环节 | span + trace id | 高（采样与存储） |

排障顺序通常是「指标发现异常 → 日志定位事件 → 追踪拆解链路」。单机小服务先把前两项做好，追踪等有跨服务调用再上；一上来就搭全套 APM，往往是监控系统比业务还复杂。

## 健康检查：活着的三种含义

- **liveness（活着）**：进程是否还能工作。失败的处理是**重启**，所以它只能检查进程自身，不能检查数据库、缓存、外部 API——否则对方抖一下，你的服务被连环重启。
- **readiness（可接流量）**：依赖是否就绪、是否完成预热。失败的处理是**摘掉流量**，不重启。
- **startup（启动完成）**：给慢启动应用一个宽限期，成功前不执行 liveness 检查。

一个最小实现（nginx 静态返回，用于验证链路）：

```nginx
location = /healthz {
    access_log off;
    default_type text/plain;
    return 200 "ok\n";
}
```

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1/healthz
```

应用自身实现时，`/healthz` 只做「进程内检查」（如能否分配内存、配置是否加载），`/readyz` 才查数据库连接与依赖。返回码要明确：200 健康、503 未就绪；不要用 200 加一段 `"degraded"` 文本让调用方猜。

## 部署方式：从原地替换到灰度

| 方式 | 做法 | 回滚速度 | 适用 |
| ------------ | -------------------------------------- | -------------- | ------------------------------ |
| 原地替换 | 停旧进程，启新进程 | 慢（停机窗口） | 个人项目、可接受短暂停机 |
| 版本目录 + 链接 | 新版本解压到独立目录，切换 `current` | 秒级（切回链接） | 单机、无状态或可快速重启 |
| 蓝绿 | 两套环境并存，入口切流量 | 秒级（切回入口） | 有双份资源、要求零停机 |
| 滚动 | 多实例逐个替换 | 中（受实例数影响） | 多实例、容器编排（第 73 章） |
| 金丝雀 | 小比例流量先走新版本 | 秒级（调权重） | 有指标能判断新旧优劣 |

单机最实用的是「版本目录 + 符号链接」：

```bash
sudo install -d -o demo -g demo /srv/app/releases
sudo install -d -o demo -g demo /srv/app/releases/2026-11-04-1
# 把新版本放进 releases/2026-11-04-1，服务 ExecStart 指向 /srv/app/current
sudo ln -sfn /srv/app/releases/2026-11-04-1 /srv/app/current
sudo systemctl restart demo
```

回滚就是把链接切回上一个版本再重启。前提是**每个版本目录自包含**（依赖、配置模板、启动脚本都在里面），且数据库迁移对新旧代码都兼容；否则切回链接也救不了已经改坏的表结构。

## 指标与日志从哪来

**请求耗时**不需要 APM，nginx 访问日志就够。默认 combined 格式没有耗时，加一个 `log_format`：

```nginx
log_format timed '$remote_addr $status $request_time $upstream_response_time';
access_log /var/log/nginx/timed.log timed;
```

```bash
for i in $(seq 1 50); do curl -s -o /dev/null http://127.0.0.1/; done
awk '{print $3}' /var/log/nginx/timed.log | sort -n | awk '{a[NR]=$1} END{print "p95=" a[int(NR*0.95)]}'
```

`$request_time` 是从收到首字节到发送完响应，`$upstream_response_time` 是后端耗时；两者相减就是 nginx 自身的开销。先看分布再看均值——均值会被少量慢请求掩盖。

**单机监控工具**各有分工：

| 工具 | 定位 | 适合 |
| ------------ | ------------------------------------------ | -------------------------------- |
| Netdata | 秒级实时指标、自带面板与告警 | 单机排障、想立刻看到曲线 |
| Monit | 进程/文件/资源检查，可自动重启 | 「服务挂了帮我拉起来」 |
| Munin | RRD 长期趋势、插件生态 | 按小时/天看历史趋势 |
| Monitorix | 系统与网络图表 | 轻量单机总览 |
| Ganglia | 多机集群指标 | 一组机器的横向对比 |
| lm_sensors | 温度、电压、风扇 | 硬件健康与过热排查 |
| Conky | 桌面叠加显示 | 个人工作机，不是服务器监控 |

磁盘温度类工具要注意：`hddtemp` 只对部分 SATA 盘有效，NVMe 的温控与寿命应看 `smartctl`（`smartctl -a /dev/nvme0`）。所有监控代理都只监听到回环或内网，不要把面板端口直接暴露公网（第 76 章）。

## 失败模式

- **liveness 检查数据库**：数据库短暂不可用 → 所有应用实例被重启 → 雪崩。liveness 只查自身，依赖检查放 readiness。
- **健康检查只看端口**：端口在听但返回 500，仍被判健康。要校验状态码与关键依赖。
- **没有 `$request_time`**：只知道「慢」，不知道慢在 nginx 还是后端；先补日志字段，再谈优化。
- **日志只进内存**：journald 默认可能不持久化，重启即丢；需要保留就配置持久化（第 79 章）。
- **日志打满磁盘**：没有 logrotate 或保留策略，服务因磁盘满而崩。
- **部署没有回滚路径**：只保留最新版本，出事只能现场改代码；每次部署都要留下上一版。
- **数据库迁移不可逆**：新代码删了旧代码还在用的列，回滚链接也起不来；迁移要分「扩展 → 双写 → 收缩」三步。
- **灰度没有指标**：凭感觉放量，出了问题也不知道是哪一版；金丝雀必须配对比指标。
- **告警阈值拍脑袋**：没有基线就设阈值，不是漏报就是天天响；先用一周数据定基线。
- **监控面板暴露公网**：Netdata/Munin 的端口不该对全网开放；绑回环或用反代加认证。

## 验证与回滚

上线前的验证清单，四条命令就能覆盖大半：

```bash
curl -fsS -o /dev/null -w 'health=%{http_code}\n' http://127.0.0.1/healthz
systemctl is-active demo
journalctl -u demo -b -p err --no-pager | tail -10
awk '{print $3}' /var/log/nginx/timed.log | sort -n | tail -1
```

再看部署与回滚是否真的可用：

```bash
readlink -f /srv/app/current          # 当前指向哪个版本
sudo ln -sfn /srv/app/releases/2026-11-03-1 /srv/app/current
sudo systemctl restart demo
curl -fsS http://127.0.0.1/healthz    # 回滚后仍健康
```

回滚后要做三件事：确认旧版本能读到当前数据库结构、确认日志里没有新的报错、确认监控指标回到基线。**回滚不是「切回去就完了」，而是一次完整的重新验证**。

灰度回滚则是把权重调回 0 或摘掉新实例；容器编排里对应 `kubectl rollout undo`（第 73 章）。无论哪种方式，都要保证「上一版仍可运行」——这要求部署时保留旧产物与旧配置。

## 取舍边界

- **指标 vs 日志 vs 追踪**：指标便宜、适合告警；日志贵、适合定位；追踪最贵、适合跨服务。单机先做指标 + 日志，别为「以后可能微服务化」预埋全套追踪。
- **拉取 vs 推送**：Prometheus 式拉取便于发现「目标消失」；推送适合短生命周期任务与受限网络。选一种，不要两套并存。
- **自建 vs SaaS**：自建买控制权与长期成本，SaaS 买免运维与快速上手；数据合规要求高时自建更稳。
- **采集精度 vs 成本**：秒级采集看瞬时抖动，分钟级采集省存储；保留期按「排障需要多久」定，不按「永远留着」定。
- **健康检查深度**：查得越深越能发现依赖问题，但也越容易把依赖故障放大成自身故障；liveness 浅、readiness 深是通用解。
- **蓝绿 vs 金丝雀**：蓝绿要双份资源、切换干脆；金丝雀省资源但要指标与放量策略。资源有限的单机，版本目录 + 链接最务实。
- **告警 vs 面板**：面板用于人看，告警用于叫醒人；两者阈值不同，别把面板上的每条曲线都变成告警。

## 小结

- 可观测性先做指标与日志，追踪等到有跨服务调用再上。
- liveness 只查自身、readiness 查依赖、startup 给慢启动宽限；健康端点要返回明确状态码。
- 单机部署用「版本目录 + current 链接」，回滚是切回上一版并重新验证。
- nginx 的 `$request_time` 是最便宜的耗时指标；先看 p95，不只看均值。
- 监控工具按定位选：Netdata 实时、Monit 自愈、Munin 长期、Ganglia 集群、lm_sensors 硬件。
- 没有回滚路径与不可逆迁移，是部署事故的两个最大放大器。

## 练习

1. 健康端点：在 nginx 配 `/healthz` 返回 200，再配 `/readyz` 模拟 503（如 `return 503`），用 `curl -w` 验证状态码。
2. 耗时分布：加 `log_format timed`，发 50 个请求，用 `awk` 算 p50 与 p95；再人为加 `proxy_read_timeout` 或 sleep 后端，观察长尾变化。
3. 版本部署：建两个 releases 目录，用 `ln -sfn` 切换 `current`，每次切换后 `curl` 验证；模拟新版本启动失败，切回旧版并记录恢复时间。
4. 监控工具：装 Netdata 或 Monit（任选其一），观察一个指标/进程；说明它和「日志排障」各自能回答什么问题。
5. 反模式分析：列出「liveness 查数据库」在数据库抖动 30 秒时的连锁反应，写出改成 readiness 后的行为差异。
6. 迁移兼容：为一个「给用户表加非空列」的变更设计「扩展 → 双写 → 收缩」三步，并说明每一步如何回滚。

## 自检

- [ ] 能区分 liveness/readiness/startup 并说明各自失败后的动作
- [ ] 能写出一个返回明确状态码的健康端点
- [ ] 能从 nginx 日志算出 p95 并解释它与均值的差别
- [ ] 能说出指标、日志、追踪的用途与成本差异
- [ ] 会用版本目录 + 符号链接完成部署与回滚
- [ ] 能列出至少三种监控工具的定位，并知道面板不能暴露公网
- [ ] 能解释为什么数据库迁移必须对新旧代码兼容

## 参考

- [Netdata](https://wiki.archlinux.org/title/Netdata)
- [Monit](https://wiki.archlinux.org/title/Monit)
- [Munin](https://wiki.archlinux.org/title/Munin)
- [Monitorix](https://wiki.archlinux.org/title/Monitorix)
- [Nginx](https://wiki.archlinux.org/title/Nginx)
- [Systemd](https://wiki.archlinux.org/title/Systemd)
