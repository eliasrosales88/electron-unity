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

export function resizeUnityToWindow(window: BrowserWindow, unityHwnd: bigint): void {
  if (!isStillWindow(unityHwnd)) return;
  const bounds = window.getContentBounds();
  const display = screen.getDisplayMatching(bounds);
  const sf = display.scaleFactor || 1;
  const width = Math.max(1, Math.round(bounds.width * sf));
  const height = Math.max(1, Math.round(bounds.height * sf));
  moveUnityWindow(unityHwnd, 0, 0, width, height);
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
