/**
 * @agentos/browser — Browser Capability Types
 * Input/output types for browser capability invocations.
 * Agents interact with browsers through these typed interfaces,
 * never knowing whether Playwright, HTTP, or another strategy is executing.
 */

// ─── Navigation Types ─────────────────────────────────────────────────────

export interface NavigateOptions {
  /** Wait until this state before returning (default: 'domcontentloaded') */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Maximum time to wait in ms (default: 30000) */
  timeoutMs?: number;
  /** HTTP referrer header */
  referrer?: string;
}

export interface PageState {
  /** Current URL after navigation */
  url: string;
  /** Page title */
  title: string;
  /** HTTP status code (if available) */
  statusCode?: number;
  /** Time taken in ms */
  durationMs: number;
}

// ─── Screenshot Types ─────────────────────────────────────────────────────

export interface ScreenshotOptions {
  /** Image format (default: 'png') */
  format?: 'png' | 'jpeg';
  /** JPEG quality 0-100 (default: 80, JPEG only) */
  quality?: number;
  /** Capture full page or viewport (default: viewport) */
  fullPage?: boolean;
  /** CSS selector to clip to a specific element */
  clipSelector?: string;
  /** Maximum image dimensions */
  maxWidth?: number;
  maxHeight?: number;
}

export interface ScreenshotResult {
  /** Base64-encoded image data */
  data: string;
  /** MIME type */
  mimeType: string;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Size in bytes */
  sizeBytes: number;
}

// ─── Extract Types ────────────────────────────────────────────────────────

export interface ExtractOptions {
  /** CSS selector for element to extract */
  selector: string;
  /** Which properties to extract (default: text content) */
  properties?: ExtractProperty[];
  /** Include child elements (default: false) */
  includeChildren?: boolean;
  /** Maximum depth for nested extraction */
  maxDepth?: number;
}

export type ExtractProperty = 'text' | 'html' | 'attributes' | 'href' | 'src' | 'value' | 'checked' | 'selected';

export interface ExtractResult {
  /** Extracted content */
  elements: ExtractedElement[];
  /** Number of elements found */
  count: number;
  /** CSS selector used */
  selector: string;
}

export interface ExtractedElement {
  /** Text content (trimmed) */
  text?: string;
  /** Inner HTML */
  html?: string;
  /** Selected attributes */
  attributes?: Record<string, string>;
  /** Child elements (if includeChildren) */
  children?: ExtractedElement[];
}

// ─── Query Types ──────────────────────────────────────────────────────────

export interface QueryOptions {
  /** CSS selector */
  selector: string;
  /** Maximum number of results (default: 100) */
  limit?: number;
}

export interface ElementInfo {
  /** Tag name (lowercase) */
  tag: string;
  /** Text content (trimmed, first 500 chars) */
  text: string;
  /** Key attributes */
  attributes: Record<string, string>;
  /** Bounding box (if available) */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Whether element is visible (if detectable) */
  visible?: boolean;
}

// ─── Interaction Types ────────────────────────────────────────────────────

export interface ClickOptions {
  /** CSS selector of element to click */
  selector: string;
  /** Click button (default: 'left') */
  button?: 'left' | 'right' | 'middle';
  /** Click count (1=single, 2=double) */
  clickCount?: number;
  /** Delay between mousedown and mouseup in ms */
  delay?: number;
  /** Modifier keys */
  modifiers?: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
  /** Wait for navigation after click (default: false) */
  waitForNavigation?: boolean;
  /** Maximum time to wait for navigation in ms */
  navigationTimeoutMs?: number;
}

export interface TypeOptions {
  /** CSS selector of element to type into */
  selector: string;
  /** Text to type */
  text: string;
  /** Delay between keystrokes in ms (default: 0) */
  delay?: number;
  /** Clear existing text before typing (default: true) */
  clear?: boolean;
}

export interface ScrollOptions {
  /** Scroll direction */
  direction: 'up' | 'down' | 'left' | 'right';
  /** Scroll amount in pixels (default: 300) */
  amount?: number;
  /** CSS selector to scroll within (default: page) */
  selector?: string;
}

export interface HoverOptions {
  /** CSS selector of element to hover */
  selector: string;
  /** Modifier keys */
  modifiers?: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
}

export interface SelectOptions {
  /** CSS selector of <select> element */
  selector: string;
  /** Values to select */
  values: string[];
}

export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Result URL (if navigation occurred) */
  url?: string;
  /** Any error message */
  error?: string;
  /** Time taken in ms */
  durationMs: number;
}

// ─── Wait Types ───────────────────────────────────────────────────────────

export type WaitCondition =
  | { type: 'selector'; selector: string }
  | { type: 'url'; urlPattern: string }
  | { type: 'navigation' }
  | { type: 'timeout'; ms: number }
  | { type: 'text'; text: string; selector?: string }
  | { type: 'networkIdle' }
  | { type: 'visible'; selector: string }
  | { type: 'hidden'; selector: string };

export interface WaitResult {
  /** Whether the condition was met before timeout */
  success: boolean;
  /** Time waited in ms */
  durationMs: number;
  /** Condition type that was evaluated */
  conditionType: WaitCondition['type'];
}

// ─── Authentication Types ─────────────────────────────────────────────────

export interface AuthOptions {
  /** URL of the login page */
  loginUrl: string;
  /** CSS selector for the username/email input */
  usernameSelector: string;
  /** Username or email to enter */
  username: string;
  /** CSS selector for the password input */
  passwordSelector: string;
  /** Password to enter */
  password: string;
  /** CSS selector for the submit button (default: submit-type button) */
  submitSelector?: string;
  /** Selector that confirms login succeeded (e.g., user avatar) */
  successSelector?: string;
  /** Maximum time to wait for login to complete in ms (default: 15000) */
  timeoutMs?: number;
  /** Cookies to set before login */
  cookies?: Record<string, string>;
  /** Additional form fields to fill (selector → value) */
  extraFields?: Record<string, string>;
}

export interface AuthResult {
  /** Whether authentication succeeded */
  success: boolean;
  /** Cookies after authentication */
  cookies: Record<string, string>;
  /** Storage state (localStorage, sessionStorage) serialized as JSON */
  storageState?: string;
  /** URL after authentication */
  finalUrl: string;
  /** Error message if authentication failed */
  error?: string;
  /** Time taken in ms */
  durationMs: number;
}

// ─── Download Types ───────────────────────────────────────────────────────

export interface DownloadOptions {
  /** URL to download from */
  url: string;
  /** Suggested filename (Playwright may override) */
  suggestedFilename?: string;
  /** Directory to save the download to */
  downloadDir?: string;
  /** Maximum time to wait for download in ms (default: 60000) */
  timeoutMs?: number;
}

export interface DownloadResult {
  /** Whether the download succeeded */
  success: boolean;
  /** Path to the downloaded file */
  filePath?: string;
  /** Suggested filename */
  filename?: string;
  /** Size in bytes */
  sizeBytes?: number;
  /** Error message if download failed */
  error?: string;
  /** Time taken in ms */
  durationMs: number;
}

// ─── Network Interception Types ───────────────────────────────────────────

export type NetworkPattern =
  | { type: 'url'; pattern: string }
  | { type: 'resourceType'; resourceType: string }
  | { type: 'method'; method: string };

export type NetworkAction =
  | { type: 'block' }
  | { type: 'mock'; status: number; body?: string; headers?: Record<string, string> }
  | { type: 'modify'; headers?: Record<string, string>; body?: string }
  | { type: 'log' };

export interface NetworkHandler {
  /** Pattern to match requests against */
  pattern: NetworkPattern;
  /** Action to take when a request matches */
  action: NetworkAction;
}

export interface NetworkLogEntry {
  /** Request URL */
  url: string;
  /** HTTP method */
  method: string;
  /** Resource type */
  resourceType: string;
  /** Response status code */
  status?: number;
  /** Request headers */
  requestHeaders?: Record<string, string>;
  /** Response headers */
  responseHeaders?: Record<string, string>;
  /** Timestamp */
  timestamp: number;
  /** Duration in ms */
  durationMs?: number;
}

// ─── Dialog Types ──────────────────────────────────────────────────────────

export type DialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload';

export interface DialogAction {
  /** Action to take: accept, dismiss, or provide input */
  action: 'accept' | 'dismiss';
  /** Text to enter in prompt dialogs (only for 'accept' action on prompt dialogs) */
  inputText?: string;
}

export interface DialogInfo {
  /** Type of dialog */
  type: DialogType;
  /** Dialog message */
  message: string;
  /** Default value for prompt dialogs */
  defaultValue?: string;
}

// ─── Geolocation & Timezone Types ─────────────────────────────────────────

export interface GeolocationOptions {
  /** Latitude (-90 to 90) */
  latitude: number;
  /** Longitude (-180 to 180) */
  longitude: number;
  /** Accuracy in meters (optional) */
  accuracy?: number;
}

// ─── Tab Types ─────────────────────────────────────────────────────────────

export interface TabInfo {
  /** Unique tab identifier */
  tabId: string;
  /** Tab URL */
  url: string;
  /** Tab title */
  title: string;
  /** Whether this tab is active/focused */
  active: boolean;
}

// ─── Drag & Drop Types ─────────────────────────────────────────────────────

export interface DragDropOptions {
  /** CSS selector for the source element */
  fromSelector: string;
  /** CSS selector for the target element */
  toSelector: string;
  /** Delay before releasing in ms (default: 0) */
  delayMs?: number;
}

// ─── File Upload Types ─────────────────────────────────────────────────────

export interface FileUploadOptions {
  /** CSS selector for the file input element */
  selector: string;
  /** Array of file paths to upload */
  files: string[];
}

// ─── Frame Types ───────────────────────────────────────────────────────────

export interface FrameInfo {
  /** Frame name or ID */
  name: string;
  /** Frame URL */
  url: string;
}

// ─── Browser Strategy Interface ───────────────────────────────────────────

/**
 * Strategy interface for browser automation.
 * HTTP strategy works everywhere with zero deps.
 * Playwright strategy provides full browser automation when installed.
 * Agents never know which strategy is active.
 */
export interface IBrowserStrategy {
  /** Strategy name for logging */
  readonly name: string;

  /** Whether this strategy supports JavaScript rendering */
  readonly supportsJS: boolean;

  /** Navigate to a URL */
  goto(url: string, options?: NavigateOptions): Promise<PageState>;

  /** Navigate back */
  back(): Promise<PageState>;

  /** Navigate forward */
  forward(): Promise<PageState>;

  /** Reload current page */
  reload(): Promise<PageState>;

  /** Take a screenshot */
  screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;

  /** Extract content from the page */
  extract(options: ExtractOptions): Promise<ExtractResult>;

  /** Query elements on the page */
  query(options: QueryOptions): Promise<ElementInfo[]>;

  /** Click an element */
  click(options: ClickOptions): Promise<ActionResult>;

  /** Type text into an element */
  type(options: TypeOptions): Promise<ActionResult>;

  /** Scroll the page or an element */
  scroll(options: ScrollOptions): Promise<ActionResult>;

  /** Hover over an element */
  hover(options: HoverOptions): Promise<ActionResult>;

  /** Select options in a <select> element */
  select(options: SelectOptions): Promise<ActionResult>;

  /** Wait for a condition */
  wait(condition: WaitCondition, timeoutMs?: number): Promise<WaitResult>;

  // ─── Advanced Capabilities (Playwright only, HTTP returns REQUIRES_JS) ──

  /** Execute an authentication flow (login) */
  authenticate(options: AuthOptions): Promise<AuthResult>;

  /** Download a file */
  download(url: string, options?: DownloadOptions): Promise<DownloadResult>;

  /** Intercept network requests matching a pattern */
  interceptNetwork(pattern: NetworkPattern, handler: NetworkHandler): Promise<string>;

  /** Remove a network interception */
  clearInterception(interceptionId: string): Promise<void>;

  /** Handle a browser dialog (alert, confirm, prompt) */
  handleDialog(action: DialogAction): Promise<ActionResult>;

  /** Set geolocation for the browser context */
  setGeolocation(options: GeolocationOptions): Promise<ActionResult>;

  /** Set timezone for the browser context */
  setTimezone(timezone: string): Promise<ActionResult>;

  /** Switch to an iframe */
  switchToFrame(selector: string): Promise<ActionResult>;

  /** Switch back to the main frame */
  switchToMainFrame(): Promise<ActionResult>;

  /** List all open tabs/pages */
  listTabs(): Promise<TabInfo[]>;

  /** Switch to a specific tab */
  switchTab(tabId: string): Promise<ActionResult>;

  /** Close a specific tab */
  closeTab(tabId: string): Promise<ActionResult>;

  /** Drag and drop from one element to another */
  dragDrop(options: DragDropOptions): Promise<ActionResult>;

  /** Upload files to a file input element */
  fileUpload(options: FileUploadOptions): Promise<ActionResult>;

  // ─── State ────────────────────────────────────────────────────────────────

  /** Get current page URL */
  currentUrl(): string;

  /** Get current page title */
  currentTitle(): string;

  /** Close the browser/page */
  close(): Promise<void>;
}

// ─── Browser Session Types ─────────────────────────────────────────────────

export interface BrowserSessionConfig {
  /** Maximum idle time before session is recycled (default: 300000ms = 5 min) */
  idleTimeoutMs?: number;
  /** Session workspace ID for isolation */
  workspaceId?: string;
  /** Initial URL to navigate to */
  initialUrl?: string;
  /** Cookie jar for session persistence */
  cookies?: Record<string, string>;
}

export interface BrowserSessionState {
  /** Session ID */
  sessionId: string;
  /** Current URL */
  url: string;
  /** Current page title */
  title: string;
  /** When the session was created */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Number of requests made */
  requestCount: number;
  /** Whether the session is active */
  active: boolean;
}

// ─── Browser Pool Types ───────────────────────────────────────────────────

export interface BrowserPoolConfig {
  /** Maximum concurrent browser sessions (default: 5) */
  maxSessions?: number;
  /** Maximum idle time before session recycling (default: 300000ms) */
  idleTimeoutMs?: number;
  /** Maximum total requests across all sessions (default: 1000) */
  maxTotalRequests?: number;
  /** Strategy to use (auto-detected if not specified) */
  strategyType?: 'http' | 'playwright';
}

// ─── Capability Error Codes ───────────────────────────────────────────────

export const BROWSER_ERRORS = {
  /** The requested action requires a JS-capable strategy (Playwright) */
  REQUIRES_JS: 'BROWSER_REQUIRES_JS',
  /** Navigation failed (timeout, DNS, network error) */
  NAVIGATION_FAILED: 'BROWSER_NAVIGATION_FAILED',
  /** Element not found for the given selector */
  ELEMENT_NOT_FOUND: 'BROWSER_ELEMENT_NOT_FOUND',
  /** Action timed out */
  TIMEOUT: 'BROWSER_TIMEOUT',
  /** Session not found or expired */
  SESSION_EXPIRED: 'BROWSER_SESSION_EXPIRED',
  /** Pool capacity exceeded */
  POOL_FULL: 'BROWSER_POOL_FULL',
  /** Authentication failed */
  AUTH_FAILED: 'BROWSER_AUTH_FAILED',
  /** Download failed */
  DOWNLOAD_FAILED: 'BROWSER_DOWNLOAD_FAILED',
  /** Dialog handling failed */
  DIALOG_FAILED: 'BROWSER_DIALOG_FAILED',
  /** Network interception failed */
  INTERCEPTION_FAILED: 'BROWSER_INTERCEPTION_FAILED',
  /** Interception not found for removal */
  INTERCEPTION_NOT_FOUND: 'BROWSER_INTERCEPTION_NOT_FOUND',
  /** Tab operation failed */
  TAB_FAILED: 'BROWSER_TAB_FAILED',
  /** Tab not found */
  TAB_NOT_FOUND: 'BROWSER_TAB_NOT_FOUND',
  /** Frame operation failed */
  FRAME_FAILED: 'BROWSER_FRAME_FAILED',
  /** Geolocation setting failed */
  GEOLOCATION_FAILED: 'BROWSER_GEOLOCATION_FAILED',
  /** Timezone setting failed */
  TIMEZONE_FAILED: 'BROWSER_TIMEZONE_FAILED',
  /** Drag and drop failed */
  DRAG_DROP_FAILED: 'BROWSER_DRAG_DROP_FAILED',
  /** File upload failed */
  FILE_UPLOAD_FAILED: 'BROWSER_FILE_UPLOAD_FAILED',
} as const;