import type { Category, EventColor, Priority } from '@/types';

export const PRIORITY_META: Record<Priority, { label: string; className: string; marks: string }> = {
  high: { label: 'Высокий', className: 'bg-red/12 text-red', marks: '!!!' },
  medium: { label: 'Средний', className: 'bg-[#ff9500]/12 text-[#ff9500]', marks: '!!' },
  low: { label: 'Низкий', className: 'bg-surface-2 text-muted', marks: '!' },
};

export const CATEGORY_META: Record<Category, { label: string; emoji: string }> = {
  work: { label: 'Работа', emoji: '💼' },
  personal: { label: 'Личное', emoji: '🏠' },
  health: { label: 'Здоровье', emoji: '💪' },
  study: { label: 'Учёба', emoji: '📚' },
  other: { label: 'Другое', emoji: '📌' },
};

/** iOS system colours for calendar events. */
export const EVENT_COLORS: Record<EventColor, { bar: string; bg: string; text: string; dot: string }> = {
  blue: { bar: 'bg-blue', bg: 'bg-blue/15', text: 'text-blue', dot: 'bg-blue' },
  red: { bar: 'bg-red', bg: 'bg-red/15', text: 'text-red', dot: 'bg-red' },
  violet: { bar: 'bg-[#af52de]', bg: 'bg-[#af52de]/15', text: 'text-[#af52de] dark:text-[#bf5af2]', dot: 'bg-[#af52de]' },
  green: { bar: 'bg-green', bg: 'bg-green/15', text: 'text-[#248a3d] dark:text-green', dot: 'bg-green' },
  amber: { bar: 'bg-[#ff9500]', bg: 'bg-[#ff9500]/15', text: 'text-[#c93400] dark:text-[#ff9f0a]', dot: 'bg-[#ff9500]' },
};

export const CATEGORY_TO_COLOR: Record<Category, EventColor> = {
  work: 'blue',
  personal: 'violet',
  health: 'red',
  study: 'amber',
  other: 'green',
};
