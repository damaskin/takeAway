import { escapeHtml, type OutgoingMail } from './mail.service';

/** The staff roles an invite can carry. */
export type StaffInviteRole = 'STORE_MANAGER' | 'STAFF' | 'MENU_EDITOR';

export interface StaffInvite {
  to: string;
  name: string | null;
  /** The brand(s) of the stores the person was added to. */
  brandName: string;
  role: StaffInviteRole;
  /** The cabinet's sign-in page. */
  loginUrl: string;
  /** One-time "set your password" link — only for an account created by this invite. */
  setPasswordUrl: string | null;
  /** How long {@link setPasswordUrl} stays valid. */
  linkTtlHours: number;
  /** "Forgot password" page, for someone who already had an account. */
  forgotUrl: string;
}

const ROLE_NAMES: Record<StaffInviteRole, { ru: string; en: string }> = {
  STORE_MANAGER: { ru: 'Менеджер', en: 'a manager' },
  STAFF: { ru: 'Кухня', en: 'kitchen staff' },
  MENU_EDITOR: { ru: 'Редактор меню', en: 'a menu editor' },
};

/**
 * The invite to a brand's team in the business cabinet, Russian with an
 * English copy below like the other staff mails. A new account gets a
 * one-time link to set its own password; the temporary password the owner
 * typed is never mailed — the owner hands it over in person, and either way
 * works. Someone who already has an account is only told where to sign in.
 */
export function staffInviteMail(invite: StaffInvite): OutgoingMail {
  const role = ROLE_NAMES[invite.role];
  const subject = `Приглашение в команду ${invite.brandName} / Your invite to ${invite.brandName} on takeAway`;

  const ru: string[] = [
    invite.name ? `Здравствуйте, ${invite.name}!` : 'Здравствуйте!',
    '',
    `Вас добавили в команду «${invite.brandName}» в takeAway. Роль: ${role.ru}.`,
    '',
    `Кабинет: ${invite.loginUrl}`,
    `Логин: ${invite.to}`,
    '',
  ];
  const en: string[] = [
    invite.name ? `Hi ${invite.name},` : 'Hi,',
    '',
    `You have been added to the ${invite.brandName} team on takeAway as ${role.en}.`,
    '',
    `Sign in at: ${invite.loginUrl}`,
    `Login: ${invite.to}`,
    '',
  ];
  if (invite.setPasswordUrl) {
    ru.push(
      `Задайте свой пароль по ссылке (одноразовая, действует ${invite.linkTtlHours} ч):`,
      invite.setPasswordUrl,
      '',
      'Или войдите с временным паролем, который вам передал владелец, — при первом входе система попросит его сменить.',
    );
    en.push(
      `Set your own password with this one-time link (valid for ${invite.linkTtlHours} hours):`,
      invite.setPasswordUrl,
      '',
      'Or sign in with the temporary password the owner gave you — you will be asked to change it on first sign-in.',
    );
  } else {
    ru.push(`Входите со своим текущим паролем. Забыли его — восстановите здесь: ${invite.forgotUrl}`);
    en.push(`Sign in with the password you already have. Forgot it? Reset it here: ${invite.forgotUrl}`);
  }
  if (invite.role === 'STAFF' || invite.role === 'STORE_MANAGER') {
    ru.push('', 'На планшете кухни можно входить по PIN-коду — его задаёт владелец на странице «Сотрудники».');
    en.push('', 'On the kitchen tablet you can sign in with a PIN — the owner sets it on the Staff page.');
  }

  const text = [...ru, '', '--', '', ...en].join('\n');
  const html = `${paragraphs(ru)}\n<hr />\n${paragraphs(en)}`;
  return { subject, text, html };
}

export interface StaffPasswordReset {
  to: string;
  name: string | null;
  /** The brand(s) of the stores the person works at. */
  brandName: string;
  /** The cabinet's sign-in page. */
  loginUrl: string;
  /** One-time "set your password" link. */
  setPasswordUrl: string;
  /** How long {@link setPasswordUrl} stays valid. */
  linkTtlHours: number;
}

/**
 * The owner reset an employee's password on the Staff page: the old one no
 * longer works and every session was ended. A one-time link to set a new
 * one; the temporary password the owner got instead is never mailed — the
 * owner hands it over in person, and either way works.
 */
export function staffPasswordResetMail(reset: StaffPasswordReset): OutgoingMail {
  const subject = `Пароль сброшен — ${reset.brandName} / Your takeAway password was reset`;
  const ru: string[] = [
    reset.name ? `Здравствуйте, ${reset.name}!` : 'Здравствуйте!',
    '',
    `Владелец «${reset.brandName}» сбросил ваш пароль в кабинете takeAway. Старый пароль больше не действует, вход на всех устройствах завершён.`,
    '',
    `Задайте новый пароль по ссылке (одноразовая, действует ${reset.linkTtlHours} ч):`,
    reset.setPasswordUrl,
    '',
    'Или войдите с временным паролем, который вам передаст владелец, — система попросит его сменить.',
    '',
    `Кабинет: ${reset.loginUrl}`,
    `Логин: ${reset.to}`,
  ];
  const en: string[] = [
    reset.name ? `Hi ${reset.name},` : 'Hi,',
    '',
    `The owner of ${reset.brandName} reset your takeAway password. The old password no longer works and you were signed out everywhere.`,
    '',
    `Set a new password with this one-time link (valid for ${reset.linkTtlHours} hours):`,
    reset.setPasswordUrl,
    '',
    'Or sign in with the temporary password the owner gives you — you will be asked to change it.',
    '',
    `Sign in at: ${reset.loginUrl}`,
    `Login: ${reset.to}`,
  ];
  const text = [...ru, '', '--', '', ...en].join('\n');
  const html = `${paragraphs(ru)}\n<hr />\n${paragraphs(en)}`;
  return { subject, text, html };
}

/** Blank lines split paragraphs, single newlines become <br />, URLs become links. */
function paragraphs(lines: string[]): string {
  return lines
    .join('\n')
    .split(/\n{2,}/)
    .map((block) => `<p>${block.split('\n').map(linkify).join('<br />')}</p>`)
    .join('\n');
}

/** Escapes a line for HTML and turns the URLs in it into links. */
function linkify(line: string): string {
  return escapeHtml(line).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
}
