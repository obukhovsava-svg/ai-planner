import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/providers/ThemeProvider';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      className="relative grid size-9 place-items-center rounded-full bg-surface-2 text-blue transition-transform duration-300 ease-spring active:scale-90"
    >
      <Sun
        className={`absolute size-[18px] transition-all duration-500 ease-spring ${dark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'}`}
        strokeWidth={2.2}
      />
      <Moon
        className={`absolute size-[17px] transition-all duration-500 ease-spring ${dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'}`}
        strokeWidth={2.2}
      />
    </button>
  );
}
