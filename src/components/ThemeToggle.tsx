import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/providers/ThemeProvider';

export function ThemeToggle() {
  const { theme, toggle, isManual } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      className="relative grid size-9 place-items-center rounded-full border border-line bg-surface text-fg shadow-card transition-transform active:scale-90"
    >
      <Sun
        className={`absolute size-[18px] transition-all duration-500 ${dark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'}`}
      />
      <Moon
        className={`absolute size-[18px] transition-all duration-500 ${dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'}`}
      />
      {isManual && (
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-gemini ring-2 ring-bg" title="Ручной режим темы" />
      )}
    </button>
  );
}
