const CACHE_NAME = "arch-handbook-v1";
const CORE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./fonts/FZSSK.TTF",
  "./fonts/MesloLGS-LXGW-WenKai-Regular.ttf",
  "./fonts/MesloLGS NF Regular.ttf",
  "./fonts/FZXBS_GBK.ttf",
  "./search/index.html",
  "./search/search-index.js",
  "./search/swiper.min.js",
  "./search/swiper.min.css",
  "./highlight.min.js",
  "./highlight.min.css"
];

// Install: 缓存核心资源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_URLS).catch((err) => {
        console.warn("[SW] 部分核心资源缓存失败，继续:", err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: 清理旧缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: 先命中缓存，缓存未命中则回源；失败回退到首页（离线 SPA 体验）
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 仅处理同源请求
  if (url.origin !== self.location.origin) {
    return;
  }

  // 非 GET 请求不处理
  if (request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        // 只缓存成功的同源响应
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, cloned);
        });
        return response;
      }).catch(() => {
        // 网络失败：对 HTML 页面回退到首页，使离线可浏览
        if (request.headers.get("accept") && request.headers.get("accept").includes("text/html")) {
          return caches.match("./index.html");
        }
        return new Response("", { status: 503, statusText: "Service Unavailable" });
      });
    })
  );
});
