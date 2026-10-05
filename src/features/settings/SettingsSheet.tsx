import { useEffect, useState, type ReactNode } from 'react';
import { CheckCheck, ChevronRight, Clock, MessageCircle, Moon, Palette, Smartphone, Sun } from 'lucide-react';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import { useUIStore } from '@/store/useUIStore';
import { haptic } from '@/lib/telegram';
import { loadDigest, saveDigest, sendDigestSample, sendFeedback, serverSettingsAvailable, type DigestSettings } from '@/lib/settings';
import type { ThemeMode } from '@/types';

const fieldClass = 'block w-full appearance-none rounded-[14px] bg-surface px-4 py-[11px] text-[17px] text-fg outline-none placeholder:text-faint';

function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {title && <span className="px-4 text-[13px] uppercase text-muted">{title}</span>}
      <div className="overflow-hidden rounded-[16px] bg-surface [&>*+*]:border-t-[0.5px] [&>*+*]:border-line">{children}</div>
      {footer && <p className="px-4 text-[13px] leading-snug text-muted">{footer}</p>}
    </div>
  );
}

function Row({ icon, iconBg, label, children, onClick }: { icon: ReactNode; iconBg: string; label: string; children?: ReactNode; onClick?(): void }) {
  const inner = (
    <>
      <span className={`grid size-[30px] shrink-0 place-items-center rounded-[8px] text-white ${iconBg}`}>{icon}</span>
      <span className="min-w-0 flex-1 text-left text-[17px]">{label}</span>
      {children}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex min-h-[50px] w-full items-center gap-3 px-4 py-2 transition-colors active:bg-surface-2">
      {inner}
    </button>
  ) : (
    <div className="flex min-h-[50px] items-center gap-3 px-4 py-2">{inner}</div>
  );
}

function TimeInput({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange(v: string): void }) {
  return (
    <input
      type="time"
      value={value}
      disabled={disabled}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="rounded-[8px] bg-surface-2 px-2.5 py-1 text-[17px] text-blue outline-none disabled:opacity-40"
    />
  );
}

/** One place for preferences: the bot's daily summary, completed tasks, the iPhone button, theme, feedback. */
export function SettingsSheet() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const setShortcutOpen = useUIStore((s) => s.setShortcutOpen);
  const hideDone = useUIStore((s) => s.hideDoneNextDay);
  const setHideDone = useUIStore((s) => s.setHideDoneNextDay);
  const themeOverride = useUIStore((s) => s.themeOverride);
  const setThemeOverride = useUIStore((s) => s.setThemeOverride);
  const showToast = useUIStore((s) => s.showToast);

  const online = serverSettingsAvailable();
  const [digest, setDigest] = useState<DigestSettings | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open && online) loadDigest().then((d) => d && setDigest(d));
    if (!open) setFeedback(null);
  }, [open, online]);

  const update = async (patch: Partial<DigestSettings>) => {
    haptic.selection();
    if (digest) setDigest({ ...digest, ...patch });
    const saved = await saveDigest(patch);
    if (saved) setDigest(saved);
    else showToast('Не удалось сохранить — проверьте интернет');
  };

  const sample = async () => {
    haptic.impact('light');
    const ok = await sendDigestSample('morning');
    showToast(ok ? 'Отправил сводку в чат с ботом' : 'Не получилось отправить — откройте бота и нажмите «Старт»');
  };

  const submitFeedback = async () => {
    if (!feedback?.trim()) return;
    setSending(true);
    const ok = await sendFeedback(feedback.trim());
    setSending(false);
    if (ok) {
      haptic.notify('success');
      setFeedback(null);
      showToast('Спасибо! Отзыв отправлен');
    } else showToast('Не удалось отправить — попробуйте позже');
  };

  const themes: { id: ThemeMode | null; label: string }[] = [
    { id: null, label: 'Авто' },
    { id: 'light', label: 'Светлая' },
    { id: 'dark', label: 'Тёмная' },
  ];

  return (
    <Sheet open={open} title="Настройки" onClose={() => setOpen(false)}>
      <div className="flex flex-col gap-6 pb-2">
        <Group
          title="Сводка от бота"
          footer={online ? 'Утром — план на день, вечером — на завтра. Бот пришлёт в Telegram события, задачи и просроченное. В любой момент: /today боту.' : 'Работает, когда планер открыт в Telegram.'}
        >
          <Row icon={<Sun className="size-[18px]" />} iconBg="bg-[#ff9f0a]" label="Утренняя сводка">
            <Switch checked={Boolean(digest?.morning)} disabled={!digest} onChange={(v) => update({ morning: v })} />
          </Row>
          {digest?.morning && (
            <Row icon={<Clock className="size-[18px]" />} iconBg="bg-[#8e8e93]" label="Время">
              <TimeInput value={digest.morningTime} onChange={(v) => update({ morningTime: v })} />
            </Row>
          )}
          <Row icon={<Moon className="size-[17px]" />} iconBg="bg-[#5e5ce6]" label="Вечерняя сводка">
            <Switch checked={Boolean(digest?.evening)} disabled={!digest} onChange={(v) => update({ evening: v })} />
          </Row>
          {digest?.evening && (
            <Row icon={<Clock className="size-[18px]" />} iconBg="bg-[#8e8e93]" label="Время">
              <TimeInput value={digest.eveningTime} onChange={(v) => update({ eveningTime: v })} />
            </Row>
          )}
          {online && (
            <button type="button" onClick={sample} className="w-full px-4 py-3 text-left text-[17px] text-blue transition-colors active:bg-surface-2">
              Прислать пример сейчас
            </button>
          )}
        </Group>

        <Group title="Задачи" footer={hideDone ? 'Выполненные остаются до конца дня, а на следующий день исчезают из списка.' : 'Выполненные задачи остаются в списке, пока вы их не удалите.'}>
          <Row icon={<CheckCheck className="size-[18px]" />} iconBg="bg-green" label="Скрывать выполненные">
            <Switch
              checked={hideDone}
              onChange={(v) => {
                haptic.selection();
                setHideDone(v);
              }}
            />
          </Row>
        </Group>

        <Group title="Ещё">
          <Row
            icon={<Smartphone className="size-[18px]" />}
            iconBg="bg-blue"
            label="Кнопка на iPhone"
            onClick={() => {
              haptic.impact('light');
              setOpen(false);
              window.setTimeout(() => setShortcutOpen(true), 380);
            }}
          >
            <ChevronRight className="size-5 text-faint" />
          </Row>
          <Row icon={<Palette className="size-[18px]" />} iconBg="bg-[#bf5af2]" label="Тема">
            <div className="flex rounded-[9px] bg-surface-2 p-[2px]">
              {themes.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => {
                    haptic.selection();
                    setThemeOverride(t.id);
                  }}
                  className={`rounded-[7px] px-2.5 py-1 text-[13px] font-medium transition-colors ${themeOverride === t.id ? 'bg-surface text-fg shadow-[0_1px_3px_rgb(0_0_0/0.15)]' : 'text-muted'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Row>
          {online && (
            <Row icon={<MessageCircle className="size-[18px]" />} iconBg="bg-[#30b0c7]" label="Написать отзыв" onClick={() => setFeedback(feedback === null ? '' : null)}>
              <ChevronRight className={`size-5 text-faint transition-transform duration-300 ${feedback !== null ? 'rotate-90' : ''}`} />
            </Row>
          )}
        </Group>

        {feedback !== null && (
          <div className="animate-fade-up flex flex-col gap-3">
            <textarea
              rows={4}
              autoFocus
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Что понравилось, что неудобно, чего не хватает?"
              className={`${fieldClass} resize-none`}
            />
            <button
              type="button"
              disabled={!feedback.trim() || sending}
              onClick={submitFeedback}
              className="h-[50px] rounded-full bg-blue text-[17px] font-semibold text-white transition-[transform,opacity] duration-300 ease-spring active:scale-[0.97] disabled:opacity-30"
            >
              {sending ? 'Отправляю…' : 'Отправить'}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

const todayTitle = () => {
  const s = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Once, a few seconds after the first launch in Telegram: "send me a morning summary?" */
export function DigestPrompt() {
  const prompted = useUIStore((s) => s.digestPrompted);
  const setPrompted = useUIStore((s) => s.setDigestPrompted);
  const showToast = useUIStore((s) => s.showToast);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (prompted || !serverSettingsAvailable()) return;
    const t = window.setTimeout(() => setOpen(true), 2500);
    return () => window.clearTimeout(t);
  }, [prompted]);

  const answer = async (on: boolean) => {
    haptic.notify(on ? 'success' : 'warning');
    setPrompted(true);
    setOpen(false);
    const saved = await saveDigest({ morning: on });
    if (on && saved) showToast(`Каждое утро в ${saved.morningTime} пришлю план на день. Время можно поменять в настройках`);
  };

  return (
    <Sheet
      open={open}
      title="Утренняя сводка"
      onClose={() => {
        setOpen(false);
        setPrompted(true);
      }}
    >
      <div className="flex flex-col gap-5 pb-2">
        <div className="rounded-[18px] bg-surface p-4 text-[15px] leading-relaxed">
          <p className="font-semibold">☀️ Доброе утро! {todayTitle()}</p>
          <p className="mt-2 font-semibold">📅 События</p>
          <p>10:00–11:00 Созвон с командой</p>
          <p>19:00–20:00 Тренировка</p>
          <p className="mt-2 font-semibold">✅ Задачи на сегодня</p>
          <p>• Купить продукты</p>
        </div>
        <p className="px-1 text-[15px] leading-snug text-muted">Каждое утро бот будет присылать в Telegram план на день, чтобы ничего не забыть. Время и вечернюю сводку можно настроить потом.</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => answer(true)}
            className="h-[50px] rounded-full bg-blue text-[17px] font-semibold text-white transition-transform duration-300 ease-spring active:scale-[0.97]"
          >
            Присылать каждое утро
          </button>
          <button type="button" onClick={() => answer(false)} className="h-[44px] rounded-full text-[17px] text-blue active:opacity-60">
            Не нужно
          </button>
        </div>
      </div>
    </Sheet>
  );
}
