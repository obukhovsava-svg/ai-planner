/**
 * Conflict-free merge of planner documents (app ⇄ server ⇄ other devices).
 * Per item, the most recent change wins; deletions are kept as tombstones for a while,
 * so a deleted item can't be resurrected by a device that still has an old copy.
 */
import type { CalendarEvent, Task } from '@/types';

export interface PlannerDoc {
  tasks: Task[];
  events: CalendarEvent[];
  /** id → deletion time (ms). */
  deleted: Record<string, number>;
}

const TOMBSTONE_TTL = 60 * 86_400_000;
const stamp = (x: { updatedAt?: number; createdAt: number }) => x.updatedAt ?? x.createdAt ?? 0;

function mergeList<T extends { id: string; createdAt: number; updatedAt?: number }>(a: T[], b: T[], deleted: Record<string, number>): T[] {
  const byId = new Map<string, T>();
  for (const item of [...a, ...b]) {
    const prev = byId.get(item.id);
    if (!prev || stamp(item) > stamp(prev)) byId.set(item.id, item);
  }
  return [...byId.values()].filter((item) => !(deleted[item.id] && deleted[item.id] >= stamp(item)));
}

export function mergeDocs(a: PlannerDoc, b: PlannerDoc, now = Date.now()): PlannerDoc {
  const deleted: Record<string, number> = {};
  for (const src of [a.deleted ?? {}, b.deleted ?? {}]) {
    for (const [id, ts] of Object.entries(src)) {
      if (now - ts < TOMBSTONE_TTL) deleted[id] = Math.max(deleted[id] ?? 0, ts);
    }
  }
  const order = <T extends { createdAt: number }>(xs: T[]) => xs.sort((x, y) => x.createdAt - y.createdAt);
  return {
    tasks: mergeList(a.tasks ?? [], b.tasks ?? [], deleted).sort((x, y) => y.createdAt - x.createdAt),
    events: order(mergeList(a.events ?? [], b.events ?? [], deleted)),
    deleted,
  };
}

export const emptyDoc = (): PlannerDoc => ({ tasks: [], events: [], deleted: {} });
