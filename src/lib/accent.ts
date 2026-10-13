/**
 * Accent colour of the interface: buttons, the active tab, links — and the assistant's gradient.
 * Soft tones (iPhone 17-like sage and mist blue among them); blue is the iOS default.
 * The values live in index.css under [data-accent=…]; index.html applies the saved one before paint.
 */
export const ACCENTS = [
  { id: 'blue', label: 'Синий', swatch: '#0a84ff' },
  { id: 'sage', label: 'Салатовый', swatch: '#8cc46f' },
  { id: 'lime', label: 'Лайм', swatch: '#d3f5a8' },
  { id: 'mist', label: 'Голубой', swatch: '#6cb8ec' },
  { id: 'pink', label: 'Розовый', swatch: '#f08db0' },
  { id: 'red', label: 'Красный', swatch: '#f2766f' },
  { id: 'yellow', label: 'Жёлтый', swatch: '#e8bb45' },
  { id: 'milk', label: 'Молочный', swatch: '#d9c3a5' },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'];
