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
    <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4" style={{ bottom: 'calc(var(--tabbar-h) + max(env(safe-area-inset-bottom), var(--tg-safe-bottom, 0px)) + 12px)' }}>
      <div
        key={toast.id}
        role="status"
        className="animate-fade-up pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-2xl bg-fg px-4 py-3 text-sm text-bg shadow-2xl"
      >
        <span className="truncate">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            className="shrink-0 font-semibold text-sky"
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
