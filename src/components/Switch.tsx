/** iOS UISwitch. */
export function Switch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange(v: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300 disabled:opacity-40 ${checked ? 'bg-green' : 'bg-surface-2'}`}
    >
      <span
        className={`absolute left-[2px] top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_3px_1px_rgb(0_0_0/0.06)] transition-transform duration-300 ease-spring ${
          checked ? 'translate-x-[20px]' : ''
        }`}
      />
    </button>
  );
}
