# Linux 与 Arch Linux 系统学习手册

从命令、文件、权限，到进程、存储、网络，再到 Arch Linux 的包管理、systemd、构建与排障。

基于 [mdBook](https://rust-lang.github.io/mdBook/) 构建，支持 PWA（可安装、离线可用），通过 GitHub Actions 自动部署到 GitHub Pages。

## 在线阅读

📖 https://yuan21c.github.io/learn_arch/

## 功能特性

- **完整体系**：覆盖 Linux 基础、系统机制、Arch Linux 实操、应用与服务、桌面与生态、附录共 100 余章。
- **PWA 支持**：浏览器可“安装应用”，断网后章节页面仍可离线打开（Service Worker 缓存核心资源）。
- **自动构建**：推送至 `master` 分支时，GitHub Actions 自动用 mdBook 构建并部署到 GitHub Pages。
- **中文优化**：内嵌方正曹礼体、MesloLGS 等中文/等宽字体，适配中文阅读体验。

## 本地构建

需安装 [mdBook](https://rust-lang.github.io/mdBook/index.html)（Rust 工具链）：

```bash
# 安装 mdBook
cargo install mdbook

# 构建 HTML 站点
mdbook build

# 构建产物位于 ./book/ 目录
```

构建后如需启用 PWA 离线能力，需运行注入脚本（已集成在 GitHub Actions 中）：

```bash
node scripts/pwa-inject.js
```

## 项目结构

```
learn_arch/
├── book.toml              # mdBook 配置
├── src/                   # 手册源码（Markdown）
│   ├── SUMMARY.md         # 目录结构
│   ├── README.md          # 手册首页
│   ├── manifest.json      # PWA Web App Manifest
│   ├── sw.js              # PWA Service Worker
│   ├── icons/             # PWA 图标（Arch Linux）
│   ├── fonts/             # 中文与等宽字体
│   ├── 01-Linux-基础/
│   ├── 02-Linux-进阶/
│   ├── 03-Arch-Linux/
│   ├── 04-应用与服务/
│   ├── 05-桌面与生态/
│   └── 06-附录/
├── scripts/
│   └── pwa-inject.js      # 构建后 PWA 文件注入脚本
├── .github/workflows/
│   └── deploy.yml         # GitHub Actions 自动构建部署
├── custom.css             # 自定义样式
└── README.md              # 本文件
```

## 部署

推送至 `master` 分支会触发 GitHub Actions（`.github/workflows/deploy.yml`），自动构建并部署到 `gh-pages` 分支，由 GitHub Pages 托管：

- 仓库：https://github.com/yuan21c/learn_arch
- 站点：https://yuan21c.github.io/learn_arch/

## 许可证

本项目基于 [mdBook](https://github.com/rust-lang/mdBook) 构建，手册内容遵循相应开源协议。
