import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CalendarEvent, Category, DateKey, Priority, Repeat, Task, TimeStr } from '@/types';
import { STORAGE_KEYS, storage, uid } from '@/lib/storage';

/** Something the assistant is still collecting details for. */
export interface Draft {
  title: string;
  kind?: 'event' | 'task';
  date?: DateKey;
  start?: TimeStr;
  end?: TimeStr;
  duration?: number;
  repeat?: Repeat;
  needsStart?: boolean;
  priority: Priority;
  category: Category;
}

export type Ask = 'kind' | 'date' | 'time' | 'end' | 'start-day';

export interface Candidate {
  kind: 'event' | 'task';
  id: string;
  title: string;
  /** Occurrence date for events, due date for tasks. */
  date?: DateKey;
  time?: string;
}

export type ChatAttachment =
  | { type: 'event'; event: CalendarEvent; undone?: boolean }
  | { type: 'task'; task: Task; undone?: boolean }
  | { type: 'agenda'; days: { date: DateKey; events: CalendarEvent[]; tasks: Task[] }[] }
  /** Legacy single-day agenda (messages saved by older versions). */
  | { type: 'agenda'; date: DateKey; events: CalendarEvent[]; tasks: Task[]; days?: undefined }
  | { type: 'clarify'; draft: Draft; ask: Ask; state?: 'cancelled' | 'answered' }
  | {
      type: 'choose';
      action: 'delete' | 'move' | 'complete';
      candidates: Candidate[];
      /** move: where to; delete: whether to drop the whole series. */
      target?: { date?: DateKey; start?: TimeStr; end?: TimeStr; duration?: number; all?: boolean };
      state?: 'done' | 'cancelled';
    }
  | { type: 'undo'; state?: 'done' };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachment?: ChatAttachment;
  createdAt: number;
}

/** Enough information to revert the assistant's last change. */
export type UndoEntry =
  | { op: 'created-event'; id: string }
  | { op: 'created-task'; id: string }
  | { op: 'deleted-event'; event: CalendarEvent }
  | { op: 'deleted-task'; task: Task }
  | { op: 'updated-event'; before: CalendarEvent }
  | { op: 'updated-task'; before: Task }
  | { op: 'batch'; entries: UndoEntry[] };

interface ChatState {
  messages: ChatMessage[];
  undo: UndoEntry[];
  push(msg: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage;
  update(id: string, patch: Partial<Omit<ChatMessage, 'id'>>): void;
  markUndone(id: string): void;
  pushUndo(entry: UndoEntry): void;
  popUndo(): UndoEntry | undefined;
  clear(): void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      undo: [],
      push(msg) {
        const full: ChatMessage = { ...msg, id: uid(), createdAt: Date.now() };
        set((s) => ({ messages: [...s.messages, full].slice(-80) }));
        return full;
      },
      update(id, patch) {
        set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
      },
      markUndone(id) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === id && m.attachment && (m.attachment.type === 'event' || m.attachment.type === 'task')
              ? { ...m, attachment: { ...m.attachment, undone: true } }
              : m,
          ),
        }));
      },
      pushUndo(entry) {
        set((s) => ({ undo: [...s.undo, entry].slice(-20) }));
      },
      popUndo() {
        const entry = get().undo.at(-1);
        if (entry) set((s) => ({ undo: s.undo.slice(0, -1) }));
        return entry;
      },
      clear: () => set({ messages: [], undo: [] }),
    }),
    { name: STORAGE_KEYS.chat, storage, version: 2, migrate: (s) => s as ChatState },
  ),
);
