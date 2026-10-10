import { useEffect, useState } from 'react';
import { Check, Copy, Download, RefreshCw } from 'lucide-react';
import { Sheet } from '@/components/Sheet';
import { getShortcutLink } from '@/lib/shortcut';
import { haptic, openExternal } from '@/lib/telegram';
import { hasServerAuth } from '@/lib/auth';
import { isNative } from '@/lib/native';
import { SHORTCUT_LINKS } from '@/lib/shortcutLinks';

/** The signed Shortcut file, served next to the app; Safari hands it to «Команды». */
// In the iOS app the page is served from the app bundle, so point Safari at the published copy.
const FILE_URL = isNative() ? 'https://obukhovsava-svg.github.io/ai-planner/planner.shortcut' : new URL('planner.shortcut', location.href).href;

/** Home-screen voice button: copy your personal link → install the ready-made Shortcut. */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const inTelegram = hasServerAuth();

  const load = async (reset = false) => {
    setLoading(true);
    const r = await getShortcutLink(reset);
    setLink(r?.url ?? null);
    setLoading(false);
    setCopied(false);
  };

  useEffect(() => {
    if (open && inTelegram && !link) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Older WebViews: select the text so the user can copy it manually.
      const el = document.getElementById('shortcut-link') as HTMLInputElement | null;
      el?.select();
      document.execCommand?.('copy');
    }
    haptic.notify('success');
    setCopied(true);
  };

  return (
    <Sheet open={open} title="Кнопка на iPhone" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="px-1 text-[15px] leading-snug text-muted">
          Нажали кнопку на экране «Домой» → продиктовали → ассистент всё записал, а бот прислал «Готово ✅». Работает, даже когда планер закрыт.
        </p>

        {isNative() ? (
          // iOS app: «Добавить в ПЛАН» is built in — Siri and the Action button work right away;
          // the ready-made Shortcut adds a Home Screen icon in one tap.
          <>
            <div className="rounded-[16px] bg-surface px-4 py-3.5 text-[15px] leading-snug">
              Уже работает: скажите <b>«Привет, Siri, добавь в Планер»</b> или назначьте Кнопке действия: Настройки → Кнопка действия → Команда →
              «Планер: Добавить в план».
            </div>
            <button
              type="button"
              onClick={() => {
                haptic.impact('medium');
                openExternal(SHORTCUT_LINKS.voice || 'shortcuts://');
              }}
              className="flex h-[50px] items-center justify-center gap-2 rounded-[14px] bg-blue text-[17px] font-semibold text-white active:opacity-80"
            >
              <Download className="size-4" strokeWidth={2.4} /> Добавить кнопку на экран «Домой»
            </button>
            <p className="px-1 text-[13px] leading-snug text-muted">
              {SHORTCUT_LINKS.voice
                ? 'Откроются «Команды» → «Добавить команду». Потом удерживайте её → «Поделиться» → «На экран „Домой“».'
                : 'В «Командах»: «+» → действие «Добавить в ПЛАН» → «Поделиться» → «На экран „Домой“».'}
            </p>
          </>
        ) : !inTelegram ? (
          <p className="rounded-[16px] bg-surface px-4 py-3.5 text-[15px]">Откройте планер в Telegram, чтобы получить личную ссылку.</p>
        ) : (
          <>
            {/* Step 1 — copy the personal link */}
            <div className="overflow-hidden rounded-[16px] bg-surface">
              <div className="flex items-center gap-3 px-4 pt-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-blue text-[13px] font-semibold text-white">1</span>
                <p className="text-[16px] font-semibold">Скопируйте вашу ссылку</p>
              </div>
              <input
                id="shortcut-link"
                readOnly
                value={loading ? 'Загружаю…' : (link ?? 'Не удалось получить ссылку — попробуйте ещё раз')}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full truncate bg-transparent px-4 pb-3 pl-[52px] pt-1 font-mono text-[12px] text-muted outline-none"
              />
              <button
                type="button"
                disabled={!link}
                onClick={copy}
                className={`flex w-full items-center justify-center gap-1.5 border-t-[0.5px] border-line py-3 text-[16px] font-semibold transition-colors active:bg-surface-2 disabled:opacity-40 ${
                  copied ? 'text-green' : 'text-blue'
                }`}
              >
                {copied ? <Check className="size-4" strokeWidth={2.6} /> : <Copy className="size-4" />}
                {copied ? 'Скопировано' : 'Скопировать ссылку'}
              </button>
            </div>

            {/* Step 2 — install the ready-made Shortcut */}
            <div className="overflow-hidden rounded-[16px] bg-surface">
              <div className="flex items-start gap-3 px-4 py-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-blue text-[13px] font-semibold text-white">2</span>
                <div>
                  <p className="text-[16px] font-semibold">Установите команду</p>
                  <p className="mt-0.5 text-[14px] leading-snug text-muted">
                    Откроются «Команды» → вставьте скопированную ссылку → «Добавить команду».
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  haptic.impact('medium');
                  openExternal(SHORTCUT_LINKS.voiceTelegram || FILE_URL);
                }}
                className="flex w-full items-center justify-center gap-1.5 border-t-[0.5px] border-line bg-blue py-3 text-[16px] font-semibold text-white transition-opacity active:opacity-80"
              >
                <Download className="size-4" strokeWidth={2.4} /> Установить команду «Планер»
              </button>
            </div>

            <p className="px-1 text-[13px] leading-snug text-muted">
              Кнопка на экране «Домой»: в «Командах» удерживайте «Планер» → «Поделиться» → «На экран „Домой“». На экран блокировки и в Пункт
              управления (iOS 18): «Настроить» → «Быстрые команды» → «Планер». Также работает «Привет, Siri, Планер» и Кнопка действия.
            </p>

            <button type="button" onClick={() => load(true)} className="flex items-center justify-center gap-1.5 py-1 text-[14px] text-red active:opacity-60">
              <RefreshCw className="size-3.5" /> Сбросить ссылку (старая перестанет работать)
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
