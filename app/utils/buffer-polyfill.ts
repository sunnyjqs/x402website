/**
 * Buffer Polyfill for Browser
 * 只在浏览器环境中动态加载，避免 SSR 问题
 */

// 只在浏览器环境执行
if (typeof window !== 'undefined') {
  // 动态导入 buffer，避免 SSR 时执行
  import('buffer').then(({ Buffer }) => {
    if (!window.Buffer) {
      window.Buffer = Buffer;
      (window as any).global = window;
      console.log('✅ Buffer polyfill 已加载（动态）');
    }
  }).catch((err) => {
    console.error('❌ Buffer 加载失败:', err);
  });
}

export {};

