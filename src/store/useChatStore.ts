import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CalendarEvent, DateKey, Task } from '@/types';
import { STORAGE_KEYS, storage, uid } from '@/lib/storage';

export type ChatAttachment =
  | { type: 'event'; event: CalendarEvent; undone?: boolean }
  | { type: 'task'; task: Task; undone?: boolean }
  | { type: 'agenda'; date: DateKey; events: CalendarEvent[]; tasks: Task[] };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachment?: ChatAttachment;
  createdAt: number;
}

interface ChatState {
  messages: ChatMessage[];
  push(msg: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage;
  markUndone(id: string): void;
  clear(): void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      push(msg) {
        const full: ChatMessage = { ...msg, id: uid(), createdAt: Date.now() };
        set((s) => ({ messages: [...s.messages, full].slice(-60) }));
        return full;
      },
      markUndone(id) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === id && m.attachment && m.attachment.type !== 'agenda'
              ? { ...m, attachment: { ...m.attachment, undone: true } }
              : m,
          ),
        }));
      },
      clear: () => set({ messages: [] }),
    }),
    { name: STORAGE_KEYS.chat, storage },
  ),
);
