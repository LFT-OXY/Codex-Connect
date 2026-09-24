const STYLE_ATTRIBUTE = "data-codexhost-thinking-option-style";

/**
 * 思考卡片滑块的注入样式。滑块颜色全部是本项目自定义值，并用 `light-dark()`
 * 跟随宿主页面实际解析的 color-scheme（同 renderer-usage-control.ts），
 * 不引用 Desktop 私有设计 token。
 */
export function ensureRendererThinkingOptionStyle(ownerDocument: Document): void {
  if (ownerDocument.querySelector(`style[${STYLE_ATTRIBUTE}]`)) return;
  const style = ownerDocument.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "true");
  style.textContent = `
    [data-codexhost-thinking-slider] {
      position: relative;
      margin-top: 10px;
      padding: 12px 8px;
      cursor: pointer;
      outline: none;
      touch-action: none;
      user-select: none;
    }
    [data-codexhost-thinking-slider][aria-readonly="true"] {
      cursor: default;
    }
    [data-codexhost-thinking-slider][aria-disabled="true"] {
      cursor: not-allowed;
      opacity: 0.5;
    }
    [data-codexhost-thinking-rail] {
      position: relative;
      height: 10px;
      border-radius: 999px;
      background: light-dark(rgba(15, 23, 42, 0.08), rgba(255, 255, 255, 0.1));
    }
    [data-codexhost-thinking-fill] {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      overflow: hidden;
      border-radius: inherit;
      transition: width 0.12s ease;
    }
    [data-codexhost-thinking-star] {
      position: absolute;
      width: 2px;
      height: 2px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 3px rgba(255, 255, 255, 0.85);
      opacity: var(--codexhost-thinking-star-opacity, 0);
      animation: codexhost-thinking-twinkle 2.8s ease-in-out infinite;
    }
    @keyframes codexhost-thinking-twinkle {
      0%, 100% { opacity: var(--codexhost-thinking-star-opacity, 0); }
      50% { opacity: calc(var(--codexhost-thinking-star-opacity, 0) * 0.35); }
    }
    [data-codexhost-thinking-dot] {
      position: absolute;
      top: 50%;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: light-dark(rgba(15, 23, 42, 0.28), rgba(255, 255, 255, 0.32));
      pointer-events: none;
    }
    [data-codexhost-thinking-dot][data-active="true"] {
      background: rgba(255, 255, 255, 0.85);
    }
    [data-codexhost-thinking-thumb] {
      position: absolute;
      top: 50%;
      box-sizing: border-box;
      width: 16px;
      height: 16px;
      border: 3px solid var(--codexhost-thinking-thumb-color, currentColor);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: #fff;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
      pointer-events: none;
      transition: left 0.12s ease;
    }
    [data-codexhost-thinking-slider]:focus-visible [data-codexhost-thinking-thumb] {
      outline: 2px solid var(--codexhost-thinking-thumb-color, currentColor);
      outline-offset: 2px;
    }
    [data-codexhost-thinking-slider][data-dragging] [data-codexhost-thinking-fill],
    [data-codexhost-thinking-slider][data-dragging] [data-codexhost-thinking-thumb] {
      transition: none;
    }
    @media (prefers-reduced-motion: reduce) {
      [data-codexhost-thinking-star] {
        animation: none;
      }
      [data-codexhost-thinking-fill],
      [data-codexhost-thinking-thumb] {
        transition: none;
      }
    }
  `;
  (ownerDocument.head ?? ownerDocument.documentElement).append(style);
}
