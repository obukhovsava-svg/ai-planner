import { haptic } from '@/lib/telegram';

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}

/** iOS UISegmentedControl look-alike with a sliding thumb. */
export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div className="relative grid rounded-xl bg-surface-2 p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      <span
        className="absolute inset-y-0.5 left-0.5 rounded-[10px] bg-surface shadow-card transition-transform duration-300 ease-out dark:bg-line"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => {
            if (o.value !== value) {
              haptic.selection();
              onChange(o.value);
            }
          }}
          className={`relative z-10 py-1.5 text-[13px] font-semibold transition-colors ${o.value === value ? 'text-fg' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
