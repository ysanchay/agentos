/**
 * @agentos/desktop — Type Definitions
 * Desktop automation strategy interface, I/O types, and error codes.
 * Agents never know whether NativeStrategy, NutJSStrategy, or another
 * strategy is executing — they just invoke capabilities.
 */

// ─── Platform Types ─────────────────────────────────────────────────────────

export type DesktopPlatform = 'windows' | 'macos' | 'linux' | 'unknown';

// ─── Window Types ────────────────────────────────────────────────────────────

export interface WindowInfo {
  /** Window title */
  title: string;
  /** Application name */
  appName: string;
  /** Process ID */
  pid: number;
  /** Window handle/ID (platform-specific) */
  windowId: string;
  /** Window bounds */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Whether the window is focused/active */
  focused: boolean;
}

// ─── Screenshot Types ────────────────────────────────────────────────────────

export interface DesktopScreenshotOptions {
  /** Target window ID (null = full screen) */
  windowId?: string;
  /** Region to capture (x, y, width, height) */
  region?: { x: number; y: number; width: number; height: number };
  /** Output format */
  format?: 'png' | 'jpeg';
  /** JPEG quality (1-100, only for jpeg) */
  quality?: number;
}

export interface DesktopScreenshotResult {
  /** Base64-encoded image data */
  data: string;
  /** MIME type */
  mimeType: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Size in bytes */
  sizeBytes: number;
}

// ─── Accessibility Tree Types ─────────────────────────────────────────────────

export type AccessibilityRole =
  | 'desktop' | 'window' | 'dialog' | 'button' | 'checkbox' | 'combobox'
  | 'edit' | 'hyperlink' | 'image' | 'list' | 'listitem'
  | 'menu' | 'menubar' | 'menuitem' | 'progressbar' | 'radio'
  | 'scrollbar' | 'slider' | 'spinbutton' | 'statusbar' | 'tab'
  | 'tablist' | 'table' | 'tree' | 'treeitem' | 'text'
  | 'toolbar' | 'tooltip' | 'group' | 'pane' | 'document'
  | 'separator' | 'titlebar' | 'unknown';

export interface AccessibilityTreeNode {
  /** Unique identifier for this element */
  id: string;
  /** Accessibility role */
  role: AccessibilityRole;
  /** Element name/label */
  name: string;
  /** Element value */
  value?: string;
  /** Element description */
  description?: string;
  /** Bounding rectangle */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Whether the element is visible */
  visible?: boolean;
  /** Whether the element is focused */
  focused?: boolean;
  /** Whether the element is enabled */
  enabled?: boolean;
  /** Child elements */
  children: AccessibilityTreeNode[];
}

export interface DesktopTreeOptions {
  /** Target window ID (null = active window) */
  windowId?: string;
  /** Maximum depth to traverse (default: 10) */
  maxDepth?: number;
  /** Filter by roles (null = all roles) */
  roles?: AccessibilityRole[];
}

export interface AccessibilityTree {
  /** Root node of the tree */
  root: AccessibilityTreeNode;
  /** Total number of nodes */
  nodeCount: number;
  /** Maximum depth reached */
  maxDepth: number;
  /** Window info for the tree */
  window: WindowInfo;
}

// ─── Query Types ──────────────────────────────────────────────────────────────

export interface DesktopQueryOptions {
  /** Search by accessibility role */
  role?: AccessibilityRole;
  /** Search by element name (substring match) */
  name?: string;
  /** Search by element ID */
  id?: string;
  /** Search by CSS-like selector (platform-specific) */
  selector?: string;
  /** Maximum results to return (default: 100) */
  limit?: number;
  /** Target window ID (null = active window) */
  windowId?: string;
}

export interface DesktopElement {
  /** Unique identifier */
  id: string;
  /** Accessibility role */
  role: AccessibilityRole;
  /** Element name/label */
  name: string;
  /** Element value */
  value?: string;
  /** Bounding rectangle */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Whether the element is visible */
  visible?: boolean;
  /** Whether the element is enabled */
  enabled?: boolean;
  /** Whether the element is focused */
  focused?: boolean;
  /** Additional properties */
  properties?: Record<string, string>;
}

// ─── Read Types ───────────────────────────────────────────────────────────────

export interface DesktopReadOptions {
  /** Element ID to read */
  elementId: string;
  /** Target window ID (null = active window) */
  windowId?: string;
  /** Properties to read (null = all) */
  properties?: string[];
}

export interface ElementContent {
  /** Element ID */
  elementId: string;
  /** Element text content */
  text?: string;
  /** Element value */
  value?: string;
  /** Element role */
  role: AccessibilityRole;
  /** Element name */
  name: string;
  /** All properties */
  properties: Record<string, string>;
}

// ─── Interaction Types ────────────────────────────────────────────────────────

export interface DesktopClickOptions {
  /** Click at coordinates */
  x?: number;
  /** Click at coordinates */
  y?: number;
  /** Click on element by ID */
  elementId?: string;
  /** Mouse button (default: 'left') */
  button?: 'left' | 'right' | 'middle';
  /** Number of clicks (default: 1) */
  clickCount?: number;
}

export interface DesktopTypeOptions {
  /** Text to type */
  text: string;
  /** Type into element by ID (null = focused element) */
  elementId?: string;
  /** Delay between keystrokes in ms (default: 0) */
  delay?: number;
  /** Clear existing text before typing (default: true) */
  clear?: boolean;
}

export interface DesktopScrollOptions {
  /** Scroll direction */
  direction: 'up' | 'down' | 'left' | 'right';
  /** Scroll amount in pixels (default: 300) */
  amount?: number;
  /** Scroll element by ID (null = active window) */
  elementId?: string;
}

export interface DesktopLaunchOptions {
  /** Application name or path */
  app: string;
  /** Command-line arguments */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Whether to wait for the app to be ready (default: false) */
  waitForReady?: boolean;
  /** Maximum wait time in ms (default: 10000) */
  timeoutMs?: number;
}

export interface DesktopFocusOptions {
  /** Focus window by ID */
  windowId?: string;
  /** Focus element by ID */
  elementId?: string;
  /** Application name to focus */
  appName?: string;
}

export interface DesktopKeyOptions {
  /** Key combination (e.g., 'ctrl+c', 'alt+f4', 'enter') */
  key: string;
  /** Key modifiers */
  modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  /** Number of times to press (default: 1) */
  count?: number;
}

// ─── Action Result ─────────────────────────────────────────────────────────────

export interface DesktopActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  durationMs: number;
  /** Window state after action */
  window?: WindowInfo;
}

// ─── Strategy Interface ────────────────────────────────────────────────────────

/**
 * Desktop automation strategy interface.
 * Implementations: NativeStrategy (zero-dep, OS commands),
 * NutJSStrategy (full automation via @nut-tree/nut-js).
 */
export interface IDesktopStrategy {
  /** Strategy identifier */
  readonly name: string;
  /** Whether this strategy can interact with native applications */
  readonly supportsNativeApps: boolean;
  /** Current platform */
  readonly platform: DesktopPlatform;

  // ─── Perceive (read-only) ────────────────────────────────────────────────

  /** Capture a screenshot */
  screenshot(options?: DesktopScreenshotOptions): Promise<DesktopScreenshotResult>;

  /** Get the accessibility tree of a window */
  getTree(options?: DesktopTreeOptions): Promise<AccessibilityTree>;

  /** Query for desktop elements */
  query(options: DesktopQueryOptions): Promise<DesktopElement[]>;

  /** Read content from a specific element */
  read(options: DesktopReadOptions): Promise<ElementContent>;

  // ─── Actuate (mutation) ──────────────────────────────────────────────────

  /** Click at coordinates or on an element */
  click(options: DesktopClickOptions): Promise<DesktopActionResult>;

  /** Type text into an element */
  type(options: DesktopTypeOptions): Promise<DesktopActionResult>;

  /** Scroll a window or element */
  scroll(options: DesktopScrollOptions): Promise<DesktopActionResult>;

  /** Launch an application */
  launchApp(options: DesktopLaunchOptions): Promise<DesktopActionResult>;

  /** Focus a window or element */
  focus(options: DesktopFocusOptions): Promise<DesktopActionResult>;

  /** Press a key or key combination */
  pressKey(options: DesktopKeyOptions): Promise<DesktopActionResult>;

  // ─── State ────────────────────────────────────────────────────────────────

  /** Get the currently focused window */
  currentWindow(): WindowInfo | null;

  /** List all open windows */
  listWindows(): Promise<WindowInfo[]>;

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Clean up resources */
  close(): Promise<void>;
}

// ─── Session & Pool Config ────────────────────────────────────────────────────

export interface DesktopSessionConfig {
  /** Idle timeout in ms (default: 300000) */
  idleTimeoutMs?: number;
  /** Workspace ID for session isolation */
  workspaceId?: string;
  /** Initial window to focus */
  initialWindowId?: string;
}

export interface DesktopSessionState {
  sessionId: string;
  currentWindowId: string | null;
  createdAt: number;
  lastActivityAt: number;
  requestCount: number;
  active: boolean;
}

export interface DesktopPoolConfig {
  /** Maximum concurrent sessions (default: 3) */
  maxSessions?: number;
  /** Idle timeout in ms (default: 300000) */
  idleTimeoutMs?: number;
  /** Maximum total requests across all sessions (default: 500) */
  maxTotalRequests?: number;
  /** Strategy type to use: 'native' or 'nutjs' */
  strategyType?: 'native' | 'nutjs';
}

// ─── Process & Window Management Types ────────────────────────────────────────

export interface ProcessInfo {
  /** Process ID */
  pid: number;
  /** Process name */
  name: string;
  /** CPU usage percentage */
  cpuPercent?: number;
  /** Memory usage in MB */
  memoryMB?: number;
  /** Process status */
  status: 'running' | 'stopped' | 'not_responding' | 'unknown';
  /** Command line */
  commandLine?: string;
}

export interface WindowManagementOptions {
  /** Window ID */
  windowId?: string;
  /** Action: minimize, maximize, restore, close */
  action: 'minimize' | 'maximize' | 'restore' | 'close';
}

export interface DesktopDragDropOptions {
  /** Source element ID or coordinates */
  fromElementId?: string;
  fromX?: number;
  fromY?: number;
  /** Target element ID or coordinates */
  toElementId?: string;
  toX?: number;
  toY?: number;
}

export interface DesktopFileUploadOptions {
  /** Element ID of the file input */
  elementId?: string;
  /** File paths to upload */
  files: string[];
}

export interface TrayIconInfo {
  /** Icon name or tooltip */
  name: string;
  /** Associated process name */
  processName?: string;
  /** Icon position (if detectable) */
  position?: { x: number; y: number };
  /** Whether the icon is visible */
  visible: boolean;
}

// ─── Error Codes ──────────────────────────────────────────────────────────────

export const DESKTOP_ERRORS = {
  NO_DISPLAY: 'DESKTOP_NO_DISPLAY',
  APP_NOT_FOUND: 'DESKTOP_APP_NOT_FOUND',
  ELEMENT_NOT_FOUND: 'DESKTOP_ELEMENT_NOT_FOUND',
  WINDOW_NOT_FOUND: 'DESKTOP_WINDOW_NOT_FOUND',
  ACTION_FAILED: 'DESKTOP_ACTION_FAILED',
  TIMEOUT: 'DESKTOP_TIMEOUT',
  SESSION_EXPIRED: 'DESKTOP_SESSION_EXPIRED',
  POOL_FULL: 'DESKTOP_POOL_FULL',
  REQUIRES_NATIVE: 'DESKTOP_REQUIRES_NATIVE',
  PLATFORM_UNSUPPORTED: 'DESKTOP_PLATFORM_UNSUPPORTED',
  UIAUTOMATION_UNAVAILABLE: 'DESKTOP_UIAUTOMATION_UNAVAILABLE',
  OCR_FALLBACK: 'DESKTOP_OCR_FALLBACK',
  PROCESS_NOT_FOUND: 'DESKTOP_PROCESS_NOT_FOUND',
  TRAY_NOT_FOUND: 'DESKTOP_TRAY_NOT_FOUND',
  DRAG_DROP_FAILED: 'DESKTOP_DRAG_DROP_FAILED',
  FILE_UPLOAD_FAILED: 'DESKTOP_FILE_UPLOAD_FAILED',
} as const;

export type DesktopErrorCode = typeof DESKTOP_ERRORS[keyof typeof DESKTOP_ERRORS];