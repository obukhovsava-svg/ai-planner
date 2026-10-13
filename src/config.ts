/**
 * Address of the AI worker (see /worker). Leave empty to use only the offline rules.
 * Not a secret: the worker only answers requests signed by Telegram for your bot.
 */
export const AI_URL = 'https://ai-planner-brain.savelyobuhov.workers.dev';

/**
 * The same worker through the Russian relay (Cloud.ru, see /relay): Russian mobile networks
 * throttle Cloudflare, so heavy uploads (the wallpaper) go this way.
 */
export const RELAY_URL = 'https://plan-relay.containerapps.ru';
