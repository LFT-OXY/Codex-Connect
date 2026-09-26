// Complete Tailwind class names for controls shared by settings pages, so Tailwind finds them.

export const SETTINGS_BUTTON_CLASS = [
  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px]",
  "border border-settings-border bg-settings-surface text-settings-text",
  "transition-colors hover:bg-settings-surface-hover disabled:cursor-default disabled:opacity-60",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-settings-focus",
].join(" ");

/** One option of a segmented control; `aria-pressed` marks the selected one. */
export const SETTINGS_SEGMENT_CLASS = [
  "h-7 rounded-md border-0 px-3 text-[13px]",
  "bg-transparent text-settings-muted",
  "transition-colors hover:text-settings-text focus-visible:outline-2 focus-visible:outline-settings-focus",
  "aria-pressed:bg-settings-panel aria-pressed:font-medium aria-pressed:text-settings-text",
  "aria-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.12)]",
].join(" ");
