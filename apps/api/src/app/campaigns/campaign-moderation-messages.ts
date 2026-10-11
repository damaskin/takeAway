import { type CampaignAudience, type CampaignChannel, Locale } from '@prisma/client';

/** A campaign waiting for review, as the platform team is told about it. */
export interface CampaignSubmission {
  brandName: string;
  title: string;
  body: string;
  channel: CampaignChannel;
  audience: CampaignAudience;
  /** INACTIVE: days without an order. */
  inactiveDays: number | null;
  /** People the audience matches right now. */
  audienceSize: number;
  scheduledAt: Date | null;
  /** Admin panel base URL, without a trailing slash. */
  adminUrl: string;
}

const CHANNEL: Record<Locale, Record<CampaignChannel, string>> = {
  RU: { PUSH: 'push', TELEGRAM: 'Telegram', EMAIL: 'email' },
  EN: { PUSH: 'push', TELEGRAM: 'Telegram', EMAIL: 'email' },
};

const AUDIENCE: Record<Locale, Record<CampaignAudience, string>> = {
  RU: {
    ALL: 'все клиенты',
    HAS_ORDERED: 'с оплаченным заказом',
    INACTIVE_30D: 'не возвращались 30+ дней',
    INACTIVE: 'неактивные клиенты',
  },
  EN: {
    ALL: 'all customers',
    HAS_ORDERED: 'with a paid order',
    INACTIVE_30D: 'inactive for 30+ days',
    INACTIVE: 'inactive customers',
  },
};

/** «неактивные клиенты, 7 дн. без заказа» — the segment's window when there is one. */
function audienceLabel(lang: Locale, s: CampaignSubmission): string {
  const base = AUDIENCE[lang][s.audience];
  if (s.audience !== 'INACTIVE' || !s.inactiveDays) return base;
  return lang === Locale.RU
    ? `${base}, ${s.inactiveDays} дн. без заказа`
    : `${base}, no order for ${s.inactiveDays} days`;
}

/** Long copy is cut in the alert; the queue page shows all of it. */
const BODY_PREVIEW = 400;

/**
 * Plain text for the ops chat, in the platform team's language. No markup,
 * so nothing a business typed can break the message.
 */
export function campaignSubmittedChatText(locale: Locale, s: CampaignSubmission): string {
  const ru = locale === Locale.RU;
  const lang = ru ? Locale.RU : Locale.EN;
  const body = s.body.length > BODY_PREVIEW ? `${s.body.slice(0, BODY_PREVIEW)}…` : s.body;
  const when = s.scheduledAt
    ? `${ru ? 'Отправить' : 'Send at'}: ${s.scheduledAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`
    : ru
      ? 'Отправить сразу после одобрения'
      : 'Sends as soon as it is approved';
  return [
    `📣 ${ru ? 'Рассылка на модерации' : 'Campaign to review'}: ${s.brandName}`,
    `${ru ? 'Канал' : 'Channel'}: ${CHANNEL[lang][s.channel]} · ${ru ? 'аудитория' : 'audience'}: ${audienceLabel(lang, s)} (${s.audienceSize})`,
    when,
    '',
    s.title,
    body,
    '',
    `${s.adminUrl}/campaign-moderation`,
  ].join('\n');
}
