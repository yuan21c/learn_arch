# 第 89 章 专业音频与 MIDI

第 88 章把声音「放出来」；这一章讲**录音、低延迟、路由与 MIDI**。消费级播放关心「能不能听到」，专业音频关心「延迟多小、时钟同不同步、信号怎么走」。两者用的硬件可能一样，但对内核调度、采样率与缓冲的要求完全不同。

> 本章目标：能说出专业音频关注的四个指标（延迟、采样率、时钟、路由）；理解 PipeWire 与 JACK 的关系以及 `pipewire-jack` 的作用；会用 `pw-metadata`/`pw-cli` 调整采样率与缓冲区并验证；知道实时调度权限（RTKit/`limits.conf`）为什么影响 xrun；能区分 ALSA 音序器、PipeWire MIDI 桥与软件合成器的分工；会识别「xrun 频繁」「采样率不匹配」「USB 设备时钟漂移」三类问题。
> 对应 Wiki：[Professional audio](https://wiki.archlinux.org/title/Professional_audio)、[PipeWire](https://wiki.archlinux.org/title/PipeWire)、[JACK](https://wiki.archlinux.org/title/JACK)、[MIDI](https://wiki.archlinux.org/title/MIDI)

## 专业音频看什么

| 指标 | 含义 | 常见取值 | 出问题的表现 |
| -------------- | ------------------------------------ | ------------------------------ | ------------------------------ |
| 延迟 | 从输入到输出经过的时间 | 现场 5–20 ms，制作可更高 | 监听滞后、演奏手感差 |
| 采样率 | 每秒采样数，项目内必须统一 | 44.1 kHz（CD）、48 kHz（视频） | 重采样失真、设备拒绝打开 |
| 时钟 | 所有数字设备共享的时间基准 | 声卡内部时钟或外部字时钟 | 长时间运行后漂移、爆音 |
| 路由 | 信号从哪个端口到哪个端口 | 软件矩阵或物理跳线 | 声音走错设备、反馈回路 |

消费级播放可以容忍几百毫秒延迟与自动重采样；专业工作流要求**项目采样率固定、缓冲区尽量小、所有设备同钟**。这就是为什么「能听歌的配置」直接拿来录音会频繁 xrun。

## PipeWire 与 JACK：不是二选一

现代 Arch 桌面默认 PipeWire，它同时实现了 PulseAudio 兼容接口与 JACK 兼容接口：

| 组件 | 作用 |
| -------------------- | -------------------------------------------- |
| `pipewire` | 服务本体，图式音频引擎 |
| `pipewire-pulse` | PulseAudio 兼容（普通桌面应用） |
| `pipewire-jack` | JACK 兼容库，让 JACK 应用直接连 PipeWire |
| `wireplumber` | 会话/策略管理，决定设备与路由 |

```bash
sudo pacman -S pipewire-jack
pw-jack <JACK 应用> # 用 JACK 兼容库启动应用
```

- `pw-jack` 只改该进程的库搜索路径，让应用连到 PipeWire 的 JACK 接口；**不需要同时跑 JACK2 服务**。
- 需要 JACK2 的专属特性（特定后端、网络音频）时才单独装 `jack2`，且不要和 PipeWire 的 JACK 接口同时抢设备。
- 采样率与缓冲区通过 PipeWire 元数据设置，而不是 JACK 的启动参数：

```bash
pw-metadata -n settings
pw-metadata -n settings 0 clock.force-rate 48000
pw-metadata -n settings 0 clock.force-quantum 256
```

`clock.force-rate` 固定项目采样率；`clock.force-quantum` 调整缓冲区帧数，数值越小延迟越低、越容易 xrun。改完用 `pw-metadata -n settings` 复核，别只看命令返回。

## 实时调度：xrun 的根源之一

音频线程需要**实时优先级**才能在不丢帧的情况下及时处理缓冲。普通用户默认没有这个权限：

```bash
ulimit -r # 实时优先级上限；0 表示没有
ulimit -l # 可锁内存（KB）
```

本机 SSH 会话的实际结果是 `ulimit -r` 为 0、`ulimit -l` 为 8192——**在这种会话里跑专业音频，xrun 几乎是必然的**。两条正规路径：

- **RTKit**：PipeWire 通过 `org.freedesktop.rtkit` 申请实时优先级，桌面会话里通常已由 RTKit 授予；`journalctl --user -u pipewire` 里能看到相关日志。
- **`limits.conf`**：给 `@audio` 组授予 `rtprio` 与 `memlock`，用户加入该组后重新登录生效：

```text
# /etc/security/limits.d/audio.conf
@audio   -  rtprio     95
@audio   -  memlock    unlimited
```

不要用 `sudo` 跑 DAW 来「解决」权限问题——那会让工程文件、插件与配置都落到 root 名下，后患更大。

## MIDI：音序器、桥与合成器

MIDI 只传控制消息，不传音频；链路上有三种角色：

| 角色 | 例子 | 作用 |
| ---------------- | ------------------------------ | ------------------------------------------ |
| 音序器/DAW | Ardour | 录制、编辑、把 MIDI 与音频对齐 |
| 插件宿主/路由 | Carla | 加载 LV2/VST3 插件，连接任意端口 |
| 软件合成器 | FluidSynth | 把 MIDI 消息变成声音 |

```bash
cat /proc/asound/cards
ls /dev/snd/ | head
aconnect -l 2>/dev/null || echo "未安装 alsa-utils 的 aconnect"
```

本机 `/dev/snd` 里有 `midiC0D0`，说明声卡暴露了 MIDI 设备；`/proc/asound/cards` 显示 `ENS1371 - Ensoniq AudioPCI`。**硬件有 MIDI 端口不代表软件路由已连好**：ALSA 音序器用 `aconnect` 连接端口，PipeWire 则通过 MIDI 桥把 ALSA 端口暴露给 JACK 应用；两条路径不要混着配。

## 可复现实验：延迟与路由的证据

```bash
pw-cli info 0 2>&1 | head -8
pw-metadata -n settings 2>&1 | head -12
pw-top 2>/dev/null | head -10
ulimit -r; ulimit -l
cat /proc/asound/cards
ls /dev/snd/
```

- 无图形/无 PipeWire 会话时，`pw-cli`/`pw-metadata` 会报 `failed to connect: Host is down`（本书验证环境实测）；这表示**没有运行中的音频会话**，不是声卡坏了。
- `pw-top` 能看到每个节点的 `QUANT`/`RATE` 与 xrun 计数；xrun 列持续增长，就要降采样率、加缓冲或修实时权限。
- `ulimit -r` 为 0 时，先解决权限再谈调参；否则调小缓冲只会让 xrun 更多。

## 失败模式

| 现象 | 根因 | 处置 |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------ |
| 周期性爆音、`pw-top` xrun 增长 | 缓冲太小或没有实时优先级 | 增大 `clock.force-quantum`，检查 RTKit/`limits.conf` |
| 应用打不开声卡 | 采样率与设备当前配置冲突 | `clock.force-rate` 统一为项目采样率，关闭占用设备 |
| 长时间录音后逐渐失步 | 多设备未共享时钟 | 用同一接口录放，或配置字时钟/ADAT 同步 |
| JACK 应用连不上 | 没走 `pw-jack`，或 JACK2 与 PipeWire 抢设备 | 用 `pw-jack` 启动；只保留一套 JACK 实现 |
| MIDI 设备无响应 | ALSA 音序器端口未连接 | `aconnect` 连接端口；或让 PipeWire MIDI 桥接管 |
| 录音电平极低/噪声大 | 输入增益、幻象电源、接口选择错 | 查 `alsamixer`/接口面板，确认输入源与增益 |
| 插件扫描后 DAW 崩溃 | 插件格式/架构不兼容 | 用 Carla 单独扫描，隔离问题插件 |
| 用 root 跑 DAW 后文件权限混乱 | 不该用 root 跑图形音频应用 | 回普通用户，修工程目录属主 |

## 验证与回滚

```bash
pw-metadata -n settings | grep -E 'clock.force-rate|clock.force-quantum'
pw-top -b -n 1 2>/dev/null | head -12
ulimit -r
systemctl --user status pipewire wireplumber --no-pager | head -12
journalctl --user -u pipewire -b --no-pager | grep -iE 'xrun|error' | tail -10
```

「元数据值、xrun 计数、实时权限、服务日志」四项能定位绝大多数音频质量问题。验证时用一段已知采样率的素材循环播放/录制，观察 xrun 是否随时间增长。

回滚：

```bash
pw-metadata -n settings 0 clock.force-rate 0 # 取消强制，回到自动
rm /etc/security/limits.d/audio.conf # 撤销权限调整（确认后）
systemctl --user restart pipewire wireplumber
```

改 `limits.conf` 前备份；`clock.force-rate 0` 表示「不强制」，不是「设为 0 Hz」。回滚后重新登录，让组权限与实时限制生效。

## 取舍边界

- **PipeWire vs JACK2**：桌面兼专业用途选 PipeWire（一套服务兼顾播放与低延迟）；纯录音棚、需要 JACK 专属后端时用 JACK2，但别与 PipeWire 并行抢设备。
- **低延迟 vs 稳定**：缓冲越小延迟越低、xrun 风险越高；现场监听优先低延迟，长时间渲染优先稳定。
- **44.1 kHz vs 48 kHz**：音乐项目常用 44.1，视频/直播常用 48；**项目内统一**比选哪个更重要，跨率转换会引入失真与延迟。
- **硬件监听 vs 软件监听**：硬件直接监听零延迟但不可加效果；软件监听灵活但受缓冲影响。
- **插件格式**：LV2 跨平台、开源生态好；VST3 商业插件多；CLAP 较新。按插件可用性选，不要为格式而格式。
- **板载声卡 vs 专用接口**：板载能验证链路但不适合专业录制；专用接口带来更好的时钟与输入，也带来驱动与固件复杂度。

## 小结

- 专业音频四指标：延迟、采样率、时钟、路由；项目内采样率必须统一。
- PipeWire 通过 `pipewire-jack` 兼容 JACK 应用，`pw-jack` 启动即可，不必同时跑 JACK2。
- `clock.force-rate`/`clock.force-quantum` 控制采样率与缓冲；越小延迟越低、越易 xrun。
- 实时优先级来自 RTKit 或 `limits.conf` 的 `@audio`；`ulimit -r` 为 0 时先修权限。
- MIDI 有音序器、插件宿主、软件合成器三种角色；ALSA 音序器与 PipeWire MIDI 桥别混配。
- 排障顺序：元数据 → xrun → 实时权限 → 服务日志。

## 练习

1. 权限检查：跑 `ulimit -r` 与 `ulimit -l`，判断当前会话能否跑低延迟音频，并写出两条修正路径。
2. 元数据实验：在有 PipeWire 会话时把 `clock.force-rate` 设为 48000，`pw-metadata` 复核，再设回 0，观察应用行为。
3. 缓冲对比：把 `clock.force-quantum` 从 1024 调到 256，用 `pw-top` 观察 xrun 与延迟变化，说明取舍。
4. 设备清单：`cat /proc/asound/cards` 与 `ls /dev/snd/`，指出哪些是播放、录制、MIDI 设备。
5. MIDI 链路：用 `aconnect -l`（或 PipeWire 的 MIDI 桥）把一个输入端口连到 FluidSynth，说明消息流向。
6. 故障分析：给定「录音 30 分钟后逐渐失步」，列出时钟、采样率、缓冲三个排查方向及各一条命令。

## 自检

- [ ] 能说出专业音频的四个关键指标
- [ ] 能解释 PipeWire 与 JACK 的关系及 `pw-jack` 的作用
- [ ] 会用 `pw-metadata` 设置采样率与缓冲并复核
- [ ] 知道实时权限从哪来、`ulimit -r` 为 0 意味着什么
- [ ] 能区分音序器、插件宿主、软件合成器
- [ ] 能按「元数据 → xrun → 权限 → 日志」排障
- [ ] 知道采样率统一与时钟同步为什么重要

## 参考

- [Professional audio](https://wiki.archlinux.org/title/Professional_audio)
- [PipeWire](https://wiki.archlinux.org/title/PipeWire)
- [JACK](https://wiki.archlinux.org/title/JACK)
- [MIDI](https://wiki.archlinux.org/title/MIDI)
