import type { ReactNode } from 'react';
import { Settings } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useUIStore } from '@/store/useUIStore';
import { haptic } from '@/lib/telegram';

interface HeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Extra controls rendered left of the theme toggle. */
  actions?: ReactNode;
  /** Plain (white/black) bar for non-grouped screens such as the calendar. */
  plain?: boolean;
}

/** iOS-style large-title navigation bar. */
export function Header({ title, subtitle, actions, plain }: HeaderProps) {
  const openSettings = useUIStore((s) => s.setSettingsOpen);
  return (
    <header
      className={`pt-safe sticky top-0 z-20 backdrop-blur-xl backdrop-saturate-200 ${plain ? 'bg-[var(--navbar-plain)]' : 'bg-[var(--navbar)]'}`}
    >
      <div className="flex items-end justify-between gap-3 px-4 pb-2 pt-2">
        <div className="min-w-0">
          {subtitle && <div className="truncate text-[15px] text-muted">{subtitle}</div>}
          <h1 className="truncate text-[34px] font-bold leading-[1.15] tracking-[0.01em]">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-1.5">
          {actions}
          <ThemeToggle />
          <IconButton
            label="Настройки"
            onClick={() => {
              haptic.impact('light');
              openSettings(true);
            }}
          >
            <Settings className="size-[18px]" strokeWidth={2.2} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}

export function IconButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full bg-surface-2 text-blue transition-transform duration-300 ease-spring active:scale-90"
    >
      {children}
    </button>
  );
}
