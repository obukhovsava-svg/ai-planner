/**
 * Consent to AI processing (App Review 5.1.2: say what is sent and to whom, and ask first).
 * Only the iOS / Mac app asks: there the assistant's requests are the only thing that leaves the
 * device for a third party. Until the user agrees, the planner's own rules understand phrases
 * offline; a «no» is remembered and can be changed in Settings → «AI-ассистент».
 */
import { create } from 'zustand';
import { isNative, postNative } from './native';

const KEY = 'planner:ai-consent';

function read(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'yes' ? true : v === 'no' ? false : null;
  } catch {
    return null;
  }
}

interface ConsentState {
  consent: boolean | null;
  /** A question waiting for the sheet's answer. */
  pending: ((ok: boolean) => void) | null;
  set(on: boolean): void;
}

export const useAiConsent = create<ConsentState>((setState, get) => ({
  consent: read(),
  pending: null,
  set(on) {
    try {
      localStorage.setItem(KEY, on ? 'yes' : 'no');
    } catch {
      /* private mode: asked again next launch */
    }
    if (isNative()) postNative({ type: 'aiConsent', on });
    get().pending?.(on);
    setState({ consent: on, pending: null });
  },
}));

// Siri's «Добавить в ПЛАН» reads the answer from the app group: keep it in step on every launch.
if (isNative()) {
  const c = read();
  if (c !== null) postNative({ type: 'aiConsent', on: c });
}

/** True when the assistant may send text to the server; asks once in the app. */
export async function ensureAiConsent(): Promise<boolean> {
  if (!isNative()) return true;
  const { consent, pending } = useAiConsent.getState();
  if (consent !== null) return consent;
  if (pending) return false; // already on screen
  return new Promise<boolean>((resolve) => useAiConsent.setState({ pending: resolve }));
}
