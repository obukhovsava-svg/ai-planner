import { useEffect, useState } from 'react';
import { ImagePlus, RotateCcw, Wand2 } from 'lucide-react';
import { postNative } from '@/lib/native';
import { haptic, openExternal } from '@/lib/telegram';
import { SHORTCUT_LINKS } from '@/lib/shortcutLinks';

/**
 * iOS app: the lock-screen wallpaper with today's plans and tasks. Pick a photo (or keep the
 * brand background) and install the «Обои ПЛАН» Shortcut, which redraws and sets it.
 */
export function WallpaperSettings({ open }: { open: boolean }) {
  const [state, setState] = useState<{ hasPhoto: boolean; preview?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.__plannerWallpaper = (e) => {
      setState(e);
      setBusy(false);
    };
    return () => {
      window.__plannerWallpaper = undefined;
    };
  }, []);
  useEffect(() => {
    if (open) postNative({ type: 'wallpaper', action: 'state' });
  }, [open]);

  const act = (action: 'pick' | 'reset') => {
    haptic.impact('light');
    if (action === 'reset') setBusy(true);
    postNative({ type: 'wallpaper', action });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-4 text-[13px] uppercase text-muted">Обои экрана блокировки</span>
      <div className="flex gap-4 rounded-[16px] bg-surface p-3">
        <div className="relative h-[196px] w-[90px] shrink-0 overflow-hidden rounded-[14px] bg-surface-2 shadow-[0_0_0_0.5px_var(--line)]">
          {state?.preview && <img src={state.preview} alt="Обои" className="absolute inset-0 size-full object-cover" />}
          {busy && <div className="absolute inset-0 animate-pulse bg-black/20" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-[14px] leading-snug text-muted">Слева планы на день, справа задачи — поверх вашего фото. Обновляются сами.</p>
          <button
            type="button"
            onClick={() => act('pick')}
            className="flex items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[15px] font-medium text-blue active:opacity-60"
          >
            <ImagePlus className="size-[18px]" /> {state?.hasPhoto ? 'Другое фото' : 'Выбрать фото'}
          </button>
          {state?.hasPhoto && (
            <button
              type="button"
              onClick={() => act('reset')}
              className="flex items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[15px] font-medium text-fg active:opacity-60"
            >
              <RotateCcw className="size-[17px]" /> Стандартный фон
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          haptic.impact('medium');
          openExternal(SHORTCUT_LINKS.wallpaper || 'shortcuts://');
        }}
        className="flex h-[50px] items-center justify-center gap-2 rounded-[14px] bg-blue text-[17px] font-semibold text-white active:opacity-80"
      >
        <Wand2 className="size-[18px]" /> Поставить на экран блокировки
      </button>
      <p className="px-4 text-[13px] leading-snug text-muted">
        {SHORTCUT_LINKS.wallpaper
          ? 'Откроются «Команды» → «Добавить команду». Обои обновятся каждое утро и после того, как вы закрыли планер.'
          : 'В «Командах»: «+» → действие «Обои ПЛАН» → «Установить обои» (экран блокировки, без предпросмотра).'}
      </p>
    </div>
  );
}
