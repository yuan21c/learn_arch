# 第 83 章 Xorg 配置与输入

第 81 章用 `startx` 跑通了最小 X 会话；这一章讲**什么时候才真的需要写 `xorg.conf`**，以及输入设备、键盘布局、多屏与 DPI 怎么配。核心结论先说：现代 Xorg 的自动配置已经足够好，绝大多数机器一个配置文件都不需要；配置文件是给「自动配置猜错」的场景兜底的。

> 本章目标：能说出 Xorg 配置的读取顺序与 `xorg.conf.d` 的优先级；会写 `Device`/`InputClass` 片段解决驱动与触控板问题；能用 `localectl` 持久化键盘布局、用 `setxkbmap`/`xkbcli` 临时验证；会用 `xrandr` 处理多屏与分辨率；知道 DPI 缩放的正确做法与 X11 的局限；能识别「配置语法错导致 X 起不来」「InputClass 顺序导致设置不生效」「把 Wayland 当 X11 配」三类问题。
> 对应 Wiki：[Xorg](https://wiki.archlinux.org/title/Xorg)、[Keyboard configuration in Xorg](https://wiki.archlinux.org/title/Keyboard_configuration_in_Xorg)、[Libinput](https://wiki.archlinux.org/title/Libinput)、[Multihead](https://wiki.archlinux.org/title/Multihead)

## 配置读取顺序：先默认、后覆盖

Xorg 启动时按以下顺序合并配置：

1. `/usr/share/X11/xorg.conf.d/*.conf`：包自带的默认片段（如 `40-libinput.conf`、`10-amdgpu.conf`）；
2. `/etc/X11/xorg.conf.d/*.conf`：管理员覆盖，**同一目录内按文件名字典序生效**，所以用 `00-`、`20-`、`40-` 这类前缀控制先后；
3. `/etc/X11/xorg.conf`：整份配置，除非必要不要用；
4. 命令行 `-config`/`-configdir` 指定的临时配置（调试用）。

```bash
ls /usr/share/X11/xorg.conf.d/ /etc/X11/xorg.conf.d/
grep -l 'InputClass' /usr/share/X11/xorg.conf.d/*.conf
```

本机实际存在的默认片段是 `10-amdgpu.conf`、`10-quirks.conf`、`10-radeon.conf`、`40-libinput.conf`，外加 `localectl` 生成的 `/etc/X11/xorg.conf.d/00-keyboard.conf`。**先看这些文件再决定要不要加自己的**，很多「触控板不工作」其实是默认片段已经匹配，只是被后面的配置覆盖了。

## Device 片段：让 Xorg 用对驱动

只有在自动选择错误时才需要写 `Device`。最小形式：

```conf
# /etc/X11/xorg.conf.d/20-gpu.conf
Section "Device"
    Identifier "GPU0"
    Driver "modesetting"
    Option "AccelMethod" "glamor"
EndSection
```

- `Driver "modesetting"` 是通用选择；写厂商 DDX（`amdgpu`、`intel`）通常只在老硬件或需要特定选项时才有意义。
- `Identifier` 必须唯一，`Screen` 通过 `Device` 名字引用它。
- 不要复制网上整份 `xorg.conf`：里面常带固定分辨率、固定 EDID、过时的 `Driver`，在新硬件上直接导致启动失败。

多 GPU 或需要指定主输出时，再增加 `Screen`/`ServerLayout` 段；如果只是想让某个程序用独显，优先用 PRIME（第 82 章），不要改全局配置。

## InputClass：触控板、鼠标与键盘

`InputClass` 按匹配条件批量套用选项，比逐设备 `InputDevice` 更稳：

```conf
# /etc/X11/xorg.conf.d/30-touchpad.conf
Section "InputClass"
    Identifier "touchpad"
    MatchIsTouchpad "on"
    Driver "libinput"
    Option "Tapping" "on"
    Option "NaturalScrolling" "true"
    Option "ScrollMethod" "twofinger"
    Option "DisableWhileTyping" "true"
    Option "AccelSpeed" "0.3"
EndSection
```

- 匹配条件：`MatchIsTouchpad`、`MatchIsKeyboard`、`MatchProduct`、`MatchVendor`、`MatchDevicePath`；条件越多越精确。
- **顺序很关键**：`InputClass` 先匹配先生效，后面的同类片段不会覆盖已应用的驱动；要把自己的片段放在默认片段之后（文件名更大）才能覆盖选项。
- 三种输入驱动的边界：`libinput` 是现代默认，X11 与 Wayland 都用它；`synaptics` 是旧驱动，只在需要它的专属选项（如复杂的边缘滚动）时用，**Wayland 下完全不生效**；`wacom` 用于数位板，需要 `xf86-input-wacom` 并按设备单独配置。

临时调参不必改文件（重启即失效）：

```bash
xinput list
xinput list-props "device name"
xinput set-prop "device name" "libinput Tapping Enabled" 1
```

`xinput` 来自 `xorg-xinput`，只在 X11 会话有效；Wayland 下用合成器自带设置或 `libinput` 调试工具。

## 键盘布局：持久化与临时验证

系统级持久化用 `localectl`，它写入 `/etc/X11/xorg.conf.d/00-keyboard.conf`：

```bash
localectl status
sudo localectl set-x11-keymap us,cn pc105
sudo localectl set-keymap us # 同时设置虚拟控制台键盘
```

生成的片段长这样（本机实际内容）：

```conf
Section "InputClass"
    Identifier "system-keyboard"
    MatchIsKeyboard "on"
    Option "XkbLayout" "us"
    Option "XkbModel" "pc105+inet"
    Option "XkbOptions" "terminate:ctrl_alt_bksp"
EndSection
```

会话内临时切换用 `setxkbmap`，不写文件、重启即恢复：

```bash
setxkbmap us,cn -option grp:alt_shift_toggle
setxkbmap -query
```

多布局用逗号分隔，`grp:` 选项定义切换键。**`localectl` 改的是系统默认，`setxkbmap` 改的是当前会话**；两者冲突时以最后生效的为准，排障先 `setxkbmap -query` 看实际值。

没有图形会话也能校验布局是否合法（本机实测通过）：

```bash
xkbcli compile-keymap --layout us,cn > /tmp/keymap.xkb
head -3 /tmp/keymap.xkb # 输出 xkb_keymap { ... } 即合法
```

返回码为 0 且生成 `xkb_keymap` 结构，说明 XKB 数据存在、写法正确；返回非 0 通常是布局名拼错。

## 多屏、分辨率与 DPI

`xrandr` 是 X11 的多屏工具（来自 `xorg-xrandr`）：

```bash
xrandr --query
xrandr --output HDMI-1 --auto --right-of eDP-1
xrandr --output eDP-1 --mode 1920x1080 --rate 60
```

- `--right-of`/`--left-of`/`--above`/`--below` 定义相对位置；`--primary` 指定主屏。
- 报 `configure crtc ... failed` 多半是模式不被显示器 EDID 支持，先 `xrandr --query` 看可用模式，别硬套网上的分辨率。
- 这些设置**重启即失效**；要持久化，X11 下写进 `~/.xinitrc`/`~/.xprofile` 或桌面环境的显示设置，Wayland 下必须用合成器自己的配置（`xrandr` 不适用）。

DPI 与缩放：

```bash
xrdb -query | grep -i dpi
echo 'Xft.dpi: 144' >> ~/.Xresources && xrdb -merge ~/.Xresources
```

`Xft.dpi` 只影响使用 Xft 的工具包（GTK/Qt 各自还有自己的缩放设置）。X11 对**每屏不同缩放**支持很差，混合 DPI 多屏要么统一缩放、要么接受模糊；这是 Wayland 的主要优势之一（第 84 章）。

## 可复现实验：无 GUI 也能验证一半

以下命令只读或只写 `/tmp`，可在纯 tty 完成：

```bash
ls /etc/X11/xorg.conf.d/ /usr/share/X11/xorg.conf.d/
cat /etc/X11/xorg.conf.d/00-keyboard.conf
localectl status
setxkbmap -query 2>/dev/null || echo "无 X 会话"
xkbcli compile-keymap --layout us,cn >/tmp/keymap.xkb && head -3 /tmp/keymap.xkb
```

有 X 会话时再加：

```bash
xrandr --query
xinput list
xinput list-props "AT Translated Set 2 keyboard" 2>/dev/null | head -10
grep -E '\(EE\)|\(WW\)' /var/log/Xorg.0.log | tail -20
```

**预期**：没有 `DISPLAY` 时 `setxkbmap`/`xrandr`/`xinput` 会报 `unable to open display`，这是环境问题不是配置问题；`xkbcli compile-keymap` 与 `ls`/`cat` 则不依赖图形会话。

临时配置验证（会启动第二个 X server，**未实测**，建议在 tty 手动做）：

```bash
Xorg :2 -config /tmp/test.conf -configdir /tmp/xorg.d -logfile /tmp/xorg-test.log
grep -E '\(EE\)|Fatal' /tmp/xorg-test.log
```

在 `:2` 上起一个独立 server 不影响当前会话；日志里出现 `(EE)` 就说明片段有语法错或驱动加载失败。验证完 `Ctrl+Alt+Backspace` 或结束进程即可。

## 失败模式

| 现象 | 根因 | 处置 |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------ |
| X 完全起不来，报 `Parse error` | 配置文件语法错（缺 `EndSection`、引号不配对） | 读 `Xorg.0.log` 的行号，改回备份；用 `-config` 在 `:2` 验证 |
| `Failed to load module "xxx"` | 写了未安装的 `Driver` | 改回 `modesetting`，或安装对应 `xf86-video-*` |
| 触控板设置不生效 | `InputClass` 文件名排序在默认片段之前 | 改用更大前缀（如 `30-`）或提高匹配精度 |
| 键盘布局改了但登录界面仍是旧布局 | 只 `setxkbmap`，没写系统配置 | `localectl set-x11-keymap` 持久化；DM 读系统配置 |
| 多屏位置重启后丢失 | `xrandr` 是临时命令 | 写进会话启动脚本或桌面显示设置 |
| 外接屏分辨率列表里没有目标模式 | EDID 不支持 / 线材带宽不足 | 换线、降刷新率；不要强加自定义 mode |
| UI 异常小或异常大 | `Xft.dpi` 与工具包缩放不一致 | 统一 `Xft.dpi` 与 GTK/Qt 缩放，或改用 Wayland |
| 在 Wayland 会话里改 `xorg.conf.d` 无效 | Wayland 不读 Xorg 输入配置 | 改用合成器配置；`xorg.conf.d` 只影响 X11/XWayland 的输入路径 |

## 验证与回滚

配置改动的验证顺序：**语法 → 加载 → 生效**。

```bash
grep -E '\(EE\)|\(WW\)' /var/log/Xorg.0.log
xrandr --query | head -8
xinput list
setxkbmap -query
```

日志里没有 `(EE)` 只说明加载成功；还要用 `xinput list-props` 确认选项真的应用到了目标设备，用 `xrandr --query` 确认输出与模式正确。

回滚：

```bash
cp -a /etc/X11/xorg.conf.d /tmp/xorg.conf.d.bak # 改前备份
sudo rm /etc/X11/xorg.conf.d/30-touchpad.conf # 删除新片段
sudo systemctl restart <显示管理器> # 或重新 startx
```

若 X 已起不来，先 `Ctrl+Alt+F3` 切 tty，删掉最近改的文件再启动；整份配置出问题时，临时把 `/etc/X11/xorg.conf` 改名即可回到自动配置。**每次只改一个片段、只验证一个目标**，否则回滚时无法判断哪一项起了作用。

## 取舍边界

- **零配置 vs 写片段**：自动配置正确时不要写；只有「驱动选错、设备选项需要覆盖、多屏要固定布局」才写，片段越少越好。
- **`modesetting` vs 厂商 DDX**：`modesetting` 通用、维护成本低；厂商 DDX 只在老硬件或需要专属选项时用，且常与 Wayland 无关。
- **`libinput` vs `synaptics`**：新设备一律 `libinput`；`synaptics` 只在需要其独有选项且确定不用 Wayland 时考虑。
- **`localectl` vs `setxkbmap`**：要跨会话、跨登录界面生效用 `localectl`；只是当前会话临时切换用 `setxkbmap`。
- **X11 多屏脚本 vs 桌面设置**：脚本可复现、适合极简 WM；桌面环境自带设置更直观，但可移植性差。
- **X11 vs Wayland 缩放**：混合 DPI 多屏优先 Wayland；必须用 X11 时接受统一缩放或模糊，别指望 `xrandr --scale` 做到像素级清晰。

## 小结

- 配置顺序：`/usr/share` 默认 → `/etc` 覆盖（按文件名字典序）→ `xorg.conf` → 命令行临时配置。
- 大多数机器不需要配置文件；只在自动配置猜错时用最小片段修正。
- `InputClass` 先匹配先生效，文件名前缀决定覆盖顺序；`libinput` 是现代默认。
- 键盘布局用 `localectl` 持久化，`setxkbmap` 只影响当前会话，`xkbcli compile-keymap` 可离线校验。
- `xrandr` 是 X11 的临时多屏工具，持久化要靠会话脚本或桌面设置；Wayland 不适用。
- `Xft.dpi` 只影响部分工具包，混合 DPI 多屏是 X11 的固有短板。

## 练习

1. 读取顺序：列出两个 `xorg.conf.d` 目录的内容，指出哪些是包默认、哪些是 `localectl` 生成，并说明同名选项谁覆盖谁。
2. 触控板片段：写一个 `30-touchpad.conf` 开启点按与双指滚动（不实际启用前先备份），说明为什么文件名要大于 `40-libinput.conf` 的反例。
3. 布局校验：用 `xkbcli compile-keymap --layout us,cn` 生成 keymap，再故意把布局名写错，观察返回码变化。
4. 临时 vs 持久：`setxkbmap us,cn` 后 `setxkbmap -query` 看结果，重启会话验证已恢复；再用 `localectl` 改系统布局并说明差异。
5. 多屏（需要 GUI）：`xrandr --query` 记录输出名，把外接屏设为 `--right-of`，再断开外接屏，说明为什么重启后设置消失。
6. 日志排障：在 `:2` 上启动临时配置（未实测路径），从 `/tmp/xorg-test.log` 找出至少一条 `(EE)` 并解释其含义。

## 自检

- [ ] 能说出 `xorg.conf.d` 的读取顺序与文件名前缀的作用
- [ ] 知道什么时候才需要写 `Device`/`InputClass` 片段
- [ ] 能写出触控板的 `libinput` 选项并解释匹配顺序
- [ ] 能区分 `localectl` 与 `setxkbmap` 的作用范围
- [ ] 会用 `xkbcli compile-keymap` 在无 GUI 环境校验布局
- [ ] 知道 `xrandr` 只在 X11 生效、且设置不持久
- [ ] 能按「语法 → 加载 → 生效」三步验证并回滚配置

## 参考

- [Xorg](https://wiki.archlinux.org/title/Xorg)
- [Keyboard configuration in Xorg](https://wiki.archlinux.org/title/Keyboard_configuration_in_Xorg)
- [Libinput](https://wiki.archlinux.org/title/Libinput)
- [Multihead](https://wiki.archlinux.org/title/Multihead)
