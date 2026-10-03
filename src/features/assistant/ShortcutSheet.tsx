import { useEffect, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { Sheet } from '@/components/Sheet';
import { getShortcutLink } from '@/lib/shortcut';
import { haptic, isInTelegram } from '@/lib/telegram';

const STEPS: [string, string][] = [
  ['Откройте «Команды»', 'Нажмите «+», чтобы создать новую команду.'],
  ['«Диктовать текст»', 'Найдите это действие и добавьте. Язык — Русский, «Прекратить слушать» — «После паузы».'],
  [
    '«Получить содержимое URL»',
    'Вставьте ссылку выше в поле URL. Нажмите «Показать больше»: Метод — POST, Текст запроса — JSON, добавьте поле: ключ text, значение — переменная «Продиктованный текст».',
  ],
  ['«Показать уведомление»', 'Добавьте и выберите переменную «Содержимое URL» — увидите ответ ассистента.'],
  ['На экран «Домой»', 'Назовите команду «Планер», нажмите на название → «На экран „Домой“». Работает и «Привет, Siri, Планер», и Кнопка действия.'],
];

/** Setup for the home-screen button: personal link + step-by-step Shortcut guide. */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const inTelegram = isInTelegram();

  const load = async (reset = false) => {
    setLoading(true);
    const r = await getShortcutLink(reset);
    setLink(r?.url ?? null);
    setLoading(false);
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
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Sheet open={open} title="Кнопка на iPhone" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="px-1 text-[15px] leading-snug text-muted">
          Нажали кнопку на экране «Домой» → продиктовали → ассистент всё записал, а бот прислал «Готово ✅». Работает, даже когда планер закрыт.
        </p>

        <div className="overflow-hidden rounded-[16px] bg-surface">
          <p className="px-4 pt-3 text-[13px] uppercase text-muted">Ваша личная ссылка</p>
          {!inTelegram ? (
            <p className="px-4 pb-3.5 pt-1 text-[15px]">Откройте планер в Telegram, чтобы получить ссылку.</p>
          ) : (
            <>
              <input
                id="shortcut-link"
                readOnly
                value={loading ? 'Загружаю…' : (link ?? 'Не удалось получить ссылку — попробуйте ещё раз')}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full bg-transparent px-4 pb-3 pt-1 font-mono text-[13px] text-fg outline-none"
              />
              <div className="grid grid-cols-2 border-t-[0.5px] border-line">
                <button type="button" disabled={!link} onClick={copy} className="flex items-center justify-center gap-1.5 py-3 text-[15px] font-semibold text-blue active:bg-surface-2 disabled:opacity-40">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? 'Скопировано' : 'Скопировать'}
                </button>
                <button
                  type="button"
                  onClick={() => load(true)}
                  className="flex items-center justify-center gap-1.5 border-l-[0.5px] border-line py-3 text-[15px] text-red active:bg-surface-2"
                >
                  <RefreshCw className="size-4" /> Новая ссылка
                </button>
              </div>
            </>
          )}
        </div>
        <p className="-mt-2 px-1 text-[13px] text-muted">Ссылка — как пароль: не делитесь ею. «Новая ссылка» отключает старую.</p>

        <ol className="overflow-hidden rounded-[16px] bg-surface">
          {STEPS.map(([title, text], i) => (
            <li key={title} className={`flex gap-3 px-4 py-3 ${i ? 'border-t-[0.5px] border-line' : ''}`}>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-blue text-[13px] font-semibold text-white">{i + 1}</span>
              <div>
                <p className="text-[16px] font-semibold">{title}</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Sheet>
  );
}
