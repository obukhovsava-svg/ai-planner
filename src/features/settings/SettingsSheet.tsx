import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TimeField } from '@/components/TimeField';
import { ArrowLeftRight, CheckCheck, ChevronRight, Clock, ImagePlus, LayoutGrid, MessageCircle, Moon, PaintBucket, Palette, Shield, Smartphone, Sparkles, Sun, Trash2 } from 'lucide-react';
import { ACCENTS } from '@/lib/accent';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import { useUIStore } from '@/store/useUIStore';
import { usePlannerStore } from '@/store/usePlannerStore';
import { haptic } from '@/lib/telegram';
import { digestAvailable, loadDigest, saveDigest, sendDigestSample, sendFeedback, serverSettingsAvailable, type DigestSettings } from '@/lib/settings';
import type { ThemeMode } from '@/types';
import { isNative } from '@/lib/native';
import { TelegramWallpaperSettings, WallpaperSettings } from './WallpaperSettings';
import { AI_DISCLOSURE, DeleteDataSheet, PRIVACY_URL } from './Privacy';
import { TransferCodeSheet, TransferImportSheet } from './Transfer';
import { WALLPAPER_IN_TELEGRAM } from '@/lib/wallpaper';
import { useAiConsent } from '@/lib/aiConsent';
import { hasServerAuth } from '@/lib/auth';
import { openExternal } from '@/lib/telegram';

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
    <TimeField
      value={value}
      disabled={disabled}
      onChange={onChange}
      className="rounded-[8px] bg-surface-2 px-2.5 py-1 text-[17px] text-blue outline-none disabled:opacity-40"
    />
  );
}

/** One place for preferences: the bot's daily summary, completed tasks, the iPhone button, theme, feedback. */
export function SettingsSheet() {
  const aiConsent = useAiConsent((st) => st.consent);
  const setAiConsent = useAiConsent((st) => st.set);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const setShortcutOpen = useUIStore((s) => s.setShortcutOpen);
  const accent = useUIStore((s) => s.accent);
  const setAccent = useUIStore((s) => s.setAccent);
  const widgetTone = useUIStore((s) => s.widgetTone);
  const tintBg = useUIStore((s) => s.tintBg);
  const setTintBg = useUIStore((s) => s.setTintBg);
  const setWidgetTone = useUIStore((s) => s.setWidgetTone);
  const wallpaperOpen = useUIStore((s) => s.wallpaperOpen);
  const setWallpaperOpen = useUIStore((s) => s.setWallpaperOpen);
  // opened from here → closing it comes back here (it can also be opened from the next-step offer)
  const wallpaperFromSettings = useRef(false);
  const wallpaperAvailable = isNative() || (WALLPAPER_IN_TELEGRAM && digestAvailable());
  const hideDone = useUIStore((s) => s.hideDoneNextDay);
  const setHideDone = useUIStore((s) => s.setHideDoneNextDay);
  const themeOverride = useUIStore((s) => s.themeOverride);
  const setThemeOverride = useUIStore((s) => s.setThemeOverride);
  const showToast = useUIStore((s) => s.showToast);

  const online = serverSettingsAvailable();
  const [digest, setDigest] = useState<DigestSettings | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const feedbackBox = useRef<HTMLDivElement>(null);
  const feedbackOpen = feedback !== null;

  // Opening the feedback form: bring it into view, then again once the keyboard has slid up.
  const revealFeedback = () => {
    for (const ms of [60, 380, 700]) {
      window.setTimeout(() => feedbackBox.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), ms);
    }
  };
  useEffect(() => {
    if (feedbackOpen) revealFeedback();
  }, [feedbackOpen]);

  useEffect(() => {
    if (open && digestAvailable()) {
      loadDigest().then((d) => d && setDigest(d));
    }
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
    <>
      <Sheet open={open} title="Настройки" onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-6 pb-2">
          {digestAvailable() && (
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
          )}

          {wallpaperAvailable && (
            <Group>
              <Row
                icon={<ImagePlus className="size-[18px]" />}
                iconBg="bg-[#30b0c7]"
                label="Добавить обои"
                onClick={() => {
                  haptic.impact('light');
                  setOpen(false);
                  wallpaperFromSettings.current = true;
                  window.setTimeout(() => setWallpaperOpen(true), 380);
                }}
              >
                <ChevronRight className="size-5 text-faint" />
              </Row>
            </Group>
          )}

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
            {/* accent colour: buttons, the active tab, the assistant's gradient */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="grid size-[30px] shrink-0 place-items-center rounded-[8px] text-white" style={{ background: 'var(--gemini)' }}>
                  <Sparkles className="size-[17px]" />
                </span>
                <span className="min-w-0 flex-1 text-[17px]">Цвет оформления</span>
                <span className="text-[15px] text-muted">{ACCENTS.find((a) => a.id === accent)?.label}</span>
              </div>
              <div className="mt-3 flex justify-between pl-[42px]">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    aria-label={a.label}
                    aria-pressed={accent === a.id}
                    onClick={() => {
                      haptic.selection();
                      setAccent(a.id);
                    }}
                    className="grid size-[34px] place-items-center rounded-full transition-transform duration-300 ease-spring active:scale-90"
                    style={{ boxShadow: accent === a.id ? `0 0 0 2px var(--surface), 0 0 0 4px ${a.swatch}` : undefined }}
                  >
                    <span className="size-[26px] rounded-full" style={{ background: a.swatch }} />
                  </button>
                ))}
              </div>
            </div>
            {isNative() && (
              <Row icon={<PaintBucket className="size-[17px]" />} iconBg="bg-[#8e8e93]" label="Системный дизайн">
                <Switch
                  checked={!tintBg}
                  onChange={(v) => {
                    haptic.selection();
                    setTintBg(!v);
                  }}
                />
              </Row>
            )}
            {isNative() && (
              <Row icon={<LayoutGrid className="size-[18px]" />} iconBg="bg-blue" label="Фон виджета">
                <div className="flex rounded-[9px] bg-surface-2 p-[2px]">
                  {(
                    [
                      ['pastel', 'Пастельный'],
                      ['dark', 'Тёмный'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        haptic.selection();
                        setWidgetTone(id);
                      }}
                      className={`rounded-[7px] px-2.5 py-1 text-[13px] font-medium transition-colors ${widgetTone === id ? 'bg-surface text-fg shadow-[0_1px_3px_rgb(0_0_0/0.15)]' : 'text-muted'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Row>
            )}
            {online && (
              <Row icon={<MessageCircle className="size-[18px]" />} iconBg="bg-[#30b0c7]" label="Написать отзыв" onClick={() => setFeedback(feedback === null ? '' : null)}>
                <ChevronRight className={`size-5 text-faint transition-transform duration-300 ${feedback !== null ? 'rotate-90' : ''}`} />
              </Row>
            )}
          </Group>

          {feedback !== null && (
            <div ref={feedbackBox} className="animate-fade-up flex scroll-mb-6 flex-col gap-3">
              <textarea
                rows={4}
                autoFocus
                onFocus={revealFeedback}
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

          {hasServerAuth() && (
            <Group>
              <Row icon={<ArrowLeftRight className="size-[18px]" />} iconBg="bg-[#30b0c7]" label={isNative() ? 'Перенести из бота' : 'Перенести в приложение'} onClick={() => setTransferOpen(true)}>
                <ChevronRight className="size-5 text-faint" />
              </Row>
            </Group>
          )}

          <Group title="Конфиденциальность" footer={isNative() ? AI_DISCLOSURE : undefined}>
            {isNative() && (
              <Row icon={<Sparkles className="size-[18px]" />} iconBg="bg-[#5e5ce6]" label="AI-ассистент">
                <Switch checked={aiConsent === true} onChange={(v) => setAiConsent(v)} />
              </Row>
            )}
            <Row icon={<Shield className="size-[18px]" />} iconBg="bg-[#8e8e93]" label="Политика конфиденциальности" onClick={() => openExternal(PRIVACY_URL)}>
              <ChevronRight className="size-5 text-faint" />
            </Row>
            {(hasServerAuth() || isNative()) && (
              <Row icon={<Trash2 className="size-[18px]" />} iconBg="bg-red" label="Удалить мои данные" onClick={() => setDeleteOpen(true)}>
                <ChevronRight className="size-5 text-faint" />
              </Row>
            )}
          </Group>
        </div>
      </Sheet>
      <DeleteDataSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} />
      {isNative() ? <TransferImportSheet open={transferOpen} onClose={() => setTransferOpen(false)} /> : <TransferCodeSheet open={transferOpen} onClose={() => setTransferOpen(false)} />}
      {wallpaperAvailable && (
        <Sheet
          open={wallpaperOpen}
          title="Обои"
          onClose={() => {
            setWallpaperOpen(false);
            // back to the settings it was opened from
            if (wallpaperFromSettings.current) window.setTimeout(() => setOpen(true), 380);
            wallpaperFromSettings.current = false;
          }}
        >
          <div className="pb-2">{isNative() ? <WallpaperSettings open={wallpaperOpen} /> : <TelegramWallpaperSettings open={wallpaperOpen} />}</div>
        </Sheet>
      )}
    </>
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

  // Not on a newcomer's first seconds (the assistant's examples come first): once the planner has
  // something in it — on start for returning users, or after the second item for new ones.
  const items = usePlannerStore((s) => s.tasks.length + s.events.length);
  useEffect(() => {
    if (prompted || !digestAvailable() || items < 2) return;
    const t = window.setTimeout(() => setOpen(true), 2500);
    return () => window.clearTimeout(t);
  }, [prompted, items >= 2]); // eslint-disable-line react-hooks/exhaustive-deps

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
