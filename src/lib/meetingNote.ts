/**
 * What an invitation's description comes down to in the planner: the point of the meeting and the
 * link to join. Outlook, Teams and Zoom fill it with dial-in numbers, meeting IDs, help links,
 * signatures and legal text.
 */
const MAX_TEXT = 400;

const JOIN_LINK = /(teams\.(microsoft|live)\.com\/(l\/meetup-join|meet|dl\/launcher)|[\w-]+\.zoom\.(us|com)\/(j|my|w)\/|meet\.google\.com\/|telemost\.(yandex|360\.yandex)\.[a-z]+\/|[\w-]+\.webex\.com\/|ktalk\.ru\/|salutejazz\.ru\/|jazz\.sber\.ru\/|call\.vk\.com\/|vk\.com\/call|mts-link\.ru\/|events\.webinar\.ru\/|trueconf|whereby\.com\/|gotomeet|meet\.jit\.si\/|join\.skype\.com\/)/i;

/** A line that opens with the service's own wording. Anchored: «Обсудим телефон клиента» stays. */
const JUNK_LINE = new RegExp(
  '^\\W*(' +
    [
      '(совещание |собрание )?microsoft teams',
      'need help',
      'нужна помощь',
      'нажмите здесь',
      '(или )?присоединиться',
      '(или )?подключиться',
      'join\\b.*\\b(meeting|meet|conversation|zoom|teams|sip|h\\.323|skype|now)',
      'meeting id',
      'идентификатор (собрания|конференции|встречи|телефонной)',
      'секретный код',
      'код (доступа|конференции)',
      'загрузить teams',
      'пароль ?:',
      'password ?:',
      'passcode',
      'phone conference',
      'dial[- ]?in',
      'dial by',
      'одним касанием',
      'one tap mobile',
      'find (a|your) local',
      'найти местный',
      'поиск локального',
      'набрать',
      'номер телефона',
      'for organizers',
      'для организаторов',
      '(meeting options|параметры (собрания|встречи))',
      'reset (dial|pin)',
      'сбросить',
      'learn more',
      'подробнее\\W*$',
      'справка\\W*$',
      'privacy and security',
      'конфиденциальность и безопасность',
      '(when|where|from|to|sent|subject|time|когда|где|от|кому|отправлено|тема|время|копия|cc) ?:',
      'time zone',
      'часовой пояс',
      '[^.\\n]{0,60} приглашает вас',
      '[^.\\n]{0,60} is inviting you',
    ].join('|') +
    ')',
  'i',
);

/** From here on it's a signature, a disclaimer or a quoted letter. */
const TAIL =
  /^\s*(с уважением|с наилучшими|всего доброго|best regards|kind regards|regards|sincerely|cheers|thanks and regards|отправлено (с|из)|sent from my|-{2,}\s*(original|исходное|пересылаемое|forwarded)|this (e-?mail|message) (is|and|may|contains)|данное (письмо|сообщение)|это (письмо|сообщение)|настоящее (письмо|сообщение)|confidential|конфиденциально|disclaimer|внимание:? (это|данное) письмо)/i;

/** Outlook's "safe links" hide the real address inside their own. */
function realUrl(raw: string): string {
  const url = raw.replace(/[>)\].,;:'"»]+$/, '');
  const m = url.match(/safelinks\.protection\.outlook\.com\/?\?url=([^&]+)/i);
  if (!m) return url;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return url;
  }
}

const URLS = /https?:\/\/[^\s<>"']+/gi;

/** `extra`: other places a calendar keeps the link (the event's URL, the location). */
export function cleanMeetingNote(raw: string | undefined, extra: (string | undefined)[] = []): string | undefined {
  const source = (raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>/gi, ' $1 ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<\/?(?!https?:)[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

  const urls = [...[...extra, source].flatMap((s) => (s ?? '').match(URLS) ?? [])].map(realUrl);
  const join = urls.find((u) => JOIN_LINK.test(u));

  const kept: string[] = [];
  for (const line of source.split('\n')) {
    if (TAIL.test(line)) break;
    // the link's in a line of its own below, and the rest of the links are the service's
    const text = line.replace(/<?https?:\/\/[^\s<>"']+>?/gi, (u) => (JOIN_LINK.test(realUrl(u)) || /safelinks|aka\.ms|microsoft\.com|zoom\.(us|com)/i.test(u) ? '' : u)).trim();
    if (!text || /^[\s_\-=*~.·•]{3,}$/.test(text)) continue;
    if (JUNK_LINE.test(text)) continue;
    if (/^[+\d][\d\s()+,#*-]{5,}/.test(text) || /^\d[\d\s]{5,}$/.test(text)) continue; // phone numbers, IDs
    kept.push(text);
  }

  let text = kept.join('\n');
  if (text.length > MAX_TEXT) {
    const cut = text.slice(0, MAX_TEXT);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = end > MAX_TEXT / 2 ? cut.slice(0, end + 1).trim() : `${cut.trim()}…`;
  }
  const result = [text, join && `Подключиться: ${join}`].filter(Boolean).join('\n\n');
  return result || undefined;
}

/** The join link of a cleaned note, for the button on the event. */
export const joinLink = (note: string | undefined): string | undefined => note?.match(/Подключиться: (https?:\/\/\S+)/)?.[1];
