import type { Category, EventColor, Priority } from '@/types';

export const PRIORITY_META: Record<Priority, { label: string; className: string }> = {
  high: { label: 'Высокий', className: 'bg-red/12 text-red dark:bg-red/20 dark:text-coral' },
  medium: { label: 'Средний', className: 'bg-amber-500/12 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300' },
  low: { label: 'Низкий', className: 'bg-slate-500/10 text-muted' },
};

export const CATEGORY_META: Record<Category, { label: string; emoji: string }> = {
  work: { label: 'Работа', emoji: '💼' },
  personal: { label: 'Личное', emoji: '🏠' },
  health: { label: 'Здоровье', emoji: '💪' },
  study: { label: 'Учёба', emoji: '📚' },
  other: { label: 'Другое', emoji: '📌' },
};

export const EVENT_COLORS: Record<EventColor, { bar: string; bg: string; text: string; dot: string }> = {
  blue: { bar: 'bg-blue', bg: 'bg-blue/10 dark:bg-blue/20', text: 'text-blue dark:text-sky', dot: 'bg-blue' },
  red: { bar: 'bg-red', bg: 'bg-red/10 dark:bg-red/20', text: 'text-red dark:text-coral', dot: 'bg-red' },
  violet: { bar: 'bg-violet-500', bg: 'bg-violet-500/10 dark:bg-violet-500/20', text: 'text-violet-600 dark:text-violet-300', dot: 'bg-violet-500' },
  green: { bar: 'bg-emerald-500', bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-500' },
  amber: { bar: 'bg-amber-500', bg: 'bg-amber-500/10 dark:bg-amber-500/20', text: 'text-amber-600 dark:text-amber-300', dot: 'bg-amber-500' },
};

export const CATEGORY_TO_COLOR: Record<Category, EventColor> = {
  work: 'blue',
  personal: 'violet',
  health: 'red',
  study: 'amber',
  other: 'green',
};
