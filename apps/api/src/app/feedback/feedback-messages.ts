import { type BrandPlan, type FeedbackKind, type FeedbackSource, Locale } from '@prisma/client';

import { escapeHtml } from '../mail/mail.service';

/** The brand behind a message from the business admin. */
export interface FeedbackBrand {
  name: string;
  /** The number the platform team calls the business on, E.164. */
  contactPhone: string | null;
  plan: BrandPlan;
  /** The plan the owner asked for, on a plan-change request. */
  requestedPlan: BrandPlan | null;
}

/** A new feedback, as the platform team is told about it. */
export interface FeedbackNews {
  kind: FeedbackKind;
  source: FeedbackSource;
  appVersion: string | null;
  message: string;
  contact: string | null;
  authorName: string | null;
  authorEmail: string | null;
  authorPhone: string | null;
  /**
   * A visitor without an account, from the site's support form: there is no
   * account to name, `contact` is how to answer, and this is the name they
   * gave, if any.
   */
  guest?: { name: string | null } | null;
  /** Set on messages from the business admin (`source` BUSINESS). */
  brand?: FeedbackBrand | null;
  /** Admin panel base URL, without a trailing slash. */
  adminUrl: string;
}

/** One message, split so each channel can lay it out its own way. */
export interface FeedbackDigest {
  /** Headline: what kind of feedback, from whom. */
  title: string;
  /** Who and where from, then the customer's own words. */
  lines: string[];
  /** Where to read and answer it in the admin. */
  link: { label: string; url: string };
}

const KIND: Record<Locale, Record<FeedbackKind, string>> = {
  RU: {
    REVIEW: 'Отзыв',
    SUGGESTION: 'Предложение',
    PROBLEM: 'Проблема',
    QUESTION: 'Вопрос',
    PLAN_CHANGE: 'Смена тарифа',
  },
  EN: {
    REVIEW: 'Review',
    SUGGESTION: 'Suggestion',
    PROBLEM: 'Problem',
    QUESTION: 'Question',
    PLAN_CHANGE: 'Plan change',
  },
};

const SOURCE: Record<FeedbackSource, string> = {
  IOS: 'iOS',
  ANDROID: 'Android',
  WEB: 'Web',
  TMA: 'Telegram Mini App',
  BUSINESS: 'Business admin',
};

/**
 * The news in the platform team's language. The message itself stays in
 * whatever language the customer wrote it.
 */
export function feedbackDigest(locale: Locale, n: FeedbackNews): FeedbackDigest {
  if (n.brand) return businessDigest(locale, n, n.brand);
  const ru = locale === Locale.RU;
  const kind = KIND[ru ? Locale.RU : Locale.EN][n.kind];
  const author = n.guest
    ? `${n.guest.name || '—'} (${ru ? 'без аккаунта' : 'no account'})`
    : [n.authorName, n.authorEmail, n.authorPhone].filter(Boolean).join(', ') || '—';
  const platform = n.appVersion ? `${SOURCE[n.source]} ${n.appVersion}` : SOURCE[n.source];
  const lines = [
    `${ru ? 'От' : 'From'}: ${author} · ${platform}`,
    ...(n.contact ? [`${ru ? 'Как связаться' : 'Contact'}: ${n.contact}`] : []),
    '',
    n.message,
  ];
  return {
    title: ru ? `Обратная связь: ${kind.toLowerCase()}` : `Customer feedback: ${kind.toLowerCase()}`,
    lines,
    link: { label: ru ? 'Открыть в панели' : 'Open in the admin', url: `${n.adminUrl}/feedback` },
  };
}

/**
 * A business writing to support, or asking for another plan: which brand,
 * the number to call back, and — for a plan change — what they want.
 */
function businessDigest(locale: Locale, n: FeedbackNews, brand: FeedbackBrand): FeedbackDigest {
  const ru = locale === Locale.RU;
  const kind = KIND[ru ? Locale.RU : Locale.EN][n.kind];
  const author = [n.authorName, n.authorEmail, n.authorPhone].filter(Boolean).join(', ') || '—';
  const planChange = n.kind === 'PLAN_CHANGE';
  const lines = [
    `${ru ? 'Бренд' : 'Brand'}: ${brand.name} · ${ru ? 'тариф' : 'plan'} ${brand.plan}`,
    `${ru ? 'Телефон бренда' : 'Brand phone'}: ${brand.contactPhone ?? '—'}`,
    `${ru ? 'Пишет' : 'From'}: ${author}`,
    ...(planChange && brand.requestedPlan
      ? [`${ru ? 'Хочет перейти на' : 'Wants to move to'}: ${brand.requestedPlan}`]
      : []),
    ...(n.message ? ['', n.message] : []),
  ];
  return {
    title: planChange
      ? ru
        ? `Заявка на смену тарифа: ${brand.name}`
        : `Plan change request: ${brand.name}`
      : ru
        ? `Поддержка бизнеса: ${kind.toLowerCase()} — ${brand.name}`
        : `Business support: ${kind.toLowerCase()} — ${brand.name}`,
    lines,
    link: {
      label: ru ? 'Открыть в панели' : 'Open in the admin',
      url: `${n.adminUrl}/${planChange ? 'brands' : 'feedback'}`,
    },
  };
}

/** Plain text for the ops chat: no markup, so nothing the customer typed can break it. */
export function feedbackChatText(d: FeedbackDigest): string {
  return [`💬 ${d.title}`, ...d.lines, '', d.link.url].join('\n');
}

/** Title and body for a platform admin's own Telegram chat with the bot. */
export function feedbackPush(d: FeedbackDigest): { title: string; body: string } {
  return { title: d.title, body: [...d.lines, '', d.link.url].join('\n') };
}

export function feedbackMail(d: FeedbackDigest): { subject: string; text: string; html: string } {
  const text = [...d.lines, '', `${d.link.label}: ${d.link.url}`].join('\n');
  const html = [
    ...d.lines.filter((l) => l !== '').map((l) => `<p style="white-space: pre-wrap">${escapeHtml(l)}</p>`),
    `<p><a href="${escapeHtml(d.link.url)}">${escapeHtml(d.link.label)}</a></p>`,
  ].join('\n');
  return { subject: d.title, text, html };
}
