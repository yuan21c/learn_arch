(function readingProgress() {
  'use strict';

  const STORAGE_KEY = 'arch-handbook-reading-progress';
  const RESTORED_KEY = 'arch-handbook-restored';      // 冷启动恢复已执行过，后续不再自动定位
  const PENDING_RESTORE_KEY = 'arch-handbook-pending-restore'; // 自动跳转后待恢复滚动

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

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

  function restoreOnColdStart() {
    const alreadyRestored = sessionStorage.getItem(RESTORED_KEY) === '1';
    const pendingRestore = sessionStorage.getItem(PENDING_RESTORE_KEY) === '1';

    const stored = loadProgress();
    if (!stored || !stored.url) {
      if (!alreadyRestored) {
        sessionStorage.setItem(RESTORED_KEY, '1');
      }
      return;
    }

    const currentUrl = location.pathname + location.hash;

    // 自动跳转后到达目标页面：恢复滚动，标记已恢复，之后不再自动定位
    if (pendingRestore) {
      sessionStorage.removeItem(PENDING_RESTORE_KEY);
      if (!alreadyRestored) {
        sessionStorage.setItem(RESTORED_KEY, '1');
      }
      if (stored.url === currentUrl && typeof stored.scrollTop === 'number') {
        window.scrollTo(0, stored.scrollTop);
      }
      return;
    }

    // 冷启动后的后续页面加载：永远不再自动定位
    if (alreadyRestored) {
      return;
    }

    // 第一次冷启动
    if (stored.url === currentUrl) {
      if (typeof stored.scrollTop === 'number') {
        window.scrollTo(0, stored.scrollTop);
      }
      sessionStorage.setItem(RESTORED_KEY, '1');
    } else {
      // 需要跳转到存档页面：仅跳转一次，跳转后页面加载时走 pendingRestore 分支恢复滚动
      sessionStorage.setItem(PENDING_RESTORE_KEY, '1');
      location.href = stored.url;
    }
  }

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreOnColdStart, { once: true });
  } else {
    restoreOnColdStart();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('beforeunload', function () {
    // 自动跳转时跳过保存，避免把跳转源页面的 url 写入存档，导致下次加载时匹配错误
    if (sessionStorage.getItem(PENDING_RESTORE_KEY) === '1') {
      return;
    }
    save();
  }, { passive: true });
})();
