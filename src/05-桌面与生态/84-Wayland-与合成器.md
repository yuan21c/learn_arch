# 第 84 章 Wayland 与合成器

第 81 章对比过 X11 与 Wayland 的架构差异；这一章讲 Wayland 这一侧**具体怎么落地**：协议里谁负责什么、合成器怎么选、XWayland 与 portal 起什么作用、为什么很多「X11 能用的东西」到 Wayland 就失灵。理解了 portal 与协议边界，排障才不会把每个问题都归咎于「Wayland 不成熟」。

> 本章目标：能说出 Wayland 协议中客户端、合成器、`xdg-shell` 与扩展的角色；能按需求在 sway、Hyprland、KWin 等合成器之间做选择；知道会话文件、`dbus-run-session` 与 XWayland 的作用；理解 `xdg-desktop-portal` 及其后端为什么是截屏、文件选择、屏幕共享的前提；会用 `XDG_SESSION_TYPE`、`wayland-info`、portal 的 DBus 状态验证当前环境；能识别「没有 XWayland」「portal 缺失」「NVIDIA 下合成器黑屏」三类问题。
> 对应 Wiki：[Wayland](https://wiki.archlinux.org/title/Wayland)、[Sway](https://wiki.archlinux.org/title/Sway)、[Hyprland](https://wiki.archlinux.org/title/Hyprland)、[XWayland](https://wiki.archlinux.org/title/Xwayland)、[XDG-desktop-portal](https://wiki.archlinux.org/title/XDG-desktop-portal)

## 协议里谁负责什么

Wayland 不是「另一个 X server」，而是一套**客户端与合成器直接通信的协议**：

| 角色 | 职责 | 对应 X11 概念 |
| ---------------- | -------------------------------------------- | ------------------------------ |
| 客户端 | 创建 surface、提交缓冲区、声明输入区域 | X client |
| 合成器 | 同时是显示服务器：收输入、合成所有窗口、输出到 DRM | Xorg + 合成器（picom 等） |
| `xdg-shell` | 定义顶层窗口、弹窗、最大化/全屏等语义 | ICCCM/EWMH 的一部分 |
| `wl_seat` | 键盘、指针、触摸设备 | XInput |
| 扩展协议 | 截屏、输入法、剪贴板、图层 shell 等 | X extensions |

关键差异：**Wayland 没有「全局抓取」**。一个客户端默认拿不到其他窗口的输入、屏幕内容或像素位置，必须通过协议扩展或 portal 获得授权。这既是安全优势，也是「截图工具/录屏/自动化脚本失效」的根源。

## 合成器选型

| 合成器 | 基础 | 配置方式 | 适合 |
| -------------- | -------------- | ------------------------------ | ---------------------------------------- |
| sway | wlroots | 文本配置（i3 兼容） | 想要 i3 式平铺、配置可版本管理 |
| Hyprland | 自研（wlroots 生态） | 文本配置 + 动画/圆角 | 要现代外观与动态平铺，接受较快迭代 |
| KWin（Plasma） | Qt/KDE | 图形设置 + `kwinrc` | 要完整桌面、图形化配置 |
| Mutter（GNOME） | GNOME | 图形设置 + `gsettings` | 要开箱即用、少折腾 |
| labwc / Wayfire | wlroots | 文本配置 | 轻量堆叠式/可定制，介于 WM 与 DE |

三个代表应用的定位：

- **sway**：i3 用户的直接替代，快捷键与布局语言几乎一致；配置在 `~/.config/sway/config`，可用 `sway -C` 校验。
- **Hyprland**：动态平铺 + 动画，配置在 `~/.config/hypr/hyprland.conf`，运行时用 `hyprctl` 查询状态；功能多、变化也快。
- **KWin**：Plasma 的窗口管理器兼合成器，配置主要走系统设置，适合不想手写配置的人。

选型不要只看截图：**平铺 vs 堆叠**决定日常操作习惯，**wlroots vs 桌面项目**决定 portal、截屏、输入法扩展的成熟度，**配置文本 vs 图形**决定可复现性。

## 会话文件与启动方式

Wayland 会话通过 `/usr/share/wayland-sessions/*.desktop` 暴露给显示管理器：

```bash
ls /usr/share/wayland-sessions/
cat /usr/share/wayland-sessions/plasma.desktop
```

本机只有 `plasma.desktop`，其 `Exec=` 是 `startplasma-wayland`——**会话文件只负责「怎么启动」，不负责环境变量与自启**。在 tty 手工启动时，建议套一层 `dbus-run-session`，让 portal、通知、密钥环都拿到同一个会话总线：

```bash
exec dbus-run-session -- sway
# 或
exec dbus-run-session -- startplasma-wayland
```

`XDG_SESSION_TYPE=wayland` 通常由会话文件或登录管理器设置；手工启动时要确认它真的被设置，否则 portal 与部分应用会按 X11 逻辑走。

## XWayland：给 X11 程序留的兼容层

`xorg-xwayland` 提供一个按需启动的 X server，X11 程序连它，合成器把它的窗口当普通 Wayland 窗口合成：

```bash
pacman -Q xorg-xwayland
echo "$DISPLAY" # Wayland 会话里通常仍有 :0 或 :1（XWayland）
```

- 有 `DISPLAY` 不代表在跑 Xorg；在 Wayland 会话里它通常来自 XWayland。
- 没有 XWayland 时，纯 X11 程序会报 `cannot open display`；老工具、部分游戏启动器、Java Swing 应用常踩这个坑。
- XWayland 窗口**受合成器缩放与输入规则约束**，但全局抓取、像素读取仍受限，所以「在 XWayland 里跑截图/自动化」不一定能拿到别的窗口。

## Portal：Wayland 的权限中介

`xdg-desktop-portal` 是一组 DBus 服务，应用通过它请求「截屏、选文件、开 URI、打印、屏幕共享」等能力，由后端实现具体 UI 与授权：

| 组件 | 作用 |
| ---------------------------------------- | -------------------------------------------- |
| `xdg-desktop-portal` | 前端接口与路由 |
| `xdg-desktop-portal-gtk` | GTK 风格的文件选择、通知等 |
| `xdg-desktop-portal-wlr` | wlroots 合成器的截屏/共享后端 |
| `xdg-desktop-portal-kde` | KDE 后端 |
| `xdg-desktop-portal-gnome` | GNOME 后端 |

典型症状：浏览器「共享屏幕」只有黑屏、Flatpak 应用打不开文件、截图工具报「没有 portal」。**先确认 portal 服务在跑、后端与合成器匹配**：

```bash
systemctl --user status xdg-desktop-portal
busctl --user list | grep -i portal
pacman -Q | grep xdg-desktop-portal
```

wlroots 系合成器要装 `xdg-desktop-portal-wlr` 并配好截屏权限；KDE/GNOME 用各自后端。portal 缺失不会让桌面整体不可用，但会让「需要跨应用权限」的功能逐个失效。

## 可复现实验：确认自己在哪个世界

只读命令，无图形会话时也能看出环境：

```bash
echo "$XDG_SESSION_TYPE"
echo "$WAYLAND_DISPLAY"
ls /usr/share/wayland-sessions/ /usr/share/xsessions/ 2>&1
pacman -Q xorg-xwayland xdg-desktop-portal 2>&1
wayland-info 2>&1 | head -12
busctl --user list 2>/dev/null | grep -ci portal
```

本机在纯 SSH 会话里的实际结果：`XDG_SESSION_TYPE` 为空、`wayland-info` 报 `failed to create display: No such file or directory`、`/usr/share/xsessions` 不存在而 `/usr/share/wayland-sessions` 只有 `plasma.desktop`。**这说明「没有正在运行的 Wayland 会话」，不是合成器装错**。

有会话时，`wayland-info` 会列出 `interface:` 条目（`wl_compositor`、`xdg_wm_base`、`wl_seat` 等）；条目数量与名称就是「这个合成器实现了哪些协议」的直接证据，比看文档猜可靠。

配置校验（需要装对应合成器，**未实测**）：

```bash
sway -C -c ~/.config/sway/config # 只校验配置，不启动
hyprctl configerrors # 需要在运行中的 Hyprland 会话
```

## 失败模式

| 现象 | 根因 | 处置 |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------ |
| NVIDIA 机器上合成器黑屏/闪退 | `nvidia_drm.modeset` 未开或驱动不支持 | 内核参数 `nvidia_drm.modeset=1`（第 82 章），确认驱动版本 |
| X11 程序报 `cannot open display` | 没装或没启动 XWayland | 安装 `xorg-xwayland`；确认 `DISPLAY` 存在 |
| 截屏/录屏只有黑屏 | portal 缺失或后端不匹配 | 装 `xdg-desktop-portal-wlr`/`-kde`/`-gnome`，重启 portal |
| 文件选择框打不开 | 应用只认 portal，portal 服务没跑 | `systemctl --user restart xdg-desktop-portal` |
| 全局快捷键失效 | Wayland 不允许全局抓键 | 用合成器自带绑定；工具需专用协议支持 |
| 输入法候选框不跟随 | 合成器 `text-input` 支持不足 | 换合成器或按第 94 章的 Wayland 分支处理 |
| 多屏不同缩放无效 | 用了 X11 的 `xrandr --scale` | Wayland 下在合成器配置里按输出设 scale |
| 手工启动后通知/密钥环异常 | 没套 `dbus-run-session` | 用 `exec dbus-run-session -- <合成器>` |

## 验证与回滚

验证 Wayland 环境看四件事：会话类型、协议接口、portal、XWayland。

```bash
echo "$XDG_SESSION_TYPE $WAYLAND_DISPLAY"
wayland-info 2>/dev/null | grep -c 'interface:'
systemctl --user is-active xdg-desktop-portal
pacman -Q xorg-xwayland
journalctl --user -b --no-pager | grep -iE 'portal|wayland' | tail -20
```

`wayland-info` 的接口数、portal 的 active 状态、`xorg-xwayland` 是否安装，分别对应「合成器在跑」「跨应用权限可用」「X11 兼容可用」。缺一项就定位到对应组件，而不是整体回退到 X11。

回滚：

- **会话层面**：登录界面选 X11 会话；或删掉自启的合成器，回到 `startx`（第 81 章）。
- **portal**：停掉冲突后端，只保留与合成器匹配的一个；`systemctl --user restart xdg-desktop-portal`。
- **XWayland**：X11 兼容问题无法解决时，改用原生支持 Wayland 的应用；不要把「关掉 XWayland」当成安全加固——它只会让老应用直接不可用。
- **配置**：`sway -C`/`hyprctl configerrors` 定位后删改对应行；合成器配置都在用户目录，删除即回默认。

## 取舍边界

- **Wayland vs X11**：新硬件、多屏不同缩放、安全隔离选 Wayland；老应用、远程桌面、依赖全局抓取的工具选 X11。共存并按会话切换是常态。
- **wlroots 系 vs 桌面项目**：sway/Hyprland 轻、可版本化，但截屏、输入法等要自己拼 portal；KWin/Mutter 集成度高，可定制性弱。
- **平铺 vs 堆叠**：平铺适合键盘流与固定工作流；堆叠适合多窗口自由摆放。Hyprland 的动态平铺介于两者之间。
- **XWayland 常开 vs 按需**：常开兼容性最好；极简环境可关掉省资源，但要接受 X11 程序不可用。
- **portal 后端多装 vs 只装一个**：多装可能互相抢接口；按当前合成器只留一个后端最稳。
- **`dbus-run-session` vs 直接启动**：多一层能保证会话总线一致；直接启动更简单，但 portal/通知/密钥环可能找不到会话。

## 小结

- Wayland 是协议，合成器同时充当显示服务器；没有全局抓取，跨应用能力要走扩展或 portal。
- 合成器按「wlroots vs 桌面项目、平铺 vs 堆叠、文本 vs 图形配置」选；sway、Hyprland、KWin 是三个代表。
- 会话文件只定义启动命令；手工启动建议 `dbus-run-session`。
- XWayland 让 X11 程序可用，`DISPLAY` 存在不代表在跑 Xorg。
- portal 是截屏、文件选择、屏幕共享的前提，后端必须与合成器匹配。
- 排障先确认「会话类型 → 协议接口 → portal → XWayland」，再决定是否回退。

## 练习

1. 环境辨认：跑正文六条只读命令，记录 `XDG_SESSION_TYPE`、`WAYLAND_DISPLAY`、会话文件与 portal 状态，判断当前是 tty、X11 还是 Wayland。
2. 协议清单：在有 Wayland 会话时用 `wayland-info` 统计接口数量，找出 `wl_compositor`、`xdg_wm_base`、`wl_seat` 三项并说明各自作用。
3. 合成器对比：读 sway 与 Hyprland 的默认配置样例（不安装也可查 Wiki），列出三条你会实际修改的项，并说明为什么。
4. portal 排障：假设「浏览器共享屏幕黑屏」，写出从 `busctl` 到后端包名的完整检查顺序。
5. XWayland：在 Wayland 会话里跑一个纯 X11 程序，用 `echo $DISPLAY` 与 `ps` 判断它是否走 XWayland。
6. 回滚演练：写出「从 Wayland 会话回 X11、从 sway 回 startx」的两条路径与各自验证点。

## 自检

- [ ] 能说出客户端、合成器、`xdg-shell`、`wl_seat` 的职责
- [ ] 能解释「没有全局抓取」为什么导致截图/自动化工具失效
- [ ] 能在 sway、Hyprland、KWin 之间按需求做选择
- [ ] 知道会话文件只定义启动命令，手工启动要 `dbus-run-session`
- [ ] 能说清 XWayland 与 `DISPLAY` 的关系
- [ ] 知道 portal 及后端的作用，能按症状定位缺失组件
- [ ] 能按四步验证 Wayland 环境并回滚

## 参考

- [Wayland](https://wiki.archlinux.org/title/Wayland)
- [Sway](https://wiki.archlinux.org/title/Sway)
- [Hyprland](https://wiki.archlinux.org/title/Hyprland)
- [XWayland](https://wiki.archlinux.org/title/Xwayland)
- [XDG-desktop-portal](https://wiki.archlinux.org/title/XDG-desktop-portal)
