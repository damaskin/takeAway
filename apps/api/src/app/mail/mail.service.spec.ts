import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { MailService } from './mail.service';

/** A MailService whose transport is a spy (or absent, like a server without SMTP_HOST). */
function build(transport: { sendMail: jest.Mock } | null) {
  const config = { get: (key: string) => (key === 'SMTP_FROM' ? 'takeAway <no-reply@takeaway.md>' : undefined) };
  const mail = new MailService(config as unknown as ConfigService);
  (mail as unknown as { transporter: unknown }).transporter = transport;
  return mail;
}

const message = {
  subject: 'Invite',
  text: 'Set your password: https://admin.takeaway.md/reset-password?token=secret-token',
  html: '<p>secret-token</p>',
};

describe('MailService.deliver', () => {
  afterEach(() => jest.restoreAllMocks());

  it('answers false without SMTP and keeps the body — and its one-time link — out of the log', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(build(null).deliver('a@b.md', message)).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret-token');
  });

  it('answers true once the server took it, false when it refused', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const sendMail = jest.fn().mockResolvedValue({});
    await expect(build({ sendMail }).deliver('a@b.md', message)).resolves.toBe(true);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'takeAway <no-reply@takeaway.md>',
      to: 'a@b.md',
      subject: 'Invite',
      text: message.text,
      html: message.html,
    });

    sendMail.mockRejectedValue(new Error('550 relay denied'));
    await expect(build({ sendMail }).deliver('a@b.md', message)).resolves.toBe(false);
  });
});
