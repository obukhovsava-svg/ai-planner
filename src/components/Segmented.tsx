import { haptic } from '@/lib/telegram';

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}

/** iOS UISegmentedControl with a sliding thumb. */
export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div className="relative grid rounded-[9px] bg-surface-2 p-[2px]" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      <span
        className="absolute inset-y-[2px] left-[2px] rounded-[7px] bg-white shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] transition-transform duration-500 ease-spring dark:bg-[#636366]"
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
          className={`relative z-10 py-[5px] text-[13px] transition-[font-weight] ${o.value === value ? 'font-semibold' : 'font-medium'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
