import { loginCodeMail } from './login-code.mail';

describe('loginCodeMail', () => {
  it('says it in Russian, briefly, without naming any brand but takeAway', () => {
    const { subject, text, html } = loginCodeMail({ code: '042917', language: 'ru', ttlMinutes: 10 });

    expect(subject).toBe('Код для входа в takeAway');
    expect(text).toBe(
      'Код для входа в takeAway: 042917. Он действует 10 минут.\n\n' +
        'Если вы не запрашивали код — просто проигнорируйте письмо.',
    );
    expect(html).toContain('>042917</p>');
    expect(html).toContain('Он действует 10 минут.');
  });

  it('says it in English', () => {
    const { subject, text } = loginCodeMail({ code: '042917', language: 'en', ttlMinutes: 10 });

    expect(subject).toBe('Your takeAway sign-in code');
    expect(text).toBe(
      'Your takeAway sign-in code: 042917. It is valid for 10 minutes.\n\n' +
        'If you did not request a code, just ignore this email.',
    );
  });

  it.each([
    [1, 'минуту'],
    [3, 'минуты'],
    [5, 'минут'],
    [11, 'минут'],
    [21, 'минуту'],
  ])('words %i minutes in Russian', (minutes, word) => {
    expect(loginCodeMail({ code: '000000', language: 'ru', ttlMinutes: minutes }).text).toContain(
      `действует ${minutes} ${word}.`,
    );
  });

  it('never puts the code in the subject, which MailService logs', () => {
    for (const language of ['ru', 'en'] as const) {
      expect(loginCodeMail({ code: '731905', language, ttlMinutes: 10 }).subject).not.toContain('731905');
    }
  });
});
