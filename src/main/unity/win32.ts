import path from 'node:path';
import { app } from 'electron';

declare const __non_webpack_require__: NodeRequire | undefined;

const koffi: typeof import('koffi') = (() => {
  if (app.isPackaged) {
    const koffiPath = path.join(process.resourcesPath, 'koffi');
    console.log(`[Unity/win32] loading koffi from ${koffiPath}`);
    const realRequire = typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require;
    const k = realRequire(koffiPath);
    console.log(`[Unity/win32] koffi loaded, version=${k.version ?? 'unknown'}`);
    return k;
  }
  console.log(`[Unity/win32] loading koffi from bundled node_modules (dev mode)`);
  return require('koffi');
})();

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

koffi.alias('HWND', 'void *');
const EnumProc = koffi.proto('int __stdcall EnumWindowsProc(void *hwnd, intptr_t lParam)');

const SetParent = user32.func('void * __stdcall SetParent(void *hWndChild, void *hWndNewParent)');
const MoveWindow = user32.func('int __stdcall MoveWindow(void *hWnd, int X, int Y, int nWidth, int nHeight, int bRepaint)');
const ShowWindow = user32.func('int __stdcall ShowWindow(void *hWnd, int nCmdShow)');
const IsWindow = user32.func('int __stdcall IsWindow(void *hWnd)');
const PostMessageW = user32.func('int __stdcall PostMessageW(void *hWnd, uint32 Msg, uintptr_t wParam, intptr_t lParam)');
const SetWindowPos = user32.func('int __stdcall SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)');
const SetWindowLongPtrW = user32.func('intptr_t __stdcall SetWindowLongPtrW(void *hWnd, int nIndex, intptr_t dwNewLong)');
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)');
const SetFocus = user32.func('void * __stdcall SetFocus(void *hWnd)');
const AttachThreadInput = user32.func('int __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, int fAttach)');
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(void *hWnd, _Out_ char16_t *lpClassName, int nMaxCount)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)');
const EnumChildWindows = user32.func('int __stdcall EnumChildWindows(void *hWndParent, EnumWindowsProc *lpEnumFunc, intptr_t lParam)');
const EnumWindowsFn = user32.func('int __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, intptr_t lParam)');

const GWL_STYLE = -16;
const WS_CHILD = 0x40000000 >>> 0;
const WS_POPUP = 0x80000000 >>> 0;
const WS_VISIBLE = 0x10000000;
const WS_CAPTION = 0x00C00000;
const WS_THICKFRAME = 0x00040000;
const SWP_FRAMECHANGED = 0x0020;
const SWP_NOMOVE = 0x0002;
const SWP_NOSIZE = 0x0001;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const HWND_TOP = 0n;
const SW_HIDE = 0;
const SW_SHOW = 5;
const WM_CLOSE = 0x0010;

const UNITY_CLASS_NAME = 'UnityWndClass';

export function hwndFromBuffer(buf: Buffer): bigint {
  if (buf.length !== 8) {
    throw new Error(`Expected 8-byte HWND buffer (Electron x64), got ${buf.length} bytes.`);
  }
  return buf.readBigUInt64LE(0);
}

function readClassName(hwnd: unknown): string {
  const buf = Buffer.alloc(128 * 2);
  const len = GetClassNameW(hwnd as any, buf, 128);
  if (len <= 0) return '';
  return buf.toString('utf16le', 0, len * 2);
}

function readPid(hwnd: unknown): number {
  const pidBuf = Buffer.alloc(4);
  GetWindowThreadProcessId(hwnd as any, pidBuf);
  return pidBuf.readUInt32LE(0);
}

function toAddress(handle: unknown): bigint {
  if (typeof handle === 'bigint') return handle;
  if (typeof handle === 'number') return BigInt(handle);
  try { return koffi.address(handle as any); } catch { return 0n; }
}

interface FindOptions {
  parentHwnd: bigint;
  pid: number;
  className?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export async function findUnityChildHwnd(opts: FindOptions): Promise<bigint | null> {
  const { parentHwnd, pid } = opts;
  const className = opts.className ?? UNITY_CLASS_NAME;
  const deadline = Date.now() + (opts.timeoutMs ?? 1500);
  const intervalMs = opts.pollIntervalMs ?? 50;

  while (Date.now() < deadline) {
    const found = enumOnce(parentHwnd, pid, className);
    if (found != null) return found;
    await sleep(intervalMs);
  }
  return null;
}

export function findUnityTopLevelHwnd(pid: number, className: string = UNITY_CLASS_NAME): bigint | null {
  let matched: bigint | null = null;
  const cb = koffi.register((hwnd: unknown) => {
    if (readPid(hwnd) !== pid) return 1;
    if (readClassName(hwnd) !== className) return 1;
    matched = toAddress(hwnd);
    return 0;
  }, koffi.pointer(EnumProc));
  try {
    EnumWindowsFn(cb as any, 0n);
  } finally {
    koffi.unregister(cb);
  }
  return matched;
}

function enumOnce(parentHwnd: bigint, pid: number, className: string): bigint | null {
  let matched: bigint | null = null;
  const cb = koffi.register((hwnd: unknown) => {
    if (readPid(hwnd) !== pid) return 1;
    if (readClassName(hwnd) !== className) return 1;
    matched = toAddress(hwnd);
    return 0;
  }, koffi.pointer(EnumProc));
  try {
    EnumChildWindows(parentHwnd as any, cb as any, 0n);
  } finally {
    koffi.unregister(cb);
  }
  return matched;
}

export function reparentAndStyleFixup(unityHwnd: bigint, parentHwnd: bigint): void {
  SetParent(unityHwnd as any, parentHwnd as any);
  const current = GetWindowLongPtrW(unityHwnd as any, GWL_STYLE);
  const cleared = (BigInt(current) & ~(BigInt(WS_POPUP) | BigInt(WS_CAPTION) | BigInt(WS_THICKFRAME)));
  const next = cleared | BigInt(WS_CHILD) | BigInt(WS_VISIBLE);
  SetWindowLongPtrW(unityHwnd as any, GWL_STYLE, next);
  SetWindowPos(unityHwnd as any, HWND_TOP as any, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

export function moveUnityWindow(unityHwnd: bigint, x: number, y: number, w: number, h: number): void {
  SetWindowPos(
    unityHwnd as any,
    HWND_TOP as any,
    Math.round(x), Math.round(y), Math.round(w), Math.round(h),
    SWP_NOACTIVATE,
  );
}

export function focusUnity(unityHwnd: bigint): void {
  const pidBuf = Buffer.alloc(4);
  const unityThreadId = GetWindowThreadProcessId(unityHwnd as any, pidBuf);
  if (!unityThreadId) return;
  const ourThreadId = GetCurrentThreadId();
  AttachThreadInput(ourThreadId, unityThreadId, 1);
  try {
    SetFocus(unityHwnd as any);
  } finally {
    AttachThreadInput(ourThreadId, unityThreadId, 0);
  }
}

export function showUnityWindow(unityHwnd: bigint, visible: boolean): void {
  ShowWindow(unityHwnd as any, visible ? SW_SHOW : SW_HIDE);
}

export function postCloseToUnity(unityHwnd: bigint): void {
  PostMessageW(unityHwnd as any, WM_CLOSE, 0n, 0n);
}

export function isStillWindow(unityHwnd: bigint): boolean {
  return IsWindow(unityHwnd as any) !== 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
