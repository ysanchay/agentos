/**
 * @agentos/desktop — UIAutomation PowerShell Script Generators
 * Self-contained PowerShell scripts that produce JSON output for each
 * UIAutomation operation. Every script uses -NoProfile -Command conventions
 * and outputs structured JSON that the UIAutomationStrategy can parse.
 */

// ─── Type-safe PowerShell Escape ────────────────────────────────────────────────

function psEscape(str: string): string {
  return str.replace(/'/g, "''").replace(/"/g, '\\"');
}

function psString(str: string): string {
  return `"${psEscape(str)}"`;
}

// ─── Screenshot ─────────────────────────────────────────────────────────────────

export function buildScreenshotPS(options?: { region?: { x: number; y: number; width: number; height: number } }): string {
  if (options?.region) {
    const { x, y, width, height } = options.region;
    return `
      Add-Type -AssemblyName System.Drawing
      Add-Type -AssemblyName System.Windows.Forms
      $bmp = New-Object System.Drawing.Bitmap(${width}, ${height})
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen(${x}, ${y}, 0, 0, [System.Drawing.Size]::new(${width}, ${height}))
      $g.Dispose()
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      [Convert]::ToBase64String($ms.ToArray())
    `.trim();
  }
  return `
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(0, 0, 0, 0, [System.Drawing.Size]::new($screen.Bounds.Width, $screen.Bounds.Height))
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    [Convert]::ToBase64String($ms.ToArray())
  `.trim();
}

// ─── Get Tree ────────────────────────────────────────────────────────────────────

export function buildGetTreePS(options?: { windowId?: string; maxDepth?: number }): string {
  const maxDepth = options?.maxDepth ?? 10;
  const windowFilter = options?.windowId
    ? `$root = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, ${psString(options.windowId)}))`
    : '';

  return `
    Add-Type -AssemblyName UIAutomationClient
    $ErrorActionPreference = 'SilentlyContinue'
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    ${windowFilter}
    if ($null -eq $root) { Write-Output '[]'; exit }

    function Serialize-Element($el, $depth, $maxDepth) {
      if ($depth -gt $maxDepth) { return $null }
      $children = @()
      try {
        $cond = [System.Windows.Automation.Condition]::TrueCondition
        $found = $el.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
        foreach ($c in $found) {
          $child = Serialize-Element $c ($depth + 1) $maxDepth
          if ($null -ne $child) { $children += $child }
        }
      } catch {}

      $bounds = $null
      try {
        $rect = $el.Current.BoundingRectangle
        $bounds = @{ x = [math]::Round($rect.X); y = [math]::Round($rect.Y); width = [math]::Round($rect.Width); height = [math]::Round($rect.Height) }
      } catch { $bounds = $null }

      $value = ''
      try {
        $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $vp) { $value = $vp.Current.Value }
      } catch {}

      return @{
        id = $el.Current.AutomationId
        role = $el.Current.ControlType.ProgrammaticName.Replace('ControlType.', '')
        name = $el.Current.Name
        value = $value
        bounds = $bounds
        visible = $true
        focused = $el.Current.HasKeyboardFocus
        enabled = $el.Current.IsEnabled
        children = $children
      }
    }

    $tree = Serialize-Element $root 0 ${maxDepth}
    $tree | ConvertTo-Json -Depth ${maxDepth + 2} -Compress
  `.trim();
}

// ─── Query ───────────────────────────────────────────────────────────────────────

export function buildQueryPS(options: {
  role?: string;
  name?: string;
  id?: string;
  className?: string;
  limit?: number;
}): string {
  // Build the appropriate condition
  const conditions: string[] = [];
  if (options.id) {
    conditions.push(`[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, ${psString(options.id)})`);
  } else if (options.name) {
    conditions.push(`[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, ${psString(options.name)})`);
  } else if (options.className) {
    conditions.push(`[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, ${psString(options.className)})`);
  } else if (options.role) {
    // Map common role names to ControlType
    const roleMap: Record<string, string> = {
      button: 'Button', checkbox: 'CheckBox', combobox: 'ComboBox',
      edit: 'Edit', hyperlink: 'Hyperlink', image: 'Image',
      list: 'List', listitem: 'ListItem', menu: 'Menu',
      menubar: 'MenuBar', menuitem: 'MenuItem', progressbar: 'ProgressBar',
      radio: 'RadioButton', scrollbar: 'ScrollBar', slider: 'Slider',
      spinbutton: 'Spinner', statusbar: 'StatusBar', tab: 'TabItem',
      tablist: 'Tab', table: 'Table', tree: 'Tree',
      treeitem: 'TreeItem', text: 'Text', toolbar: 'ToolBar',
      tooltip: 'ToolTip', group: 'Group', pane: 'Pane',
      document: 'Document', separator: 'Separator', titlebar: 'TitleBar',
      window: 'Window', dialog: 'Window',
    };
    const ctName = roleMap[options.role.toLowerCase()] ?? options.role;
    conditions.push(`[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::${ctName})`);
  }

  const conditionExpr = conditions.length > 0
    ? conditions[0]
    : '[System.Windows.Automation.Condition]::TrueCondition';

  const limitExpr = options.limit ? `$results | Select-Object -First ${options.limit}` : '$results';

  return `
    Add-Type -AssemblyName UIAutomationClient
    $ErrorActionPreference = 'SilentlyContinue'
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = ${conditionExpr}
    $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    $results = @()
    foreach ($el in $found) {
      $bounds = $null
      try {
        $rect = $el.Current.BoundingRectangle
        $bounds = @{ x = [math]::Round($rect.X); y = [math]::Round($rect.Y); width = [math]::Round($rect.Width); height = [math]::Round($rect.Height) }
      } catch { $bounds = $null }

      $value = ''
      try {
        $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $vp) { $value = $vp.Current.Value }
      } catch {}

      $results += @{
        id = $el.Current.AutomationId
        role = $el.Current.ControlType.ProgrammaticName.Replace('ControlType.', '')
        name = $el.Current.Name
        value = $value
        bounds = $bounds
        visible = $true
        focused = $el.Current.HasKeyboardFocus
        enabled = $el.Current.IsEnabled
      }
    }
    ${limitExpr} | ConvertTo-Json -Compress
  `.trim();
}

// ─── Read ────────────────────────────────────────────────────────────────────────

export function buildReadPS(options: { elementId: string }): string {
  return `
    Add-Type -AssemblyName UIAutomationClient
    $ErrorActionPreference = 'SilentlyContinue'
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, ${psString(options.elementId)})
    $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($null -eq $el) {
      Write-Output '{"error":"element_not_found"}'
      exit
    }

    $value = ''
    try {
      $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if ($null -ne $vp) { $value = $vp.Current.Value }
    } catch {}

    $text = ''
    try {
      $tp = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      if ($null -ne $tp) { $text = $tp.DocumentRange.GetText(-1) }
    } catch {}

    $bounds = $null
    try {
      $rect = $el.Current.BoundingRectangle
      $bounds = @{ x = [math]::Round($rect.X); y = [math]::Round($rect.Y); width = [math]::Round($rect.Width); height = [math]::Round($rect.Height) }
    } catch { $bounds = $null }

    $result = @{
      elementId = $el.Current.AutomationId
      text = if ($text) { $text } else { $el.Current.Name }
      value = $value
      role = $el.Current.ControlType.ProgrammaticName.Replace('ControlType.', '')
      name = $el.Current.Name
      bounds = $bounds
      visible = $true
      focused = $el.Current.HasKeyboardFocus
      enabled = $el.Current.IsEnabled
    }
    $result | ConvertTo-Json -Compress
  `.trim();
}

// ─── Click ────────────────────────────────────────────────────────────────────────

export function buildClickPS(options: { elementId?: string; x?: number; y?: number; button?: string; clickCount?: number }): string {
  if (options.x !== undefined && options.y !== undefined) {
    // Coordinate-based click using mouse_event
    const downFlag = options.button === 'right' ? 0x0008 : 0x0002; // MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN
    const upFlag = options.button === 'right' ? 0x0010 : 0x0004;   // MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP
    const clicks = options.clickCount ?? 1;

    return `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${options.x}, ${options.y})
      Start-Sleep -Milliseconds 50
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Mouse {
        [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);
      }
"@
      ${Array(clicks).fill(null).map(() => `
        [Mouse]::mouse_event(${downFlag}, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 50
        [Mouse]::mouse_event(${upFlag}, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 50
      `.trim()).join('\n        ')}
      "clicked"
    `.trim();
  }

  // Element-based click via InvokePattern
  if (options.elementId) {
    return `
      Add-Type -AssemblyName UIAutomationClient
      $ErrorActionPreference = 'SilentlyContinue'
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $cond = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, ${psString(options.elementId)})
      $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($null -eq $el) {
        Write-Output '{"success":false,"error":"element_not_found"}'
        exit
      }
      try {
        $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $ip.Invoke()
        Write-Output '{"success":true}'
      } catch {
        # Fallback: focus and send Enter
        $el.SetFocus()
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Write-Output '{"success":true,"method":"fallback_enter"}'
      }
    `.trim();
  }

  return '{"success":false,"error":"no_target"}';
}

// ─── Type ─────────────────────────────────────────────────────────────────────────

export function buildTypePS(options: { text: string; elementId?: string; clear?: boolean }): string {
  const focusBlock = options.elementId
    ? `
      $cond = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, ${psString(options.elementId)})
      $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($null -ne $el) { $el.SetFocus() }
      Start-Sleep -Milliseconds 100
    `
    : '';

  const clearBlock = options.clear !== false
    ? `
      try {
        $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $vp) {
          $vp.SetValue("")
        } else {
          [System.Windows.Forms.SendKeys]::SendWait("^a")
          [System.Windows.Forms.SendKeys]::SendWait("{DELETE}")
        }
      } catch {
        [System.Windows.Forms.SendKeys]::SendWait("^a")
        [System.Windows.Forms.SendKeys]::SendWait("{DELETE}")
      }
    `
    : '';

  // Try ValuePattern.SetValue first, then fall back to SendKeys
  const escapedText = options.text.replace(/["{}()+^%~\[\]]/g, '{$&}');

  return `
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName System.Windows.Forms
    $ErrorActionPreference = 'SilentlyContinue'
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    ${focusBlock}
    ${clearBlock}
    try {
      if ($null -ne $el) {
        $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $vp) {
          $vp.SetValue(${psString(options.text)})
          Write-Output '{"success":true,"method":"value_pattern"}'
          exit
        }
      }
    } catch {}
    [System.Windows.Forms.SendKeys]::SendWait("${escapedText}")
    Write-Output '{"success":true,"method":"sendkeys"}'
  `.trim();
}

// ─── Scroll ──────────────────────────────────────────────────────────────────────

export function buildScrollPS(options: { direction: string; amount?: number; elementId?: string }): string {
  const amount = options.amount ?? 3; // Number of scroll clicks
  const scrollDir = options.direction === 'up' ? 'NoAmount'
    : options.direction === 'down' ? 'LargeIncrement'
    : options.direction === 'left' ? 'NoAmount'
    : 'LargeIncrement';

  // Map direction to ScrollPattern constants
  const scrollMethod = options.direction === 'up'
    ? 'ScrollVerticalByAmount'
    : options.direction === 'down'
      ? 'ScrollVerticalByAmount'
      : options.direction === 'left'
        ? 'ScrollHorizontalByAmount'
        : 'ScrollHorizontalByAmount';

  const scrollUnit = (options.direction === 'up' || options.direction === 'down')
    ? 'VerticalNoAmount' // fallback to SendKeys if no pattern
    : 'HorizontalNoAmount';

  if (options.elementId) {
    return `
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName System.Windows.Forms
      $ErrorActionPreference = 'SilentlyContinue'
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $cond = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, ${psString(options.elementId)})
      $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($null -ne $el) {
        try {
          $sp = $el.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
          if ($null -ne $sp) {
            ${options.direction === 'down' ? `$sp.ScrollVertical([System.Windows.Automation.ScrollAmount]::LargeIncrement)` : ''}
            ${options.direction === 'up' ? `$sp.ScrollVertical([System.Windows.Automation.ScrollAmount]::LargeDecrement)` : ''}
            ${options.direction === 'right' ? `$sp.ScrollHorizontal([System.Windows.Automation.ScrollAmount]::LargeIncrement)` : ''}
            ${options.direction === 'left' ? `$sp.ScrollHorizontal([System.Windows.Automation.ScrollAmount]::LargeDecrement)` : ''}
            Write-Output '{"success":true,"method":"scroll_pattern"}'
            exit
          }
        } catch {}
      }
      # Fallback: keyboard scroll
      $key = '${options.direction === 'up' ? '{PGUP}' : options.direction === 'down' ? '{PGDN}' : options.direction === 'left' ? '{LEFT}' : '{RIGHT}'}'
      ${Array(amount).fill(null).map(() => `[System.Windows.Forms.SendKeys]::SendWait("${options.direction === 'up' ? '{PGUP}' : options.direction === 'down' ? '{PGDN}' : options.direction === 'left' ? '{LEFT}' : '{RIGHT}'}")`).join('\n      ')}
      Write-Output '{"success":true,"method":"sendkeys"}'
    `.trim();
  }

  // No element: use keyboard fallback
  const key = options.direction === 'up' ? '{PGUP}' : options.direction === 'down' ? '{PGDN}' : options.direction === 'left' ? '{LEFT}' : '{RIGHT}';
  return `
    Add-Type -AssemblyName System.Windows.Forms
    ${Array(amount).fill(null).map(() => `[System.Windows.Forms.SendKeys]::SendWait("${key}")`).join('\n    ')}
    "scrolled"
  `.trim();
}

// ─── Launch App ──────────────────────────────────────────────────────────────────

export function buildLaunchAppPS(options: { app: string; args?: string[]; waitForReady?: boolean }): string {
  const argsStr = options.args ? ` -ArgumentList ${options.args.map(a => `"${psEscape(a)}"`).join(',')}` : '';
  return `
    Start-Process "${psEscape(options.app)}"${argsStr}
    ${options.waitForReady ? 'Start-Sleep -Milliseconds 5000' : 'Start-Sleep -Milliseconds 500'}
    "launched"
  `.trim();
}

// ─── Focus ────────────────────────────────────────────────────────────────────────

export function buildFocusPS(options: { elementId?: string; appName?: string }): string {
  if (options.elementId) {
    return `
      Add-Type -AssemblyName UIAutomationClient
      $ErrorActionPreference = 'SilentlyContinue'
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $cond = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, ${psString(options.elementId)})
      $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($null -ne $el) {
        $el.SetFocus()
        Write-Output '{"success":true}'
      } else {
        Write-Output '{"success":false,"error":"element_not_found"}'
      }
    `.trim();
  }

  if (options.appName) {
    return `
      $shell = New-Object -ComObject WScript.Shell
      $result = $shell.AppActivate(${psString(options.appName)})
      Start-Sleep -Milliseconds 200
      if ($result) { Write-Output '{"success":true}' } else { Write-Output '{"success":false,"error":"app_not_found"}' }
    `.trim();
  }

  return '{"success":false,"error":"no_target"}';
}

// ─── Press Key ───────────────────────────────────────────────────────────────────

export function buildPressKeyPS(options: { key: string; modifiers?: string[]; count?: number }): string {
  const keyMap: Record<string, string> = {
    enter: '{ENTER}',
    tab: '{TAB}',
    escape: '{ESC}',
    backspace: '{BACKSPACE}',
    delete: '{DELETE}',
    up: '{UP}',
    down: '{DOWN}',
    left: '{LEFT}',
    right: '{RIGHT}',
    home: '{HOME}',
    end: '{END}',
    pageup: '{PGUP}',
    pagedown: '{PGDN}',
    space: ' ',
    f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}',
    f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}',
    f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
  };

  let sendKey = keyMap[options.key.toLowerCase()] ?? options.key;

  if (options.modifiers?.length) {
    const modMap: Record<string, string> = {
      ctrl: '^', alt: '%', shift: '+', meta: '^',
    };
    const modPrefix = options.modifiers.map(m => modMap[m.toLowerCase()] ?? '').join('');
    sendKey = `${modPrefix}${sendKey}`;
  }

  const count = options.count ?? 1;
  return `
    Add-Type -AssemblyName System.Windows.Forms
    ${Array(count).fill(null).map(() => `[System.Windows.Forms.SendKeys]::SendWait("${sendKey}")`).join('\n    ')}
    "key_pressed"
  `.trim();
}

// ─── List Windows ────────────────────────────────────────────────────────────────

export function buildListWindowsPS(): string {
  return `
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName System.Windows.Forms
    $ErrorActionPreference = 'SilentlyContinue'
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = [System.Windows.Automation.Condition]::TrueCondition
    $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    $results = @()
    $fgHandle = [System.Windows.Forms.NativeWindow]::new()
    try {
      $asm = [System.Windows.Forms.Assembly].Assembly
    } catch {}

    foreach ($c in $children) {
      $bounds = $null
      try {
        $rect = $c.Current.BoundingRectangle
        $bounds = @{ x = [math]::Round($rect.X); y = [math]::Round($rect.Y); width = [math]::Round($rect.Width); height = [math]::Round($rect.Height) }
      } catch { $bounds = $null }

      $results += @{
        title = $c.Current.Name
        appName = $c.Current.ProcessId.ToString()
        pid = $c.Current.ProcessId
        windowId = $c.Current.AutomationId
        bounds = $bounds
        focused = $c.Current.HasKeyboardFocus
      }
    }
    $results | ConvertTo-Json -Compress
  `.trim();
}

// ─── UIAutomation Availability Detection ──────────────────────────────────────────

export function buildUIAutomationAvailablePS(): string {
  return `
    try {
      Add-Type -AssemblyName UIAutomationClient
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      if ($null -ne $root) {
        Write-Output '{"available":true}'
      } else {
        Write-Output '{"available":false}'
      }
    } catch {
      Write-Output '{"available":false}'
    }
  `.trim();
}