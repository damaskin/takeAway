import type { BotKeyboard } from '../../telegram-bot/telegram-bot-api.service';

/** A bot message: plain text, and a button when Telegram accepts the link as one. */
export interface PasswordResetTelegramMessage {
  text: string;
  keyboard?: BotKeyboard;
}

/**
 * The «Забыли пароль?» link as a message from the bot, to the chat the
 * account linked for work notifications. Russian first, then English, like
 * the other staff messages. `account` (the email or login) says which
 * account it is about: one chat may get the messages of two accounts.
 *
 * Plain text, so nothing needs escaping. The link is in the text either
 * way; the button is added only for an https link — Telegram refuses a
 * button to `http://localhost`, which is what a developer's server builds.
 */
export function passwordResetTelegramMessage(input: {
  url: string;
  account: string;
  ttlMinutes: number;
}): PasswordResetTelegramMessage {
  const { url, account, ttlMinutes } = input;
  const who = account ? `аккаунта ${account}` : 'вашего аккаунта';
  const text = [
    'Сброс пароля takeAway',
    '',
    `Для ${who} запросили сброс пароля в кабинете takeAway. Чтобы задать новый пароль, откройте ссылку — ` +
      `она действует ${ttlMinutes} минут и сработает один раз:`,
    url,
    '',
    'Если это были не вы — просто проигнорируйте это сообщение, пароль останется прежним.',
    '',
    `takeAway password reset${account ? ` for ${account}` : ''}: open the link within ${ttlMinutes} minutes ` +
      "to set a new password. If it wasn't you, just ignore this message.",
  ].join('\n');
  if (!url.startsWith('https://')) return { text };
  return { text, keyboard: { inline_keyboard: [[{ text: 'Задать новый пароль', url }]] } };
}
