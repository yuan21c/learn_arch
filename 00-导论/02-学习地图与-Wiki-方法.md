# 02 学习地图与 Wiki 方法

Arch 的知识面很宽，但没有必要一次学完。本章给出全书地图，并说明如何用 Wiki、`man` 和本地文件把一个具体问题查清楚。方法比记住某条命令更重要。

> 本章目标：知道八个部分各自解决什么问题，掌握任务驱动的学习节奏和 Wiki 阅读方法。
> 对应 Wiki：[Main page](https://wiki.archlinux.org/title/Main_page)

## 全书地图

| 部分 | 主题 | 目标 | 主要产出 |
| --- | --- | --- | --- |
| 00 导论 | Arch 是什么、学习地图、WSL 边界 | 建立正确预期 | 能说清能学什么、不能学什么 |
| 01 环境准备 | 首次启动、systemd、用户、镜像源、备份 | 得到可用实验环境 | systemd 正常、普通用户可用、有备份 |
| 02 包管理 | pacman、查询、缓存、降级、密钥环 | 掌握核心工具 | 能独立安装、查询、回滚、修密钥 |
| 03 系统管理 | systemd、日志、service、timer、权限 | 能管理系统与服务 | 能写 unit、定位 failed unit |
| 04 构建与 AUR | makepkg、PKGBUILD、AUR | 能自己构建和安装包 | 能读能写 PKGBUILD，能手动装 AUR 包 |
| 05 维护与排障 | 升级流程、故障处理、WSL 特有问题 | 能长期维护系统 | 有升级流程和故障复盘 |
| 06 虚拟机安装 | 分区、pacstrap、chroot、引导器 | 补齐 WSL 缺失的安装能力 | 能在虚拟机独立装完 Arch |
| 07 附录 | 命令速查、Wiki 索引、术语、里程碑 | 随时查阅 | 快速定位命令与页面 |

顺序建议：00 → 01 → 02 → 03/04 → 05 → 06。02 是重点，不要跳过。

## 学习法

四条原则，配合可执行动作：

| 原则 | 具体做法 |
| --- | --- |
| 任务驱动 | 每学一个概念，立刻找一个能验证它的命令 |
| 一次一个主题 | 不同时折腾 AUR、桌面和内核 |
| 先备份 | 大改前导出 WSL 镜像 |
| 记录命令与输出 | 留下可复现的记录，而不是只记结论 |

“记录”不是抄笔记，而是保留现场。一份可用的记录至少包含：你执行了什么、系统返回了什么、你据此得出什么结论。

```bash
# 把一次操作完整留下来，排障时比回忆可靠
script -q -c "sudo pacman -Syu" pacman-update.log
```

## Wiki 阅读法

Wiki 是任务索引，不是教材。读一个页面时按固定顺序：

1. 看顶部说明与警告框，确认适用范围和风险。
2. 看 `Installation`、`Configuration` 等主体章节。
3. 看 `Tips and tricks`，通常是实战经验。
4. 看底部 `Related articles`，补齐相邻主题。
5. 用 `man` 确认参数，再执行命令。

几个常被忽略的入口：

| 入口 | 用途 |
| --- | --- |
| 警告框（Note/Warning/Tip） | 版本差异、破坏性操作、常见错误 |
| Related articles | 相邻主题的官方页面 |
| 分类页（Category） | 按主题聚合页面 |
| 页面历史 | 判断内容是否随版本更新 |
| 语言版本 | 中文版可能滞后，优先读英文原文 |

搜索技巧：

```text
site:wiki.archlinux.org systemd timer
site:wiki.archlinux.org pacman partial upgrade
```

搜索引擎的 `site:` 限定通常比站内搜索更容易命中。中文页面缺失时，直接读英文页。

## 本地文档

Wiki 之外，系统自带文档是第一手资料：

```bash
man pacman
man pacman.conf
man systemd.service
man systemd.timer
man PKGBUILD
pacman --help
pacman -Ql pacman | grep man
```

`pacman -Ql 包名` 列出包安装的所有文件，可以用它找某个包自带的文档、示例配置或 man page。

```bash
# 找出 systemd 包提供了哪些 man page
pacman -Ql systemd | grep '/man/'
```

## 如何搜索错误

错误信息搜不到，通常不是问题太新，而是搜索词没处理干净：

1. 用英文原文，不要翻译后再搜。
2. 去掉路径、用户名、时间戳和版本号。
3. 保留关键模块名和错误码。
4. 优先看 Wiki，其次看 Arch 论坛和上游 issue。

示例：

```text
原始：error: failed to commit transaction (conflicting files) /usr/lib/foo.so exists in filesystem
搜索：pacman conflicting files exists in filesystem
```

## 笔记模板

每次排障或实验，用同一结构记录：

```text
## 问题
一句话描述现象与触发条件。

## 命令
实际执行的命令，按顺序。

## 输出
关键输出或错误原文，必要时截取。

## 结论
根因、修复动作、下次如何避免。
```

把记录放进一个固定目录，按日期命名。它能让你在几个月后仍能复现当时的判断。

## 小结

- 全书八个部分有明确顺序，02 包管理是核心，不能跳过。
- 学习以任务驱动，一次一个主题，先备份，保留命令与输出。
- Wiki 按“警告框 → 主体 → Tips → Related articles”的顺序读。
- 搜索错误时用英文原文、去掉噪声，优先 Wiki。
- `man`、`--help`、`pacman -Ql` 能解决大量本地文档问题。

## 练习

1. 从 Wiki 的 Main page 找到 Pacman 页面，列出它的 Related articles 中三个页面。
2. 用 `man pacman` 查出 `-Qdt` 的含义，并与 `pacman --help` 对照。
3. 用 `pacman -Ql` 找出一个包自带的配置文件或 man page。
4. 把本节笔记模板套用到你最近一次命令报错上，写出四段记录。

## 自检

- [ ] 能说出八个部分各自的目标
- [ ] 能解释为什么 02 包管理不能跳过
- [ ] 读 Wiki 时会先看警告框和 Related articles
- [ ] 能用英文原文搜索错误并去掉路径、版本号
- [ ] 有一份可复现的笔记模板

## 参考

- [Main page](https://wiki.archlinux.org/title/Main_page)
- [Help:Reading](https://wiki.archlinux.org/title/Help:Reading)
- [Getting involved](https://wiki.archlinux.org/title/Getting_involved)
- [Arch Wiki:Contributing](https://wiki.archlinux.org/title/Arch_Wiki:Contributing)
