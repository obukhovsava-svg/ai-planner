import { useEffect } from 'react';
import { useUIStore } from '@/store/useUIStore';

export function Toast() {
  const toast = useUIStore((s) => s.toast);
  const hide = useUIStore((s) => s.hideToast);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(hide, 4000);
    return () => window.clearTimeout(t);
  }, [toast, hide]);

  if (!toast) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: 'calc(var(--tabbar-h) + max(env(safe-area-inset-bottom), var(--tg-safe-bottom, 0px)) + 12px)' }}
    >
      <div
        key={toast.id}
        role="status"
        className="animate-fade-up pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-full bg-[rgb(30_30_32/0.88)] py-2.5 pl-5 pr-2.5 text-[15px] text-white shadow-[0_8px_32px_rgb(0_0_0/0.25)] backdrop-blur-xl"
      >
        <span className="truncate">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            className="shrink-0 rounded-full px-3 py-1 font-semibold text-[#0a84ff] active:opacity-60"
            onClick={() => {
              toast.action!.run();
              hide();
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
