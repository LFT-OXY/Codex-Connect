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
      margin-top: 12px;
      padding: 2px 0;
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
      height: 24px;
      border-radius: 999px;
      background: light-dark(rgba(15, 23, 42, 0.08), rgba(255, 255, 255, 0.12));
    }
    [data-codexhost-thinking-fill] {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      overflow: hidden;
      border-radius: inherit;
      transition: width 0.2s ease-out;
    }
    [data-codexhost-thinking-track] {
      position: absolute;
      top: 0;
      bottom: 0;
    }
    [data-codexhost-thinking-star] {
      position: absolute;
      width: 2px;
      height: 2px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 4px rgba(255, 255, 255, 0.9);
      opacity: var(--codexhost-thinking-star-opacity, 0);
      animation: codexhost-thinking-twinkle 2.8s ease-in-out infinite;
    }
    [data-codexhost-thinking-star]:nth-child(3n) {
      width: 3px;
      height: 3px;
    }
    @keyframes codexhost-thinking-twinkle {
      0%, 100% { opacity: var(--codexhost-thinking-star-opacity, 0); }
      50% { opacity: calc(var(--codexhost-thinking-star-opacity, 0) * 0.35); }
    }
    [data-codexhost-thinking-dot] {
      position: absolute;
      top: 50%;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: light-dark(rgba(15, 23, 42, 0.26), rgba(255, 255, 255, 0.3));
      pointer-events: none;
      transition: opacity 0.2s ease-out;
    }
    [data-codexhost-thinking-dot][data-reached="true"] {
      opacity: 0;
    }
    [data-codexhost-thinking-thumb] {
      position: absolute;
      top: 50%;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: #fff;
      box-shadow:
        0 1px 4px rgba(0, 0, 0, 0.22),
        0 0 0 0.5px rgba(0, 0, 0, 0.08);
      pointer-events: none;
      transition: left 0.2s ease-out;
    }
    [data-codexhost-thinking-slider]:focus-visible [data-codexhost-thinking-thumb] {
      outline: 2px solid var(--codexhost-thinking-accent, currentColor);
      outline-offset: 2px;
    }
    [data-codexhost-thinking-slider][data-dragging="moving"] [data-codexhost-thinking-fill],
    [data-codexhost-thinking-slider][data-dragging="moving"] [data-codexhost-thinking-dot],
    [data-codexhost-thinking-slider][data-dragging="moving"] [data-codexhost-thinking-thumb] {
      transition: none;
    }
    @media (prefers-reduced-motion: reduce) {
      [data-codexhost-thinking-star] {
        animation: none;
      }
      [data-codexhost-thinking-fill],
      [data-codexhost-thinking-dot],
      [data-codexhost-thinking-thumb] {
        transition: none;
      }
    }
  `;
  (ownerDocument.head ?? ownerDocument.documentElement).append(style);
}
