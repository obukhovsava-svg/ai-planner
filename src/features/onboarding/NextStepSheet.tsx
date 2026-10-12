import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, ImagePlus, Mic } from 'lucide-react';
import { Sheet } from '@/components/Sheet';
import { useUIStore } from '@/store/useUIStore';
import { usePlannerStore } from '@/store/usePlannerStore';
import { hasServerAuth } from '@/lib/auth';
import { isNative } from '@/lib/native';
import { haptic } from '@/lib/telegram';

const SHOWN_KEY = 'planner:next-step';

/**
 * Once, right after the very first item: the two things that keep people coming back —
 * the voice button and the lock-screen wallpaper (everyone still active has one of them).
 */
export function NextStepSheet() {
  const [open, setOpen] = useState(false);
  const setShortcutOpen = useUIStore((s) => s.setShortcutOpen);
  const setWallpaperOpen = useUIStore((s) => s.setWallpaperOpen);

  useEffect(() => {
    if (!hasServerAuth() && !isNative()) return;
    let t = 0;
    const unsub = usePlannerStore.subscribe((state, prev) => {
      const now = state.tasks.length + state.events.length, before = prev.tasks.length + prev.events.length;
      if (before !== 0 || now === 0) return;
      try {
        if (localStorage.getItem(SHOWN_KEY)) return;
        localStorage.setItem(SHOWN_KEY, '1');
      } catch {
        return;
      }
      // let the assistant's "added" reply land first
      t = window.setTimeout(() => setOpen(true), 2200);
    });
    return () => {
      unsub();
      window.clearTimeout(t);
    };
  }, []);

  const go = (then: () => void) => {
    haptic.impact('light');
    setOpen(false);
    window.setTimeout(then, 380);
  };

  return (
    <Sheet open={open} title="Первая запись есть 🎉" onClose={() => setOpen(false)}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="px-1 text-[15px] leading-snug text-muted">Ещё два шага, и планер будет под рукой, даже когда Telegram закрыт.</p>
        <div className="overflow-hidden rounded-[16px] bg-surface [&>*+*]:border-t-[0.5px] [&>*+*]:border-line">
          <Option
            icon={<Mic className="size-[18px]" />}
            bg="bg-blue"
            title="Голосовая кнопка на iPhone"
            text="Нажали на экране «Домой», сказали дело, и оно в плане"
            onClick={() => go(() => setShortcutOpen(true))}
          />
          <Option
            icon={<ImagePlus className="size-[18px]" />}
            bg="bg-[#30b0c7]"
            title="План на экране блокировки"
            text="Обои с планами и задачами на сегодня, обновляются сами"
            onClick={() => go(() => setWallpaperOpen(true))}
          />
        </div>
        <button type="button" onClick={() => setOpen(false)} className="h-[44px] rounded-full text-[17px] text-blue active:opacity-60">
          Позже
        </button>
      </div>
    </Sheet>
  );
}

function Option({ icon, bg, title, text, onClick }: { icon: ReactNode; bg: string; title: string; text: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-surface-2">
      <span className={`grid size-[34px] shrink-0 place-items-center rounded-[9px] text-white ${bg}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium">{title}</span>
        <span className="block text-[14px] leading-snug text-muted">{text}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-faint" />
    </button>
  );
}
