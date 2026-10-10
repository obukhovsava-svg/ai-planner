import { useEffect, useRef, useState } from 'react';
import { ImagePlus, RotateCcw, Wand2 } from 'lucide-react';
import { postNative } from '@/lib/native';
import { haptic, openExternal } from '@/lib/telegram';
import { SHORTCUT_LINKS } from '@/lib/shortcutLinks';
import { getShortcutLink } from '@/lib/shortcut';
import { clearPhoto, loadPhotoBlob, renderWallpaper, savePhoto, setWallpaperOn, uploadWallpapers, wallpaperOn } from '@/lib/wallpaper';

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

/** The signed «Обои ПЛАН» Shortcut for Telegram users (until the one-tap iCloud link is published). */
const TG_FILE = new URL('planner-wallpaper.shortcut', location.href).href;

/**
 * Telegram: the planner draws the wallpaper itself (today + tomorrow) and keeps it on the
 * server; the «Обои ПЛАН» Shortcut fetches it by the personal link and sets it.
 */
export function TelegramWallpaperSettings({ open }: { open: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setHasPhoto(Boolean(await loadPhotoBlob()));
    const c = await renderWallpaper();
    setPreview(c.toDataURL('image/jpeg', 0.7));
  };
  useEffect(() => {
    if (!open) return;
    void refresh();
    if (!link) getShortcutLink().then((r) => r && setLink(r.url.replace(/\/shortcut\?key=/, '/wallpaper/') + '.jpg'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onFile = async (f?: File) => {
    if (!f) return;
    await savePhoto(f);
    haptic.notify('success');
    await refresh();
    if (wallpaperOn()) void uploadWallpapers(true);
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* the field below is selectable */
    }
    setWallpaperOn();
    void uploadWallpapers(true);
    haptic.notify('success');
    setCopied(true);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-4 text-[13px] uppercase text-muted">Обои экрана блокировки</span>
      <div className="flex gap-4 rounded-[16px] bg-surface p-3">
        <div className="relative h-[196px] w-[90px] shrink-0 overflow-hidden rounded-[14px] bg-surface-2 shadow-[0_0_0_0.5px_var(--line)]">
          {preview && <img src={preview} alt="Обои" className="absolute inset-0 size-full object-cover" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-[14px] leading-snug text-muted">Слева планы на день, справа задачи — поверх вашего фото. Обновляются сами.</p>
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => file.current?.click()}
            className="flex items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[15px] font-medium text-blue active:opacity-60"
          >
            <ImagePlus className="size-[18px]" /> {hasPhoto ? 'Другое фото' : 'Выбрать фото'}
          </button>
          {hasPhoto && (
            <button
              type="button"
              onClick={async () => {
                await clearPhoto();
                await refresh();
                if (wallpaperOn()) void uploadWallpapers(true);
              }}
              className="flex items-center gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[15px] font-medium text-fg active:opacity-60"
            >
              <RotateCcw className="size-[17px]" /> Стандартный фон
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[16px] bg-surface">
        <div className="flex items-center gap-3 px-4 pt-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-blue text-[13px] font-semibold text-white">1</span>
          <p className="text-[16px] font-semibold">Скопируйте ссылку на обои</p>
        </div>
        <input readOnly value={link ?? 'Загружаю…'} onFocus={(e) => e.currentTarget.select()} className="w-full truncate bg-transparent px-4 pb-3 pl-[52px] pt-1 font-mono text-[12px] text-muted outline-none" />
        <button
          type="button"
          disabled={!link}
          onClick={copy}
          className={`w-full border-t-[0.5px] border-line py-3 text-[16px] font-semibold active:bg-surface-2 disabled:opacity-40 ${copied ? 'text-green' : 'text-blue'}`}
        >
          {copied ? 'Скопировано' : 'Скопировать ссылку'}
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          haptic.impact('medium');
          setWallpaperOn();
          void uploadWallpapers(true);
          openExternal(SHORTCUT_LINKS.wallpaperTelegram || TG_FILE);
        }}
        className="flex h-[50px] items-center justify-center gap-2 rounded-[14px] bg-blue text-[17px] font-semibold text-white active:opacity-80"
      >
        <Wand2 className="size-[18px]" /> 2. Установить команду «Обои ПЛАН»
      </button>
      <p className="px-4 text-[13px] leading-snug text-muted">
        При установке вставьте ссылку. Чтобы обои менялись сразу после изменений: «Команды» → «Автоматизация» → «+» → «Приложение» → Telegram → «Закрыто» →
        «Запускать сразу» → «Обои ПЛАН». И ещё одну на «Время суток» 07:00 — для смены дня.
      </p>
    </div>
  );
}
