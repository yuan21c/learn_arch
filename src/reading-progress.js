(function readingProgress() {
  'use strict';

  const STORAGE_KEY = 'arch-handbook-reading-progress';
  const JUMP_FLAG = 'arch-handbook-auto-jump';

  // 读取本地存储的阅读进度，失败则静默忽略。
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
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

  // 是否正在执行自动跳转：true 时 beforeunload 不再覆盖 localStorage，避免跳转循环。
  let isAutoJumping = false;

  // 冷启动后恢复一次：
  // - 若当前页面正是上次阅读的章节（url 完全一致），则回到上次滚动位置；
  // - 若当前页面不是（例如打开的是默认页），则自动导航到上次阅读的章节（仅跳转一次）。
  // 手动切换页面后，新页面加载时 url 会匹配，从而恢复该页面的滚动位置；
  // 阅读过程中用户的手动滚动与切换不再触发基于阅读进度的自动定位。
  function restoreOnColdStart() {
    const stored = loadProgress();
    if (!stored || !stored.url) {
      return;
    }

    // 若本次加载是由自动跳转造成的，清除标记，只做滚动恢复，不再尝试跳转。
    const isAutoJump = sessionStorage.getItem(JUMP_FLAG) === '1';
    if (isAutoJump) {
      sessionStorage.removeItem(JUMP_FLAG);
    }

    const currentUrl = location.pathname + location.hash;
    if (stored.url === currentUrl) {
      if (typeof stored.scrollTop === 'number') {
        window.scrollTo(0, stored.scrollTop);
      }
    } else if (!isAutoJump) {
      // 标记本次跳转为自动跳转，并在 beforeunload 中跳过保存，
      // 防止跳转源页面的 beforeunload 把 url 覆盖为当前页面，导致无限循环。
      isAutoJumping = true;
      sessionStorage.setItem(JUMP_FLAG, '1');
      location.href = stored.url;
    }
    // 若 isAutoJump 且 url 仍不匹配：什么都不做，循环已停止。
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
  // 自动跳转时跳过保存，避免把跳转源页面的 url 写入存档，导致跳转循环。
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('beforeunload', function () {
    if (isAutoJumping) {
      return;
    }
    save();
  }, { passive: true });
})();
