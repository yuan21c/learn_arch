#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const BOOK_DIR = process.argv[2] || path.resolve(__dirname, "../book");
const SRC_DIR = path.resolve(__dirname, "../src");

function relPrefix(filePath) {
  // 返回 filePath 所在目录到 book 根的相对前缀，如 "./" 或 "../" 或 "../../"
  const rel = path.relative(path.dirname(filePath), BOOK_DIR);
  return rel === "" ? "./" : rel + "/";
}

function inject(html, rel) {
  const manifestLink = `<link rel="manifest" href="${rel}manifest.json">`;
  const swScript = `<script>
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("${rel}sw.js", { scope: "${rel}" }).then((reg) => {
    console.log("[SW] 注册成功", reg.scope);
  }).catch((err) => {
    console.warn("[SW] 注册失败", err);
  });
}
</script>`;

  let result = html;

  // 插入 manifest link：优先放在 </head> 前，否则放在 <html> 后
  if (result.includes("</head>")) {
    result = result.replace("</head>", manifestLink + "\n</head>");
  } else if (result.includes("<html")) {
    const closeTagIndex = result.indexOf(">");
    if (closeTagIndex !== -1) {
      result = result.slice(0, closeTagIndex + 1) + "\n" + manifestLink + result.slice(closeTagIndex + 1);
    }
  }

  // 插入 SW 注册脚本：优先放在 </body> 前，否则放在 </html> 前
  const swMarker = result.includes("</body>") ? "</body>" : "</html>";
  if (result.includes(swMarker)) {
    result = result.replace(swMarker, swScript + "\n" + swMarker);
  } else {
    result = result + "\n" + swScript;
  }

  return result;
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d);
    } else {
      copyFile(s, d);
    }
  }
}

function main() {
  if (!fs.existsSync(BOOK_DIR)) {
    console.error(`[pwa-inject] book 目录不存在: ${BOOK_DIR}`);
    process.exit(1);
  }

  // 1. 复制 PWA 文件到 book/
  copyFile(path.join(SRC_DIR, "manifest.json"), path.join(BOOK_DIR, "manifest.json"));
  copyFile(path.join(SRC_DIR, "sw.js"), path.join(BOOK_DIR, "sw.js"));
  copyRecursive(path.join(SRC_DIR, "icons"), path.join(BOOK_DIR, "icons"));

  // 2. 遍历 book/ 下所有 HTML，注入 manifest 与 SW
  let count = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".html")) {
        const html = fs.readFileSync(full, "utf8");
        const rel = relPrefix(full);
        const injected = inject(html, rel);
        if (injected !== html) {
          fs.writeFileSync(full, injected, "utf8");
          count++;
        }
      }
    }
  }
  walk(BOOK_DIR);

  console.log(`[pwa-inject] 完成：复制 manifest/sw/icons，已注入 ${count} 个 HTML 页面。`);
}

main();
