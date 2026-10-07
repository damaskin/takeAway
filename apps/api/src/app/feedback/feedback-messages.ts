import { type FeedbackKind, type FeedbackSource, Locale } from '@prisma/client';

import { escapeHtml } from '../mail/mail.service';

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
  RU: { REVIEW: 'Отзыв', SUGGESTION: 'Предложение', PROBLEM: 'Проблема' },
  EN: { REVIEW: 'Review', SUGGESTION: 'Suggestion', PROBLEM: 'Problem' },
};

const SOURCE: Record<FeedbackSource, string> = {
  IOS: 'iOS',
  ANDROID: 'Android',
  WEB: 'Web',
  TMA: 'Telegram Mini App',
};

/**
 * The news in the platform team's language. The message itself stays in
 * whatever language the customer wrote it.
 */
export function feedbackDigest(locale: Locale, n: FeedbackNews): FeedbackDigest {
  const ru = locale === Locale.RU;
  const kind = KIND[ru ? Locale.RU : Locale.EN][n.kind];
  const author = [n.authorName, n.authorEmail, n.authorPhone].filter(Boolean).join(', ') || '—';
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
