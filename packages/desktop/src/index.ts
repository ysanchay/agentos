/**
 * @agentos/desktop — Barrel Exports
 * Desktop automation via native accessibility APIs and optional nut-js integration.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  IDesktopStrategy,
  DesktopPlatform,
  WindowInfo,
  AccessibilityRole,
  AccessibilityTreeNode,
  AccessibilityTree,
  DesktopScreenshotOptions,
  DesktopScreenshotResult,
  DesktopTreeOptions,
  DesktopQueryOptions,
  DesktopElement,
  DesktopReadOptions,
  ElementContent,
  DesktopClickOptions,
  DesktopTypeOptions,
  DesktopScrollOptions,
  DesktopLaunchOptions,
  DesktopFocusOptions,
  DesktopKeyOptions,
  DesktopActionResult,
  DesktopSessionConfig,
  DesktopSessionState,
  DesktopPoolConfig,
  ProcessInfo,
  WindowManagementOptions,
  DesktopDragDropOptions,
  DesktopFileUploadOptions,
  TrayIconInfo,
} from './types.js';

export { DESKTOP_ERRORS } from './types.js';

// ─── Strategy ────────────────────────────────────────────────────────────────

export { NativeStrategy, hasDisplay, createBestDesktopStrategy, createDesktopStrategy, isNutJSAvailable, isUIAutomationAvailable } from './strategies/native-strategy.js';
export { NutJSStrategy } from './strategies/nutjs-strategy.js';
export type { NutJSStrategyConfig } from './strategies/nutjs-strategy.js';
export { UIAutomationStrategy } from './strategies/uiautomation-strategy.js';
export type { UIAutomationStrategyConfig } from './strategies/uiautomation-strategy.js';
export { OCRStrategy } from './strategies/ocr-strategy.js';
export type { OCRStrategyConfig } from './strategies/ocr-strategy.js';

// ─── Session & Pool ──────────────────────────────────────────────────────────

export { DesktopSession } from './desktop-session.js';
export { DesktopPool } from './desktop-pool.js';

// ─── Provider ────────────────────────────────────────────────────────────────

export { DesktopProvider } from './desktop-provider.js';
export type { DesktopProviderConfig } from './desktop-provider.js';

// ─── Window Manager ────────────────────────────────────────────────────────

export { WindowManager } from './window-manager.js';
export type { WindowManagerConfig, WindowSnapshot } from './window-manager.js';