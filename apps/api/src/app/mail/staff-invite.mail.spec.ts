import { type StaffInvite, staffInviteMail } from './staff-invite.mail';

const invite = (overrides: Partial<StaffInvite> = {}): StaffInvite => ({
  to: 'barista@cafe.md',
  name: 'Анна',
  brandName: 'NoName <Coffee>',
  role: 'STAFF',
  loginUrl: 'https://admin.takeaway.md/login',
  setPasswordUrl: 'https://admin.takeaway.md/reset-password?token=abc&invite=1',
  linkTtlHours: 72,
  forgotUrl: 'https://admin.takeaway.md/forgot-password',
  ...overrides,
});

describe('staffInviteMail', () => {
  it('gives a new account the set-password link, the login and the sign-in page — never a password', () => {
    const { subject, text } = staffInviteMail(invite());

    expect(subject).toContain('NoName <Coffee>');
    expect(text).toContain('Здравствуйте, Анна!');
    expect(text).toContain('Роль: Кухня');
    expect(text).toContain('Логин: barista@cafe.md');
    expect(text).toContain('https://admin.takeaway.md/login');
    expect(text).toContain('https://admin.takeaway.md/reset-password?token=abc&invite=1');
    expect(text).toContain('72');
    expect(text).toContain('PIN');
    // The owner hands the temporary password over in person; the mail only says it exists.
    expect(text).toContain('временным паролем');
    expect(text).toContain('Hi Анна,');
  });

  it('escapes names in the HTML part and links the URLs', () => {
    const { html } = staffInviteMail(invite({ name: '<script>x</script>' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('NoName &lt;Coffee&gt;');
    expect(html).toContain('<a href="https://admin.takeaway.md/reset-password?token=abc&amp;invite=1">');
    expect(html).toContain('<a href="https://admin.takeaway.md/login">');
  });

  it('only points someone who already has an account at the sign-in and reset pages', () => {
    const { text } = staffInviteMail(invite({ setPasswordUrl: null, role: 'MENU_EDITOR', name: null }));
    expect(text).not.toContain('reset-password');
    expect(text).toContain('https://admin.takeaway.md/forgot-password');
    expect(text).toContain('Редактор меню');
    expect(text).toContain('Здравствуйте!');
    expect(text).not.toContain('PIN');
  });
});
