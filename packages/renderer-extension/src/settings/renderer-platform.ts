interface RendererUserAgentData {
  readonly platform?: string;
  readonly architecture?: string;
  readonly bitness?: string;
}

export function rendererUserAgentData(navigator: Navigator): RendererUserAgentData | undefined {
  return (navigator as Navigator & { userAgentData?: RendererUserAgentData }).userAgentData;
}

export function isWindowsRenderer(window: Window | null | undefined): boolean {
  const navigator = window?.navigator;
  if (!navigator) return false;
  const identity = `${rendererUserAgentData(navigator)?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`;
  return /windows|win32|win64/iu.test(identity);
}
