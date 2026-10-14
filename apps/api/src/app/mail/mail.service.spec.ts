import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { loginCodeMail } from './login-code.mail';
import { MailService } from './mail.service';

describe('MailService logs', () => {
  const resetUrl = 'https://admin.takeaway.md/reset-password?token=0f1e2d3c4b5a69788796a5b4c3d2e1f0';
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  /** Without SMTP_HOST the service only logs; with `sendMail` it sends through that transport. */
  function build(sendMail?: jest.Mock): MailService {
    const svc = new MailService({ get: () => undefined } as unknown as ConfigService);
    if (sendMail) (svc as unknown as { transporter: { sendMail: jest.Mock } }).transporter = { sendMail };
    return svc;
  }

  const lines = (spy: jest.SpyInstance) => spy.mock.calls.map(([line]) => String(line)).join('\n');

  it('never writes a password-reset link into the log when SMTP is not configured', async () => {
    await build().sendPasswordReset('ion.popescu@noname.md', resetUrl);

    const logged = lines(warn);
    expect(logged).toContain('template=password-reset');
    expect(logged).toContain('to=*@noname.md');
    expect(logged).toContain('Reset your takeAway password');
    expect(logged).not.toContain('token=');
    expect(logged).not.toContain('0f1e2d3c4b5a69788796a5b4c3d2e1f0');
    expect(logged).not.toContain('reset-password');
    expect(logged).not.toContain('ion.popescu');
  });

  it('logs no body for other messages either', async () => {
    await build().send('owner@cafe.md', 'Hello', 'secret body with a link https://x.test/?code=42');

    const logged = lines(warn);
    expect(logged).toContain('template=custom');
    expect(logged).not.toContain('secret body');
    expect(logged).not.toContain('code=42');
  });

  it('keeps the recipient to its domain when the message is sent, and when delivery fails', async () => {
    const sendMail = jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('relay down'));
    const svc = build(sendMail);

    await svc.sendPasswordReset('ion.popescu@noname.md', resetUrl);
    await svc.sendPasswordReset('ion.popescu@noname.md', resetUrl);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ion.popescu@noname.md' }));
    const logged = `${lines(log)}\n${lines(error)}`;
    expect(logged).toContain('[mail] sent template=password-reset to=*@noname.md');
    expect(logged).toContain('relay down');
    expect(logged).not.toContain('ion.popescu');
    expect(logged).not.toContain('token=');
  });

  it('logs neither the sign-in code nor the address, and says whether the letter went out', async () => {
    const letter = loginCodeMail({ code: '731905', language: 'ru', ttlMinutes: 10 });

    await expect(build().sendLoginCode('ivan.petrov@mail.ru', letter)).resolves.toBe(false);
    const sendMail = jest.fn().mockResolvedValueOnce({});
    await expect(build(sendMail).sendLoginCode('ivan.petrov@mail.ru', letter)).resolves.toBe(true);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ivan.petrov@mail.ru', text: letter.text }));
    const logged = `${lines(warn)}
${lines(log)}`;
    expect(logged).toContain('template=login-code');
    expect(logged).toContain('to=*@mail.ru');
    expect(logged).not.toContain('731905');
    expect(logged).not.toContain('ivan.petrov');
  });

  describe('sendStaffInvite', () => {
    const invite = {
      subject: 'Приглашение в команду NoName',
      text: 'Задайте пароль: https://admin.takeaway.md/reset-password?token=secret-invite-token&invite=1',
      html: '<p>secret-invite-token</p>',
    };

    it('says false without SMTP and logs only the template, domain and subject', async () => {
      await expect(build().sendStaffInvite('anna@noname.md', invite)).resolves.toBe(false);
      const logged = lines(warn);
      expect(logged).toContain('template=staff-invite');
      expect(logged).toContain('to=*@noname.md');
      expect(logged).not.toContain('secret-invite-token');
      expect(logged).not.toContain('anna');
    });

    it('says true once the server took it and false when it refused', async () => {
      const sendMail = jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('550 relay denied'));
      const svc = build(sendMail);

      await expect(svc.sendStaffInvite('anna@noname.md', invite)).resolves.toBe(true);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'anna@noname.md',
          subject: invite.subject,
          text: invite.text,
          html: invite.html,
        }),
      );
      await expect(svc.sendStaffInvite('anna@noname.md', invite)).resolves.toBe(false);
      expect(`${lines(log)}\n${lines(error)}`).not.toContain('secret-invite-token');
    });
  });
});
