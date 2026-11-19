(function readingProgress() {
  'use strict';

  const STORAGE_KEY = 'arch-handbook-reading-progress';
  const RESTORED_KEY = 'arch-handbook-restored'; // 冷启动恢复已执行过，后续不再自动定位

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
    if (alreadyRestored) {
      // 已在本次标签页生命周期内恢复过，永不再自动定位
      return;
    }

    const stored = loadProgress();
    if (!stored || !stored.url) {
      sessionStorage.setItem(RESTORED_KEY, '1');
      return;
    }

    const currentUrl = location.pathname + location.hash;
    if (stored.url === currentUrl) {
      // 同一页：直接滚动到存档位置
      if (typeof stored.scrollTop === 'number') {
        window.scrollTo(0, stored.scrollTop);
      }
      sessionStorage.setItem(RESTORED_KEY, '1');
    } else {
      // 不同页：replace 到存档页，不在这里设置 restored，
      // 让目标页面自己进入冷启动逻辑并完成滚动恢复
      location.replace(stored.url);
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
    // 冷启动期间（restored !== '1'），抑制 save()，
    // 避免把跳转源页面的 url 写入存档，导致下次冷启动匹配错误
    if (sessionStorage.getItem(RESTORED_KEY) !== '1') {
      return;
    }
    save();
  }, { passive: true });
})();
