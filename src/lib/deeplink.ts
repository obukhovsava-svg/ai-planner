/**
 * Deep links: the bot's "Открыть" button opens the Mini App with ?open=…
 *   e:<eventId>:<YYYY-MM-DD>  → the plan for that day
 *   t:<taskId>                → the task list, with that task highlighted
 *   a                         → the assistant (a question is waiting there)
 *   d:<YYYY-MM-DD>            → the plan for that day (from the morning summary)
 */
import { useUIStore } from '@/store/useUIStore';
import { getStartParam } from './telegram';

export function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  // t.me/<bot>?startapp=a (from the iPhone command) arrives as Telegram's start_param.
  const open = params.get('open') ?? getStartParam();
  if (!open) return;
  // Don't reopen on reload.
  params.delete('open');
  history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);

  openTarget(open);
}

/** e:<id>:<date> / t:<id> / d:<date> / a — also called by the iOS app when a notification is tapped. */
export function openTarget(open: string) {
  const ui = useUIStore.getState();
  const [kind, id, date] = open.split(':');
  if (kind === 'e' && date) {
    ui.setSelectedDate(date);
    ui.setDayOpen(true);
    ui.setTab('calendar');
  } else if (kind === 't' && id) {
    ui.setTab('tasks');
    ui.setFocus({ kind: 'task', id });
  } else if (kind === 'd' && id) {
    ui.setSelectedDate(id);
    ui.setDayOpen(true);
    ui.setTab('calendar');
  } else if (kind === 'a') {
    ui.setTab('assistant');
  }
}

window.__plannerOpen = (target: string) => openTarget(target);
