import { type CampaignAudience, type CampaignChannel, Locale } from '@prisma/client';

import { escapeHtml } from '../mail/mail.service';

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

/** The moderator's decision, as the brand owner is told about it. */
export interface CampaignDecision {
  campaignId: string;
  title: string;
  approved: boolean;
  /** The rejection reason; null on approval. */
  reason: string | null;
  /** When an approved campaign goes out; null — right away. */
  scheduledAt: Date | null;
  /** The brand's time zone for that time (its stores' prevailing one), IANA. */
  timeZone: string;
  /** Admin panel base URL, without a trailing slash. */
  adminUrl: string;
}

/** One decision, laid out for the bot (title + body) and for email. */
export interface CampaignDecisionMessage {
  title: string;
  body: string;
  subject: string;
  text: string;
  html: string;
}

/** In the brand's language: the owner reads it, not the platform team. */
export function campaignDecisionMessage(locale: Locale, d: CampaignDecision): CampaignDecisionMessage {
  const ru = locale === Locale.RU;
  const when = d.scheduledAt
    ? new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: d.timeZone,
      }).format(d.scheduledAt)
    : null;
  const link = `${d.adminUrl}/campaigns${d.approved ? '' : `/${d.campaignId}`}`;
  const title = d.approved
    ? ru
      ? `Рассылка «${d.title}» одобрена`
      : `Campaign «${d.title}» approved`
    : ru
      ? `Рассылка «${d.title}» отклонена`
      : `Campaign «${d.title}» rejected`;
  const lines = d.approved
    ? [
        when
          ? ru
            ? `Она уйдёт клиентам ${when}.`
            : `It goes out to your customers on ${when}.`
          : ru
            ? 'Она уже уходит клиентам — результат появится в списке рассылок.'
            : 'It is going out to your customers now — the result shows up in the campaign list.',
      ]
    : [
        `${ru ? 'Причина' : 'Reason'}: ${d.reason ?? '—'}`,
        ru
          ? 'Исправьте рассылку и отправьте её на модерацию снова.'
          : 'Fix the campaign and submit it for review again.',
      ];
  const linkLabel = ru ? 'Открыть рассылки' : 'Open campaigns';
  return {
    title,
    body: [...lines, '', link].join('\n'),
    subject: title,
    text: [...lines, '', `${linkLabel}: ${link}`].join('\n'),
    html: [
      ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
      `<p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel)}</a></p>`,
    ].join('\n'),
  };
}
