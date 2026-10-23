import { useEffect, useState } from 'react';
import { Sheet } from '@/components/Sheet';
import { importFromTelegram, transferCode } from '@/lib/transfer';
import { haptic } from '@/lib/telegram';

/** App side: enter the code from the bot. */
export function TransferImportSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const [code, setCode] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; text?: string }>({ kind: 'idle' });
  useEffect(() => {
    if (open) {
      setCode('');
      setState({ kind: 'idle' });
    }
  }, [open]);
  const run = async () => {
    setState({ kind: 'busy' });
    const r = await importFromTelegram(code);
    if (r.ok) {
      haptic.notify('success');
      setState({ kind: 'done', text: `Готово: перенесено событий — ${r.events}, задач — ${r.tasks}.` });
    } else {
      haptic.notify('error');
      setState({
        kind: 'error',
        text: r.reason === 'bad_code' ? 'Код не подошёл или устарел. Попросите у бота новый.' : r.reason === 'rate' ? 'Слишком много попыток, подождите минуту.' : 'Нет связи с сервером, попробуйте ещё раз.',
      });
    }
  };
  return (
    <Sheet open={open} title="Перенести из бота" onClose={onClose}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="px-1 text-[15px] leading-snug text-muted">
          Если вы вели планер в боте @myliveplaners_bot, напишите ему <b className="text-fg">/transfer</b> — он пришлёт код из 6 цифр. События и задачи добавятся сюда, ничего не удалится.
        </p>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="rounded-[16px] bg-surface px-4 py-4 text-center font-mono text-[34px] tracking-[0.3em] text-fg outline-none placeholder:text-faint"
        />
        {state.text && <p className={`px-1 text-[15px] ${state.kind === 'done' ? 'text-green' : 'text-red'}`}>{state.text}</p>}
        <button
          type="button"
          disabled={code.length !== 6 || state.kind === 'busy'}
          onClick={state.kind === 'done' ? onClose : run}
          className="h-[50px] rounded-full bg-blue text-[17px] font-semibold text-white transition-[transform,opacity] duration-300 ease-spring active:scale-[0.97] disabled:opacity-30"
        >
          {state.kind === 'busy' ? 'Переношу…' : state.kind === 'done' ? 'Готово' : 'Перенести'}
        </button>
      </div>
    </Sheet>
  );
}

/** Telegram side: show a code for the app. */
export function TransferCodeSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const [code, setCode] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    setCode(undefined);
    void transferCode().then(setCode);
  }, [open]);
  return (
    <Sheet open={open} title="Перенести в приложение" onClose={onClose}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="px-1 text-[15px] leading-snug text-muted">В приложении ПЛАН на iPhone или Mac: Настройки → «Перенести из бота» → введите этот код. Здесь всё останется как было.</p>
        <div className="rounded-[16px] bg-surface py-5 text-center font-mono text-[40px] font-semibold tracking-[0.3em]">
          {code === undefined ? '······' : code === null ? '—' : code}
        </div>
        <p className="px-1 text-[13px] text-muted">{code === null ? 'Не удалось получить код, попробуйте ещё раз.' : 'Код действует 10 минут. Никому его не пересылайте.'}</p>
      </div>
    </Sheet>
  );
}
