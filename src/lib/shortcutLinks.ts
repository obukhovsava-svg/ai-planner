/**
 * Ready-made Shortcuts for the iOS app, shared as iCloud links: tapping one opens «Команды»
 * straight on «Добавить команду» (no Safari, no file). Empty until the links are published —
 * then the buttons fall back to opening «Команды» with short instructions.
 */
export const SHORTCUT_LINKS = {
  /** «Обои ПЛАН» → «Установить обои» (+ automations: every morning, after closing the app). */
  wallpaper: '',
  /** Telegram version of «Обои ПЛАН»: fetches the drawn wallpaper by the personal link → «Установить обои». */
  wallpaperTelegram: 'https://www.icloud.com/shortcuts/b703e3dd94ad4efca89c9a2ad9f44752',
  /** Telegram version of the voice button «Планер» (asks for the personal link on install). */
  voiceTelegram: 'https://www.icloud.com/shortcuts/8f5edfb9ecbd4a92839e360ad5a34b57',
  /** «Добавить в ПЛАН» — the voice button for the Home Screen / Action button. */
  voice: '',
};
