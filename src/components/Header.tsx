import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

interface HeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Extra controls rendered left of the theme toggle. */
  actions?: ReactNode;
}

/** iOS-style large-title navigation bar. */
export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header className="pt-safe sticky top-0 z-20 bg-[var(--navbar)] backdrop-blur-xl backdrop-saturate-200">
      <div className="flex items-end justify-between gap-3 px-4 pb-2 pt-2">
        <div className="min-w-0">
          {subtitle && <div className="truncate text-[15px] text-muted">{subtitle}</div>}
          <h1 className="truncate text-[34px] font-bold leading-[1.15] tracking-[0.01em]">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-1.5">
          {actions}
          <ThemeToggle />
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
