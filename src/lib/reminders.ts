/**
 * Reminder labels for the UI. The moments themselves are computed on the server
 * (see reminderCore.ts, used by the worker) whenever the planner syncs.
 */

export { REMIND_PRESETS, atLabel, offsetLabel, reminderLabel } from './reminderCore';
export type { ReminderInstance } from './reminderCore';
