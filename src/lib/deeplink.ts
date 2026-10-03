/**
 * Deep links: the bot's "Открыть" button opens the Mini App with ?open=<reminder id>
 *   e:<eventId>:<YYYY-MM-DD>  → that day in the calendar, event editor open
 *   t:<taskId>                → Tasks, task editor open
 */
import { useUIStore } from '@/store/useUIStore';

export function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  const open = params.get('open');
  if (!open) return;
  // Don't reopen on reload.
  params.delete('open');
  history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);

  const ui = useUIStore.getState();
  const [kind, id, date] = open.split(':');
  if (kind === 'e' && id) {
    if (date) ui.setSelectedDate(date);
    ui.setDayOpen(true);
    ui.setTab('calendar');
    ui.setFocus({ kind: 'event', id, date });
  } else if (kind === 't' && id) {
    ui.setTab('tasks');
    ui.setFocus({ kind: 'task', id });
  }
}
