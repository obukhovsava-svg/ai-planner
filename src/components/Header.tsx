import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

interface HeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Extra controls rendered left of the theme toggle. */
  actions?: ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header className="pt-safe sticky top-0 z-20 bg-bg/85 backdrop-blur-md">
      <div className="flex items-end justify-between gap-3 px-4 pb-3 pt-3">
        <div className="min-w-0">
          {subtitle && <p className="truncate text-[13px] font-medium text-muted">{subtitle}</p>}
          <h1 className="truncate text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-1">
          {actions}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid size-9 place-items-center rounded-full border border-line shadow-card transition-transform active:scale-90 ${
        active ? 'bg-fg text-bg' : 'bg-surface text-fg'
      }`}
    >
      {children}
    </button>
  );
}
