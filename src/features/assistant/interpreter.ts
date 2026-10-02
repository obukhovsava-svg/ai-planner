/**
 * Turns a user utterance into an action + assistant reply.
 *
 * Today: the offline rule-based parser in `lib/parser.ts`.
 * Later: implement `CommandInterpreter` with a call to your backend/LLM
 * (returning the same `ParsedCommand` shape) and swap `interpreter` below.
 */
import { parseCommand, type ParsedCommand } from '@/lib/parser';
import { usePlannerStore } from '@/store/usePlannerStore';
import type { ChatAttachment } from '@/store/useChatStore';
import { CATEGORY_TO_COLOR } from '@/lib/meta';
import { humanDate } from '@/lib/date';

export interface CommandInterpreter {
  parse(text: string): Promise<ParsedCommand | null>;
}

export const localInterpreter: CommandInterpreter = {
  parse: async (text) => parseCommand(text),
};

const interpreter: CommandInterpreter = localInterpreter;

export interface AssistantReply {
  text: string;
  attachment?: ChatAttachment;
}

export async function handleUtterance(text: string): Promise<AssistantReply> {
  const cmd = await interpreter.parse(text);
  const store = usePlannerStore.getState();

  if (!cmd) {
    return { text: 'Не расслышал. Попробуйте, например: «Встреча завтра в 15:00».' };
  }

  if (cmd.kind === 'agenda') {
    const events = store.events.filter((e) => e.date === cmd.date).sort((a, b) => a.start.localeCompare(b.start));
    const tasks = store.tasks.filter((t) => t.date === cmd.date && !t.done);
    const when = humanDate(cmd.date).toLowerCase();
    return {
      text: events.length || tasks.length ? `Вот что запланировано на ${when}:` : `На ${when} ничего не запланировано — свободный день ✨`,
      attachment: events.length || tasks.length ? { type: 'agenda', date: cmd.date, events, tasks } : undefined,
    };
  }

  if (cmd.kind === 'event') {
    const event = store.addEvent({
      title: cmd.title,
      date: cmd.date!,
      start: cmd.start!,
      end: cmd.end!,
      color: CATEGORY_TO_COLOR[cmd.category],
    });
    return {
      text: `Добавил в календарь на ${humanDate(event.date).toLowerCase()}, ${event.start}.`,
      attachment: { type: 'event', event },
    };
  }

  const task = store.addTask({
    title: cmd.title,
    date: cmd.date,
    time: cmd.start,
    priority: cmd.priority,
    category: cmd.category,
  });
  return {
    text: task.date ? `Создал задачу на ${humanDate(task.date).toLowerCase()}.` : 'Добавил задачу во «Входящие».',
    attachment: { type: 'task', task },
  };
}
