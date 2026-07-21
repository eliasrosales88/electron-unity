import { BrowserWindow, screen } from 'electron';
import {
  findUnityChildHwnd,
  findUnityTopLevelHwnd,
  reparentAndStyleFixup,
  moveUnityWindow,
  showUnityWindow,
  postCloseToUnity,
  isStillWindow,
  focusUnity,
  getClientOriginScreen,
  hwndFromBuffer,
} from './win32';

export interface EmbedHandles {
  unityHwnd: bigint;
  parentHwnd: bigint;
}

/** Strips (in DIP) reserved at the window edges by panels in 'push' mode. */
export interface UnityInsets {
  left: number;
  right: number;
}

export async function attachUnityToWindow(
  parentHwnd: bigint,
  unityPid: number
): Promise<EmbedHandles> {
  let unityHwnd = await findUnityChildHwnd({ parentHwnd, pid: unityPid, timeoutMs: 1500 });

  if (unityHwnd == null) {
    unityHwnd = findUnityTopLevelHwnd(unityPid);
    if (unityHwnd == null) {
      throw new Error(
        `Could not find Unity window for pid=${unityPid} after handshake. ` +
        `Check that the build uses class "UnityWndClass" and that -parentHWND was honored.`
      );
    }
    reparentAndStyleFixup(unityHwnd, parentHwnd);
  } else {
    reparentAndStyleFixup(unityHwnd, parentHwnd);
  }

  return { unityHwnd, parentHwnd };
}

export function resizeUnityToWindow(
  window: BrowserWindow,
  unityHwnd: bigint,
  insetsDip: UnityInsets = { left: 0, right: 0 }
): void {
  if (!isStillWindow(unityHwnd)) return;
  // A minimized window reports a zero-sized content area. Laying Unity out
  // against that would shrink its HWND to 1x1, and since nothing re-runs this
  // on restore, the scene would stay invisible for the rest of the session.
  if (window.isMinimized()) return;
  const bounds = window.getContentBounds();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const display = screen.getDisplayMatching(bounds);
  const sf = display.scaleFactor || 1;
  // Reserve strips at the edges for docked side panels (DIP -> physical px) so
  // the Unity child HWND and those panels never overlap. Both insets together
  // are capped so Unity always keeps at least 1 DIP of width.
  const wanted = Math.max(0, Math.round(insetsDip.left)) + Math.max(0, Math.round(insetsDip.right));
  const budget = Math.max(0, bounds.width - 1);
  const scale = wanted > budget && wanted > 0 ? budget / wanted : 1;
  const leftInset = Math.round(Math.max(0, insetsDip.left) * scale);
  const rightInset = Math.round(Math.max(0, insetsDip.right) * scale);
  const leftPx = Math.round(leftInset * sf);
  const rightPx = Math.round(rightInset * sf);

  // SetWindowPos places a child relative to the parent's Win32 client area,
  // which on Windows *includes* the application menu bar — while Electron's
  // content bounds exclude it. Anchoring at y=0 therefore painted Unity over
  // the menu. Measure the gap between the two origins and offset by it.
  const contentPx = screen.dipToScreenRect(window, bounds);
  const clientOrigin = getClientOriginScreen(hwndFromBuffer(window.getNativeWindowHandle()));
  const offsetX = contentPx.x - clientOrigin.x;
  const offsetY = contentPx.y - clientOrigin.y;

  const x = offsetX + leftPx;
  const y = offsetY;
  const width = Math.max(1, contentPx.width - leftPx - rightPx);
  const height = Math.max(1, contentPx.height);
  moveUnityWindow(unityHwnd, x, y, width, height);
  focusUnity(unityHwnd);
}

export function hideUnity(unityHwnd: bigint): void {
  if (isStillWindow(unityHwnd)) showUnityWindow(unityHwnd, false);
}

export function showUnity(unityHwnd: bigint): void {
  if (isStillWindow(unityHwnd)) showUnityWindow(unityHwnd, true);
}

export function requestUnityClose(unityHwnd: bigint): void {
  if (isStillWindow(unityHwnd)) postCloseToUnity(unityHwnd);
}
