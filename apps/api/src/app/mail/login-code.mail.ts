import { escapeHtml, type OutgoingMail } from './mail.service';

export type LoginCodeLanguage = 'ru' | 'en';

export interface LoginCode {
  /** The six digits. Never part of the subject: MailService logs subjects. */
  code: string;
  language: LoginCodeLanguage;
  /** How long the code works. */
  ttlMinutes: number;
}

/**
 * The customer sign-in code. One language — the one the customer asked in —
 * short and brand-neutral: the same letter serves every brand's customers.
 */
export function loginCodeMail({ code, language, ttlMinutes }: LoginCode): OutgoingMail {
  const copy =
    language === 'ru'
      ? {
          subject: 'Код для входа в takeAway',
          lead: 'Код для входа в takeAway:',
          validity: `Он действует ${ttlMinutes} ${minutesRu(ttlMinutes)}.`,
          ignore: 'Если вы не запрашивали код — просто проигнорируйте письмо.',
        }
      : {
          subject: 'Your takeAway sign-in code',
          lead: 'Your takeAway sign-in code:',
          validity: `It is valid for ${ttlMinutes} ${ttlMinutes === 1 ? 'minute' : 'minutes'}.`,
          ignore: 'If you did not request a code, just ignore this email.',
        };

  const text = `${copy.lead} ${code}. ${copy.validity}\n\n${copy.ignore}`;
  const html = `
      <p>${escapeHtml(copy.lead)}</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${escapeHtml(code)}</p>
      <p>${escapeHtml(copy.validity)}</p>
      <p style="color:#777">${escapeHtml(copy.ignore)}</p>
    `;
  return { subject: copy.subject, text, html };
}

/** «минуту», «минуты» or «минут» after a number, as in «действует 10 минут». */
function minutesRu(n: number): string {
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'минут';
  if (last === 1) return 'минуту';
  if (last >= 2 && last <= 4) return 'минуты';
  return 'минут';
}
