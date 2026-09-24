import type { HarnessThinkingOption } from "@codexhost/shared-contracts";

import { rendererHarnessMessages } from "./renderer-harness-localization.js";
import {
  isRendererModelPickerDisabled,
  isRendererModelPickerTransient,
  MENU_CLASSES,
  shouldCloseRendererModelPicker,
  syncRendererLabelText,
  thinkingOptionsForModel,
  type RendererModelControlView,
} from "./renderer-model-picker.js";
import { rendererThinkingCardPlacement } from "./renderer-model-picker-positioning.js";
import { ensureRendererThinkingOptionStyle } from "./renderer-thinking-option-style.js";
import {
  ensureRendererTriggerChipStyle,
  TRIGGER_CHIP_CLASS,
} from "./renderer-trigger-chip-style.js";
import type { RendererSettingsLocale } from "./settings/localization.js";

type Rgb = readonly [number, number, number];

/** 滑块渐变节点由本项目定义：起点接近 Codex 强调蓝，终点为紫；不读取 Desktop 私有 token。 */
export const RENDERER_THINKING_GRADIENT: {
  readonly light: { readonly from: Rgb; readonly to: Rgb };
  readonly dark: { readonly from: Rgb; readonly to: Rgb };
} = {
  light: { from: [47, 124, 246], to: [124, 58, 237] },
  dark: { from: [74, 158, 255], to: [167, 139, 250] },
};

export const RENDERER_THINKING_MAX_STARS = 16;

/** 首尾选项点离轨道两端的距离（轨道高度的一半），拖块在两端时仍完整落在轨道上。 */
const RAIL_INSET = 12;
/** 与样式表中 28px 的拖块一致；填充右端这段被拖块盖住。 */
const THUMB_RADIUS = 14;

/** 填充内流动动画的周期（秒）：刚离开第 0 位时最慢，最高档最快。 */
export const RENDERER_THINKING_FLOW = {
  sheen: { slowest: 3.2, fastest: 1.4 },
  drift: { slowest: 9, fastest: 3.5 },
} as const;
const SHEEN_ANIMATION = "codexhost-thinking-sheen";
const DRIFT_ANIMATION = "codexhost-thinking-drift";

export interface RendererThinkingSliderVisual {
  /** 相对位置 `index / (n - 1)`，同时是填充比例。 */
  position: number;
  color: { light: string; dark: string };
  starCount: number;
  starOpacity: number;
  /** 光泽带扫过一次的周期（秒）；第 0 位没有流动，为 0。 */
  sheenSeconds: number;
  /** 星点向右漂移一圈的周期（秒）；第 0 位没有流动，为 0。 */
  driftSeconds: number;
}

export interface RendererThinkingSliderPointer {
  /** 指针在选项点区间内的连续相对位置，0 到 1。 */
  position: number;
  /** 离指针最近的选项下标。 */
  index: number;
}

export interface RendererThinkingOptionPresentation {
  visible: boolean;
  label?: string;
  modelLabel?: string;
  options: HarnessThinkingOption[];
  /** 当前选项在 `options` 中的下标；Harness 尚未确认选项时为 -1。 */
  selectedIndex: number;
  readOnly: boolean;
  disabled: boolean;
  visual: RendererThinkingSliderVisual;
}

interface ThinkingSliderParts {
  slider: HTMLElement;
  rail: HTMLElement;
  fill: HTMLElement;
  stars: HTMLElement;
  track: HTMLElement;
  thumb: HTMLElement;
  dots: HTMLElement[];
}

export interface RendererThinkingOptionPickerControl {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  label: HTMLElement;
  card: HTMLElement;
  title: HTMLElement;
  subtitle: HTMLElement;
  slider: HTMLElement;
  harnessId: string;
  presentation: RendererThinkingOptionPresentation;
  /** 拖动中或提交后等待 Harness 确认时显示的下标；为 null 时跟随 presentation。 */
  displayIndex: number | null;
  /** 拖动中指针的连续位置；为 null 时拖块停在 displayIndex 对应的点上。 */
  dragPosition: number | null;
  close(): void;
  dispose(): void;
}

function interpolate(from: Rgb, to: Rgb, position: number): string {
  const channel = (index: 0 | 1 | 2): number =>
    Math.round(from[index] + (to[index] - from[index]) * position);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function flowSeconds(range: { slowest: number; fastest: number }, position: number): number {
  if (position === 0) return 0;
  return Math.round((range.slowest - (range.slowest - range.fastest) * position) * 100) / 100;
}

function sliderVisualAt(position: number): RendererThinkingSliderVisual {
  return {
    position,
    color: {
      light: interpolate(
        RENDERER_THINKING_GRADIENT.light.from,
        RENDERER_THINKING_GRADIENT.light.to,
        position,
      ),
      dark: interpolate(
        RENDERER_THINKING_GRADIENT.dark.from,
        RENDERER_THINKING_GRADIENT.dark.to,
        position,
      ),
    },
    // 填充长度随 position 线性增长，星点数按平方增长，单位长度上的密度才会随位置变大。
    starCount:
      position === 0
        ? 0
        : Math.max(1, Math.round(position * position * RENDERER_THINKING_MAX_STARS)),
    starOpacity: position === 0 ? 0 : Math.round((0.4 + 0.6 * position) * 100) / 100,
    sheenSeconds: flowSeconds(RENDERER_THINKING_FLOW.sheen, position),
    driftSeconds: flowSeconds(RENDERER_THINKING_FLOW.drift, position),
  };
}

function optionPosition(index: number, count: number): number {
  return count > 1 ? Math.min(Math.max(index, 0), count - 1) / (count - 1) : 0;
}

export function rendererThinkingSliderVisual(
  index: number,
  count: number,
): RendererThinkingSliderVisual {
  return sliderVisualAt(optionPosition(index, count));
}

/** `track` 是首尾选项点之间的区间，不含轨道两端的内缩。 */
export function rendererThinkingSliderPointerAt(
  clientX: number,
  track: { left: number; width: number },
  count: number,
): RendererThinkingSliderPointer {
  if (count <= 1 || track.width <= 0) return { position: 0, index: 0 };
  const position = Math.min(Math.max((clientX - track.left) / track.width, 0), 1);
  return { position, index: Math.round(position * (count - 1)) };
}

export function rendererThinkingOptionPresentation(
  view: RendererModelControlView,
): RendererThinkingOptionPresentation {
  const options =
    view.thinkingSelectionSupported === false
      ? []
      : thinkingOptionsForModel(view.catalog, view.selected);
  const visible = options.length > 0 && !(options.length === 1 && options[0]?.id === "off");
  const selectedIndex = visible
    ? options.findIndex(({ id }) => id === view.selectedThinkingOptionId)
    : -1;
  const label = options[selectedIndex]?.label;
  const modelLabel = view.catalog?.models.find(
    (model) => model.ref.id === view.selected?.id,
  )?.label;
  return {
    visible,
    ...(label === undefined ? {} : { label }),
    ...(visible && modelLabel !== undefined ? { modelLabel } : {}),
    options: visible ? options : [],
    selectedIndex,
    readOnly: options.length < 2,
    disabled: isRendererModelPickerDisabled(view),
    visual: rendererThinkingSliderVisual(selectedIndex, options.length),
  };
}

function popoverOpen(element: HTMLElement): boolean {
  return element.matches(":popover-open");
}

function sliderParts(control: RendererThinkingOptionPickerControl): ThinkingSliderParts {
  const rail = control.slider.querySelector<HTMLElement>("[data-codexhost-thinking-rail]");
  const fill = control.slider.querySelector<HTMLElement>("[data-codexhost-thinking-fill]");
  const stars = control.slider.querySelector<HTMLElement>("[data-codexhost-thinking-stars]");
  const track = control.slider.querySelector<HTMLElement>("[data-codexhost-thinking-track]");
  const thumb = control.slider.querySelector<HTMLElement>("[data-codexhost-thinking-thumb]");
  if (!rail || !fill || !stars || !track || !thumb) {
    throw new Error("Thinking slider structure is unavailable");
  }
  return {
    slider: control.slider,
    rail,
    fill,
    stars,
    track,
    thumb,
    dots: [...track.querySelectorAll<HTMLElement>("[data-codexhost-thinking-dot]")],
  };
}

function createStar(index: number, half: 0 | 1): HTMLElement {
  const star = document.createElement("span");
  star.dataset.codexhostThinkingStar = "true";
  // 黄金分割序列让星点稳定、均匀地散开。星点层是填充的两倍宽，
  // 左右两半各放一份，向右平移半层后正好首尾相接，漂移才能无缝循环；
  // 每半只铺到拖块之前，静止（减少动态效果）时星点也不会藏在拖块下。
  const spread = ((index * 0.618034 + 0.31) % 1) * 0.92 + 0.04;
  star.style.left = `calc(${half * 50}% + (50% - ${THUMB_RADIUS}px) * ${spread.toFixed(4)})`;
  star.style.top = `${(((index * 0.381966 + 0.17) % 1) * 60 + 20).toFixed(2)}%`;
  star.style.animationDelay = `${((index * 0.73) % 2.8).toFixed(2)}s`;
  // 每 3 颗放大一颗，在较粗的填充上更显眼。
  if (index % 3 === 2) {
    star.style.width = "3px";
    star.style.height = "3px";
  }
  return star;
}

function syncStars(layer: HTMLElement, count: number): void {
  const stars = layer.querySelectorAll("[data-codexhost-thinking-star]");
  // 拖动时星点数连续变化，只增删差额，已有星点的闪烁不被重置。
  for (let index = stars.length / 2; index < count; index += 1) {
    layer.append(createStar(index, 0), createStar(index, 1));
  }
  for (let index = stars.length - 1; index >= count * 2; index -= 1) stars[index]?.remove();
}

/**
 * 按档位调整流动速度。改 `animation-duration` 会让进行中的动画按新周期重算进度而跳帧，
 * 因此只改播放速率：`updatePlaybackRate` 保持当前进度连续。
 */
function syncFlowSpeed(fill: HTMLElement, visual: RendererThinkingSliderVisual): void {
  for (const animation of fill.getAnimations({ subtree: true })) {
    if (!(animation instanceof CSSAnimation)) continue;
    const seconds =
      animation.animationName === SHEEN_ANIMATION
        ? visual.sheenSeconds
        : animation.animationName === DRIFT_ANIMATION
          ? visual.driftSeconds
          : 0;
    const baseDuration = animation.effect?.getTiming().duration;
    if (seconds === 0 || typeof baseDuration !== "number") continue;
    const rate = baseDuration / (seconds * 1000);
    if (Math.abs(animation.playbackRate - rate) > 0.001) animation.updatePlaybackRate(rate);
  }
}

function applyDisplay(control: RendererThinkingOptionPickerControl): void {
  const { options, selectedIndex } = control.presentation;
  const index = control.displayIndex ?? selectedIndex;
  const position = control.dragPosition ?? optionPosition(index, options.length);
  const visual = sliderVisualAt(position);
  const origin = sliderVisualAt(0).color;
  const color = `light-dark(${visual.color.light}, ${visual.color.dark})`;
  const option = options[index];
  const parts = sliderParts(control);
  // 填充右端延伸到拖块圆心、被拖块盖住；第 0 位不留填充。
  parts.fill.style.width =
    position === 0
      ? "0px"
      : `calc(${RAIL_INSET}px + (100% - ${RAIL_INSET * 2}px) * ${position.toFixed(4)})`;
  parts.fill.style.background = `linear-gradient(90deg, light-dark(${origin.light}, ${origin.dark}), ${color})`;
  parts.fill.style.setProperty("--codexhost-thinking-star-opacity", String(visual.starOpacity));
  syncStars(parts.stars, visual.starCount);
  syncFlowSpeed(parts.fill, visual);
  parts.thumb.style.left = `${(position * 100).toFixed(4)}%`;
  parts.slider.style.setProperty("--codexhost-thinking-accent", color);
  parts.dots.forEach((dot, dotIndex) => {
    dot.dataset.reached = String(optionPosition(dotIndex, options.length) <= position);
  });
  control.title.style.color = color;
  syncRendererLabelText(control.title, option?.label ?? "");
  if (index >= 0 && option) {
    parts.slider.setAttribute("aria-valuenow", String(index));
    parts.slider.setAttribute("aria-valuetext", option.label);
  } else {
    parts.slider.removeAttribute("aria-valuenow");
    parts.slider.removeAttribute("aria-valuetext");
  }
}

function rebuildSlider(control: RendererThinkingOptionPickerControl): void {
  const { options } = control.presentation;
  const rail = document.createElement("div");
  rail.dataset.codexhostThinkingRail = "true";
  const fill = document.createElement("div");
  fill.dataset.codexhostThinkingFill = "true";
  const sheen = document.createElement("span");
  sheen.dataset.codexhostThinkingSheen = "true";
  const stars = document.createElement("span");
  stars.dataset.codexhostThinkingStars = "true";
  fill.append(sheen, stars);
  const track = document.createElement("div");
  track.dataset.codexhostThinkingTrack = "true";
  track.style.left = `${RAIL_INSET}px`;
  track.style.right = `${RAIL_INSET}px`;
  options.forEach((_option, index) => {
    const dot = document.createElement("span");
    dot.dataset.codexhostThinkingDot = "true";
    dot.style.left = `${(optionPosition(index, options.length) * 100).toFixed(4)}%`;
    track.append(dot);
  });
  const thumb = document.createElement("span");
  thumb.dataset.codexhostThinkingThumb = "true";
  track.append(thumb);
  rail.append(fill, track);
  control.slider.replaceChildren(rail);
  control.slider.setAttribute("aria-valuemin", "0");
  control.slider.setAttribute("aria-valuemax", String(Math.max(options.length - 1, 0)));
}

function positionCard(control: RendererThinkingOptionPickerControl): void {
  const placement = rendererThinkingCardPlacement(control.trigger.getBoundingClientRect(), {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  control.card.style.width = `${placement.width}px`;
  control.card.style.left = `${placement.left}px`;
  control.card.style.right = "auto";
  control.card.style.top = "auto";
  control.card.style.bottom = `${placement.bottom}px`;
}

function sliderInteractive(control: RendererThinkingOptionPickerControl): boolean {
  return !control.presentation.readOnly && !control.presentation.disabled;
}

export function mountRendererThinkingOptionPicker(
  composerId: string,
  onSelectThinking: (thinkingOptionId: string) => void,
): RendererThinkingOptionPickerControl {
  ensureRendererTriggerChipStyle(document);
  ensureRendererThinkingOptionStyle(document);

  const root = document.createElement("div");
  root.setAttribute("data-codexhost-thinking-control", composerId);
  root.style.display = "none";
  // 思考 label 很短，窄窗时由 Model 药丸先压缩，这里保持完整。
  root.style.flex = "none";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("data-state", "closed");
  trigger.className = TRIGGER_CHIP_CLASS;
  trigger.style.height = "28px";
  trigger.style.padding = "0 8px";
  trigger.style.font = "400 13px/18px system-ui, sans-serif";
  trigger.style.letterSpacing = "0";

  const label = document.createElement("span");
  label.style.whiteSpace = "nowrap";
  trigger.append(label);
  root.append(trigger);

  const card = document.createElement("div");
  card.id = `${composerId}-thinking-card`;
  card.setAttribute("data-codexhost-thinking-card", composerId);
  card.setAttribute("role", "dialog");
  card.setAttribute("popover", "manual");
  // 卡片底色与圆角有意沿用模型列表的 MENU_CLASSES 保持一致；滑块配色见自有样式表。
  card.className = MENU_CLASSES;
  card.style.position = "fixed";
  card.style.inset = "auto";
  card.style.margin = "0";
  card.style.border = "0";
  card.style.boxSizing = "border-box";
  card.style.padding = "12px 14px 14px";
  trigger.setAttribute("aria-controls", card.id);

  const title = document.createElement("div");
  title.style.font = "600 20px/26px system-ui, sans-serif";
  title.style.letterSpacing = "0";
  title.style.textAlign = "center";
  title.style.overflow = "hidden";
  title.style.textOverflow = "ellipsis";
  title.style.whiteSpace = "nowrap";
  const subtitle = document.createElement("div");
  subtitle.style.font = "400 12px/16px system-ui, sans-serif";
  subtitle.style.color = "color-mix(in srgb, currentColor 60%, transparent)";
  subtitle.style.textAlign = "center";
  subtitle.style.overflow = "hidden";
  subtitle.style.textOverflow = "ellipsis";
  subtitle.style.whiteSpace = "nowrap";
  const slider = document.createElement("div");
  slider.dataset.codexhostThinkingSlider = "true";
  slider.setAttribute("role", "slider");
  slider.setAttribute("aria-orientation", "horizontal");
  slider.tabIndex = 0;
  card.append(title, subtitle, slider);

  let dragging = false;
  const pointerAt = (clientX: number): RendererThinkingSliderPointer =>
    rendererThinkingSliderPointerAt(
      clientX,
      sliderParts(control).track.getBoundingClientRect(),
      control.presentation.options.length,
    );
  const previewAt = (clientX: number): void => {
    const pointer = pointerAt(clientX);
    control.displayIndex = pointer.index;
    control.dragPosition = pointer.position;
    applyDisplay(control);
  };
  const commit = (index: number): void => {
    const option = control.presentation.options[index];
    if (!option || index === control.presentation.selectedIndex) {
      control.displayIndex = null;
      applyDisplay(control);
      return;
    }
    // 保持提交的位置，直到 Harness 返回新的选择状态。
    control.displayIndex = index;
    applyDisplay(control);
    onSelectThinking(option.id);
  };
  const endDrag = (): void => {
    dragging = false;
    control.dragPosition = null;
    // 先恢复过渡，随后写入的吸附位置才会以动画到位。
    delete slider.dataset.dragging;
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !sliderInteractive(control)) return;
    event.preventDefault();
    dragging = true;
    // 按下时保留过渡，点击会以动画吸附到最近的点；真正移动后才连续跟随指针。
    slider.dataset.dragging = "pressed";
    slider.setPointerCapture(event.pointerId);
    slider.focus();
    control.displayIndex = pointerAt(event.clientX).index;
    applyDisplay(control);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    slider.dataset.dragging = "moving";
    previewAt(event.clientX);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) return;
    endDrag();
    if (slider.hasPointerCapture(event.pointerId)) slider.releasePointerCapture(event.pointerId);
    commit(pointerAt(event.clientX).index);
  };
  const onPointerCancel = (): void => {
    if (!dragging) return;
    endDrag();
    control.displayIndex = null;
    applyDisplay(control);
  };
  const onSliderKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // 不让 Harness 的全局键盘处理把焦点拉回输入框。
    event.preventDefault();
    event.stopPropagation();
    if (dragging || !sliderInteractive(control)) return;
    const current = control.displayIndex ?? control.presentation.selectedIndex;
    const last = control.presentation.options.length - 1;
    const next = Math.min(Math.max(current + (event.key === "ArrowRight" ? 1 : -1), 0), last);
    if (next !== current) commit(next);
  };

  const close = (): void => {
    if (dragging) onPointerCancel();
    if (popoverOpen(card)) card.hidePopover();
  };
  const open = (): void => {
    if (trigger.disabled || popoverOpen(card)) return;
    control.displayIndex = null;
    // 先在隐藏状态下写好位置，显示时不会产生过渡；显示后流动动画才存在，再应用一次以设置其速率。
    applyDisplay(control);
    card.showPopover();
    applyDisplay(control);
    positionCard(control);
    slider.focus();
  };
  const onTriggerClick = (): void => {
    if (popoverOpen(card)) close();
    else open();
  };
  const onCardToggle = (): void => {
    const openState = popoverOpen(card);
    trigger.setAttribute("aria-expanded", String(openState));
    trigger.setAttribute("data-state", openState ? "open" : "closed");
  };
  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (!popoverOpen(card)) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && (root.contains(target) || card.contains(target))) return;
    close();
  };
  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !popoverOpen(card)) return;
    event.preventDefault();
    close();
    trigger.focus();
  };
  const onViewportChange = (): void => {
    if (popoverOpen(card)) positionCard(control);
  };
  trigger.addEventListener("click", onTriggerClick);
  card.addEventListener("toggle", onCardToggle);
  slider.addEventListener("pointerdown", onPointerDown);
  slider.addEventListener("pointermove", onPointerMove);
  slider.addEventListener("pointerup", onPointerUp);
  slider.addEventListener("pointercancel", onPointerCancel);
  slider.addEventListener("lostpointercapture", onPointerCancel);
  slider.addEventListener("keydown", onSliderKeyDown);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
  // 与模型列表一样挂到 document 顶层，避免 Composer 祖先的缩放或 transform 影响定位。
  document.body.append(card);

  const control: RendererThinkingOptionPickerControl = {
    root,
    trigger,
    label,
    card,
    title,
    subtitle,
    slider,
    harnessId: "",
    presentation: rendererThinkingOptionPresentation({ status: "idle" }),
    displayIndex: null,
    dragPosition: null,
    close,
    dispose() {
      close();
      trigger.removeEventListener("click", onTriggerClick);
      card.removeEventListener("toggle", onCardToggle);
      slider.removeEventListener("pointerdown", onPointerDown);
      slider.removeEventListener("pointermove", onPointerMove);
      slider.removeEventListener("pointerup", onPointerUp);
      slider.removeEventListener("pointercancel", onPointerCancel);
      slider.removeEventListener("lostpointercapture", onPointerCancel);
      slider.removeEventListener("keydown", onSliderKeyDown);
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      card.remove();
      root.remove();
    },
  };
  rebuildSlider(control);
  applyDisplay(control);
  return control;
}

export function renderRendererThinkingOptionPicker(
  control: RendererThinkingOptionPickerControl,
  view: RendererModelControlView,
  externalHarness: boolean,
  harnessId: string,
  locale: RendererSettingsLocale,
): void {
  if (control.harnessId !== harnessId) {
    control.close();
    control.harnessId = harnessId;
    delete control.root.dataset.optionsSignature;
  }
  const messages = rendererHarnessMessages(locale);
  control.card.setAttribute("aria-label", messages.thinkingOption);
  control.slider.setAttribute("aria-label", messages.thinkingOption);
  // 过渡状态下保持已打开的卡片及其内容不变，只暂时禁用，与模型列表的 keepOpenMenu 语义一致。
  if (externalHarness && popoverOpen(control.card) && isRendererModelPickerTransient(view)) {
    control.trigger.disabled = true;
    control.presentation = { ...control.presentation, disabled: true };
    control.slider.setAttribute("aria-disabled", "true");
    control.trigger.setAttribute("aria-busy", "true");
    return;
  }
  const presentation = rendererThinkingOptionPresentation(view);
  const visible = externalHarness && presentation.visible;
  control.root.style.display = visible ? "inline-flex" : "none";
  control.root.style.alignItems = "center";
  control.root.style.alignSelf = "center";
  control.root.style.height = "28px";
  control.root.style.verticalAlign = "middle";
  if (!visible) {
    control.close();
    control.presentation = presentation;
    return;
  }

  const previous = control.presentation;
  control.presentation = presentation;
  const optionsSignature = JSON.stringify(presentation.options);
  if (control.root.dataset.optionsSignature !== optionsSignature) {
    rebuildSlider(control);
    control.root.dataset.optionsSignature = optionsSignature;
    control.displayIndex = null;
  } else if (
    control.displayIndex !== null &&
    !control.slider.dataset.dragging &&
    (view.status !== "selecting" || presentation.selectedIndex !== previous.selectedIndex)
  ) {
    // 提交后在 selecting 期间保留已提交的位置；Harness 确认或回退后以其结果为准。
    control.displayIndex = null;
  }

  const pillLabel = presentation.label ?? messages.thinkingOption;
  syncRendererLabelText(control.label, pillLabel);
  control.trigger.title = view.error ?? `${messages.thinkingOption}: ${pillLabel}`;
  control.trigger.setAttribute("aria-label", `${messages.thinkingOption}: ${pillLabel}`);
  control.trigger.setAttribute("aria-busy", String(view.status === "selecting"));
  control.trigger.disabled = presentation.disabled;
  if (shouldCloseRendererModelPicker(view)) control.close();

  syncRendererLabelText(control.subtitle, presentation.modelLabel ?? "");
  control.subtitle.title = presentation.modelLabel ?? "";
  if (presentation.readOnly) control.slider.setAttribute("aria-readonly", "true");
  else control.slider.removeAttribute("aria-readonly");
  control.slider.setAttribute("aria-disabled", String(presentation.disabled));
  applyDisplay(control);
}
