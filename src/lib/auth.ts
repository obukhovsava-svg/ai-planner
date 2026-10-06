/**
 * Who the server talks to. In Telegram: the signed launch data (initData). In the iOS app:
 * the device key from the Keychain — no sign-up, the device itself is the account.
 */
import { AI_URL } from '@/config';
import { getInitData } from './telegram';
import { nativeDeviceKey } from './native';

export function authHeaders(): Record<string, string> {
  const initData = getInitData();
  if (initData) return { 'X-Telegram-Init-Data': initData };
  const key = nativeDeviceKey();
  return key ? { 'X-Device-Key': key } : {};
}

/** The server can be used (AI, sync, the iPhone Shortcut, feedback). */
export const hasServerAuth = (): boolean => Boolean(AI_URL && (getInitData() || nativeDeviceKey()));
