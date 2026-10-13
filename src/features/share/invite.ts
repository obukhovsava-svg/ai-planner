/**
 * Growth inside Telegram: a personal invite link (the server counts who came through it) and
 * today's plan as a story picture (the same image as the lock-screen wallpaper).
 */
import { BOT_USERNAME } from '@/config';
import { getShortcutLink } from '@/lib/shortcut';
import { getTelegramUserId, openTelegramLink, shareToStory } from '@/lib/telegram';
import { uploadWallpapers } from '@/lib/wallpaper';

export const inviteLink = () => {
  const id = getTelegramUserId();
  return `https://t.me/${BOT_USERNAME}?startapp=${id ? `ref_${id}` : 'invite'}`;
};

export function inviteFriend() {
  const text = 'Планирую день в этом боте: говоришь «завтра в 10 врач, в 19 тренировка», и всё уже в календаре с напоминаниями. Бесплатно 👇';
  openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(inviteLink())}&text=${encodeURIComponent(text)}`);
}

/** Draws today's picture, puts it on the server and opens Telegram's story editor with it. */
export async function shareDayToStory(): Promise<'ok' | 'unsupported' | 'failed'> {
  const link = await getShortcutLink();
  if (!link) return 'failed';
  if (!(await uploadWallpapers(true, false))) return 'failed';
  const url = `${link.url.replace(/\/shortcut\?key=/, '/wallpaper/')}.jpg?v=${Date.now()}`;
  return shareToStory(url, `Мой план на сегодня 📋 Веду его в @${BOT_USERNAME}`) ? 'ok' : 'unsupported';
}
