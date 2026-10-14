/** The platform's own name — the sender of platform announcements. */
export const PLATFORM_SENDER_NAME = 'takeAway';

/** Longest sender name kept whole at the start of a push title. */
const MAX_SENDER_LENGTH = 32;

/** Longest push title; a phone shows one line of it anyway. */
const MAX_TITLE_LENGTH = 110;

/** Cuts to `max` characters (code points, so an emoji is never split), ending with an ellipsis. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

/**
 * The push title of a marketing message: who sent it, then the title —
 * «NoName Coffee: −20% на капучино». A brand's campaign goes out from the
 * platform's app and bot, so without the name the customer cannot tell
 * whose it is. A long brand name is shortened first, then the whole line.
 */
export function titleWithSender(sender: string, title: string): string {
  const name = truncate(sender.trim(), MAX_SENDER_LENGTH);
  const text = title.trim();
  if (!name) return truncate(text, MAX_TITLE_LENGTH);
  return truncate(`${name}: ${text}`, MAX_TITLE_LENGTH);
}
