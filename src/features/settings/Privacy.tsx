import { useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { AI_URL } from '@/config';
import { useAiConsent } from '@/lib/aiConsent';
import { authHeaders, hasServerAuth } from '@/lib/auth';
import { isNative } from '@/lib/native';
import { haptic, openExternal } from '@/lib/telegram';
import { usePlannerStore } from '@/store/usePlannerStore';
import { useChatStore } from '@/store/useChatStore';

export const PRIVACY_URL = 'https://obukhovsava-svg.github.io/ai-planner/privacy.html';

/** What the assistant sends and to whom — shown before the first request and under the setting. */
export const AI_DISCLOSURE =
  'Чтобы понять фразу, ассистент отправляет её текст на сервер ПЛАН, где его разбирают нейросети Cloudflare Workers AI и OpenAI. Текст используется только для разбора и не идёт в рекламу. Без разрешения фразы разбирает сам планер, на устройстве: проще, но тоже работает.';

/** Asked once in the app, before the assistant's first request to the server. */
export function AiConsentSheet() {
  const pending = useAiConsent((s) => s.pending);
  const set = useAiConsent((s) => s.set);
  return (
    <Sheet open={Boolean(pending)} title="AI-ассистент" onClose={() => set(false)}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="px-1 text-[15px] leading-snug">{AI_DISCLOSURE}</p>
        <button type="button" onClick={() => openExternal(PRIVACY_URL)} className="px-1 text-left text-[15px] text-blue">
          Политика конфиденциальности
        </button>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              haptic.notify('success');
              set(true);
            }}
            className="h-[50px] rounded-full bg-blue text-[17px] font-semibold text-white transition-transform duration-300 ease-spring active:scale-[0.97]"
          >
            Разрешить
          </button>
          <button type="button" onClick={() => set(false)} className="h-[50px] rounded-full text-[17px] font-semibold text-blue">
            Не сейчас
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Everything goes: the server copy (all devices of this account), then this device. */
async function deleteEverything(): Promise<boolean> {
  if (hasServerAuth()) {
    try {
      const res = await fetch(`${AI_URL.replace(/\/$/, '')}/account/delete`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) return false;
    } catch {
      return false;
    }
  }
  usePlannerStore.setState({ tasks: [], events: [], deleted: {} });
  useChatStore.persist?.clearStorage();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('planner:')) localStorage.removeItem(k);
    indexedDB.deleteDatabase('planner'); // the wallpaper photo
  } catch {
    /* nothing more to clear */
  }
  if (isNative()) {
    // no reminders or widget content left behind
    window.webkit?.messageHandlers?.native?.postMessage({ type: 'reminders', items: [] });
    window.webkit?.messageHandlers?.native?.postMessage({ type: 'aiConsent', on: false });
  }
  return true;
}

export function DeleteDataSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  return (
    <Sheet open={open} title="Удалить мои данные" onClose={onClose}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="px-1 text-[15px] leading-snug">
          Удалятся все события, задачи, заметки, переписка с ассистентом, обои и настройки — на сервере и на всех ваших устройствах. Восстановить их будет нельзя.
        </p>
        {state === 'error' && <p className="px-1 text-[15px] text-red">Не получилось связаться с сервером. Проверьте интернет и попробуйте ещё раз.</p>}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={state === 'busy'}
            onClick={async () => {
              setState('busy');
              haptic.impact('heavy');
              if (await deleteEverything()) window.location.reload();
              else setState('error');
            }}
            className="h-[50px] rounded-full bg-red text-[17px] font-semibold text-white transition-[transform,opacity] duration-300 ease-spring active:scale-[0.97] disabled:opacity-50"
          >
            {state === 'busy' ? 'Удаляю…' : 'Удалить всё'}
          </button>
          <button type="button" onClick={onClose} className="h-[50px] rounded-full text-[17px] font-semibold text-blue">
            Отмена
          </button>
        </div>
      </div>
    </Sheet>
  );
}
