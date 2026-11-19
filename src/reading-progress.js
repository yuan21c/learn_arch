(function readingProgress() {
  'use strict';

  const STORAGE_KEY = 'arch-handbook-reading-progress';

  // 只有当 url（相对路径 + hash）完全一致时，才恢复滚动；冷启动时执行一次。
  function restoreOnColdStart() {
    let stored;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch (e) {
      stored = null;
    }

    if (!stored || !stored.url) {
      return;
    }

    const currentUrl = location.pathname + location.hash;
    if (stored.url === currentUrl && typeof stored.scrollTop === 'number') {
      window.scrollTo(0, stored.scrollTop);
    }
  }

  // 把当前页面相对路径 + hash + 滚动位置写入 localStorage（覆盖旧值，只保留最后一条）。
  function save() {
    const data = {
      url: location.pathname + location.hash,
      scrollTop: window.scrollY,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // 配额超限 / 无痿 / 私密模式等：静默忽略，不阻塞页面。
    }
  }

  // 滚动节流：每帧至多写入一次。
  let ticking = false;
  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(function () {
        save();
        ticking = false;
      });
      ticking = true;
    }
  }

  // 冷启动后恢复一次。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreOnColdStart, { once: true });
  } else {
    restoreOnColdStart();
  }

  // 持续记录滚动位置；退出前再保一次，确保下次冷启动能恢复到最后位置。
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('beforeunload', save, { passive: true });
})();
