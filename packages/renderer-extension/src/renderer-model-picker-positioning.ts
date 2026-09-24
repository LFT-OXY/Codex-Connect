const MENU_SIDE_OFFSET = 8;
const COLLISION_PADDING = 8;

const RENDERER_MODEL_PICKER_MODEL_MENU_WIDTH = 280;
export const RENDERER_MODEL_PICKER_MODEL_MENU_MAX_HEIGHT = 360;
const RENDERER_THINKING_CARD_WIDTH = 248;

export interface RendererMenuRect {
  left: number;
  right: number;
  top: number;
}

export interface RendererViewport {
  width: number;
  height: number;
}

export interface RendererMenuPlacement {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight?: number;
}

function clampPosition(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function fitWidth(preferredWidth: number, viewportWidth: number): number {
  return Math.max(
    COLLISION_PADDING,
    Math.min(preferredWidth, viewportWidth - COLLISION_PADDING * 2),
  );
}

function fitHeight(viewport: RendererViewport): number {
  return Math.max(
    COLLISION_PADDING,
    Math.min(
      RENDERER_MODEL_PICKER_MODEL_MENU_MAX_HEIGHT,
      viewport.height * 0.6,
      viewport.height - COLLISION_PADDING * 2,
    ),
  );
}

function bottomAbove(triggerRect: RendererMenuRect, viewport: RendererViewport): number {
  return Math.max(COLLISION_PADDING, viewport.height - triggerRect.top + MENU_SIDE_OFFSET);
}

export function rendererModelPickerStandaloneModelMenuPlacement(
  triggerRect: RendererMenuRect,
  viewport: RendererViewport,
): RendererMenuPlacement {
  const width = fitWidth(RENDERER_MODEL_PICKER_MODEL_MENU_WIDTH, viewport.width);
  const maxLeft = viewport.width - COLLISION_PADDING - width;
  return {
    left: clampPosition(triggerRect.right - width, COLLISION_PADDING, maxLeft),
    width,
    maxHeight: fitHeight(viewport),
    bottom: bottomAbove(triggerRect, viewport),
  };
}

/** 思考卡片锚定在思考药丸上方、左边对齐，超出视口时收回。 */
export function rendererThinkingCardPlacement(
  triggerRect: RendererMenuRect,
  viewport: RendererViewport,
): RendererMenuPlacement {
  const width = fitWidth(RENDERER_THINKING_CARD_WIDTH, viewport.width);
  const maxLeft = viewport.width - COLLISION_PADDING - width;
  return {
    left: clampPosition(triggerRect.left, COLLISION_PADDING, maxLeft),
    width,
    bottom: bottomAbove(triggerRect, viewport),
  };
}
