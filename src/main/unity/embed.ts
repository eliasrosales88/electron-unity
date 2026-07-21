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
  leftInsetDip = 0
): void {
  if (!isStillWindow(unityHwnd)) return;
  const bounds = window.getContentBounds();
  const display = screen.getDisplayMatching(bounds);
  const sf = display.scaleFactor || 1;
  // Reserve a strip on the left for the docked side panel (DIP -> physical px)
  // so the Unity child HWND and the overlay never overlap.
  const inset = Math.min(Math.max(0, Math.round(leftInsetDip)), Math.max(0, bounds.width - 1));
  const insetPx = Math.round(inset * sf);

  // SetWindowPos places a child relative to the parent's Win32 client area,
  // which on Windows *includes* the application menu bar — while Electron's
  // content bounds exclude it. Anchoring at y=0 therefore painted Unity over
  // the menu. Measure the gap between the two origins and offset by it.
  const contentPx = screen.dipToScreenRect(window, bounds);
  const clientOrigin = getClientOriginScreen(hwndFromBuffer(window.getNativeWindowHandle()));
  const offsetX = contentPx.x - clientOrigin.x;
  const offsetY = contentPx.y - clientOrigin.y;

  const x = offsetX + insetPx;
  const y = offsetY;
  const width = Math.max(1, contentPx.width - insetPx);
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
