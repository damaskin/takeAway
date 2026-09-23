import { Locale } from '@prisma/client';

import type { SupportContact } from '../config/feature-flags.service';
import { escapeHtml } from '../mail/mail.service';

/**
 * Emails about a brand's way through moderation. One language per message —
 * the recipient's — unlike the bilingual customer mails, whose recipients we
 * know nothing about.
 */
export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

export interface OwnerMail {
  ownerName: string | null;
  brandName: string;
  /** Admin panel base URL, without a trailing slash. */
  adminUrl: string;
}

export interface PlatformReview {
  kind: 'new' | 'resubmitted';
  brandName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  currency: string;
  adminUrl: string;
}

export function applicationReceivedMail(locale: Locale, p: OwnerMail): MailContent {
  if (locale === Locale.RU) {
    return render(
      `Заявка «${p.brandName}» получена`,
      [
        greetingRu(p.ownerName),
        `Спасибо, что выбрали takeAway. Мы проверим бренд «${p.brandName}» — обычно это занимает до 1 рабочего дня — и напишем, как только примем решение.`,
        'Пока идёт проверка, можно готовиться к запуску: загрузить логотип, добавить точку с адресом и часами работы и собрать меню с фото товаров.',
      ],
      { label: 'Открыть панель управления', url: `${p.adminUrl}/dashboard` },
      SIGN_OFF_RU,
    );
  }
  return render(
    `We've received your application for ${p.brandName}`,
    [
      greetingEn(p.ownerName),
      `Thanks for choosing takeAway. We'll review ${p.brandName} — usually within one business day — and email you as soon as we've decided.`,
      'While you wait, you can get ready for launch: upload your logo, add a store with its address and opening hours, and build a menu with product photos.',
    ],
    { label: 'Open the admin panel', url: `${p.adminUrl}/dashboard` },
    SIGN_OFF_EN,
  );
}

export function brandApprovedMail(locale: Locale, p: OwnerMail): MailContent {
  if (locale === Locale.RU) {
    return render(
      `Бренд «${p.brandName}» одобрен`,
      [
        greetingRu(p.ownerName),
        `Бренд «${p.brandName}» прошёл проверку и теперь виден покупателям takeAway.`,
        'Проверьте, что у точки указаны часы работы, а в меню есть товары с фото, — и можно принимать первые заказы.',
      ],
      { label: 'Открыть панель управления', url: `${p.adminUrl}/dashboard` },
      SIGN_OFF_RU,
    );
  }
  return render(
    `${p.brandName} is approved`,
    [
      greetingEn(p.ownerName),
      `${p.brandName} has passed review and is now visible to takeAway customers.`,
      'Check that your store has opening hours and your menu has products with photos — then you are ready for your first orders.',
    ],
    { label: 'Open the admin panel', url: `${p.adminUrl}/dashboard` },
    SIGN_OFF_EN,
  );
}

export function brandRejectedMail(
  locale: Locale,
  p: OwnerMail & { reason: string | null; support: SupportContact },
): MailContent {
  const contacts = [p.support.email, p.support.telegram].filter(Boolean).join(', ');
  if (locale === Locale.RU) {
    return render(
      `Бренд «${p.brandName}»: нужны правки`,
      [
        greetingRu(p.ownerName),
        `Мы проверили бренд «${p.brandName}» и пока не можем опубликовать его на витрине.`,
        p.reason
          ? `Комментарий модератора: ${p.reason}`
          : 'Модератор не оставил комментария — напишите нам, и мы подскажем, что исправить.',
        'Внесите правки и нажмите «Исправить и отправить повторно» в панели управления — мы проверим бренд ещё раз.',
        ...(contacts ? [`Если остались вопросы, напишите в поддержку: ${contacts}.`] : []),
      ],
      { label: 'Открыть панель управления', url: `${p.adminUrl}/dashboard` },
      SIGN_OFF_RU,
    );
  }
  return render(
    `${p.brandName}: changes needed`,
    [
      greetingEn(p.ownerName),
      `We've reviewed ${p.brandName} and can't publish it to the storefront yet.`,
      p.reason
        ? `Reviewer's note: ${p.reason}`
        : "The reviewer didn't leave a note — write to us and we'll tell you what to fix.",
      'Make the changes, then press "Fix and resubmit" in the admin panel and we will review it again.',
      ...(contacts ? [`Questions? Write to support: ${contacts}.`] : []),
    ],
    { label: 'Open the admin panel', url: `${p.adminUrl}/dashboard` },
    SIGN_OFF_EN,
  );
}

/** To each platform admin: a brand is waiting for a decision. */
export function platformReviewMail(locale: Locale, p: PlatformReview): MailContent {
  const owner = ownerLine(p);
  if (locale === Locale.RU) {
    return render(
      p.kind === 'new' ? `Новая заявка на модерацию: ${p.brandName}` : `Повторная заявка на модерацию: ${p.brandName}`,
      [
        p.kind === 'new'
          ? `Бизнес «${p.brandName}» зарегистрировался и ждёт модерации.`
          : `Бренд «${p.brandName}» внёс правки и снова ждёт модерации.`,
        `Владелец: ${owner}. Валюта: ${p.currency}.`,
        'Владельцам мы обещаем решение в течение 1 рабочего дня.',
      ],
      { label: 'Открыть модерацию', url: `${p.adminUrl}/brands` },
    );
  }
  return render(
    p.kind === 'new' ? `New brand to review: ${p.brandName}` : `Brand resubmitted for review: ${p.brandName}`,
    [
      p.kind === 'new'
        ? `${p.brandName} has signed up and is waiting for review.`
        : `${p.brandName} has made changes and is waiting for review again.`,
      `Owner: ${owner}. Currency: ${p.currency}.`,
      'Owners are promised a decision within one business day.',
    ],
    { label: 'Open moderation', url: `${p.adminUrl}/brands` },
  );
}

/** The same news for the ops chat, in the language of the other ops alerts. */
export function platformReviewChatText(p: PlatformReview): string {
  const head = p.kind === 'new' ? 'New brand to review' : 'Brand resubmitted for review';
  return `${head}: ${p.brandName} — ${ownerLine(p)}, ${p.currency}. ${p.adminUrl}/brands`;
}

const SIGN_OFF_RU = '— Команда takeAway';
const SIGN_OFF_EN = '— The takeAway team';

function greetingRu(name: string | null): string {
  return name ? `Здравствуйте, ${name}!` : 'Здравствуйте!';
}

function greetingEn(name: string | null): string {
  return name ? `Hi ${name},` : 'Hi there,';
}

function ownerLine(p: PlatformReview): string {
  return [p.ownerName, p.ownerEmail, p.ownerPhone].filter(Boolean).join(', ') || '—';
}

function render(
  subject: string,
  body: string[],
  action: { label: string; url: string },
  signOff?: string,
): MailContent {
  const closing = signOff ? [signOff] : [];
  const text = [...body, `${action.label}: ${action.url}`, ...closing].join('\n\n');
  const html = [
    ...body.map((p) => `<p>${escapeHtml(p)}</p>`),
    `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>`,
    ...closing.map((p) => `<p>${escapeHtml(p)}</p>`),
  ].join('\n');
  return { subject, text, html };
}
