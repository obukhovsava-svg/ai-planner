/**
 * Bridge to the native iOS app (ios/Planner). The app hosts this same web UI in a WKWebView,
 * injects `window.PlannerNative` before the page loads and handles messages posted to
 * `webkit.messageHandlers.native`. In Telegram and in a browser none of this exists and
 * every call is a no-op.
 */

interface NativeInfo {
  platform: 'ios';
  /** Random secret created on first launch and kept in the Keychain: the account, no sign-up. */
  deviceKey: string;
  version: string;
}

type NativeMessage =
  | { type: 'haptic'; kind: 'impact' | 'notify' | 'selection'; style?: string }
  | { type: 'open'; url: string }
  | { type: 'reminders'; items: { id: string; at: number; title: string; body: string; open: string }[] }
  | { type: 'speech'; action: 'start' | 'stop' | 'cancel' }
  | { type: 'widget'; snapshot: WidgetSnapshot };

/** What the home-screen widget shows: the next week, day by day (the widget can't run this code). */
export interface WidgetSnapshot {
  days: {
    date: string;
    events: { title: string; start: string; end: string; color: string }[];
    tasks: { title: string; time?: string; done: boolean }[];
  }[];
  /** Undone tasks from earlier days. */
  overdue: number;
  /** The same overdue tasks, oldest first, and undone tasks without a date (newest first). */
  late: { title: string; date: string }[];
  inbox: { title: string }[];
}

declare global {
  interface Window {
    PlannerNative?: NativeInfo;
    webkit?: { messageHandlers?: { native?: { postMessage(msg: unknown): void } } };
    /** Called by the app: a notification was tapped (deep-link target, see deeplink.ts). */
    __plannerOpen?: (target: string) => void;
    /** Called by the app with speech-recognition updates. */
    __plannerSpeech?: (e: NativeSpeechEvent) => void;
  }
}

export type NativeSpeechEvent =
  | { type: 'interim'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
  | { type: 'end' };

export const isNative = (): boolean => Boolean(window.PlannerNative && window.webkit?.messageHandlers?.native);

export const nativeDeviceKey = (): string => window.PlannerNative?.deviceKey ?? '';

export function postNative(msg: NativeMessage) {
  try {
    window.webkit?.messageHandlers?.native?.postMessage(msg);
  } catch {
    /* not in the app */
  }
}
