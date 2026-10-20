import qrcode from 'qrcode-generator';

import { qrCode } from './qr-code';

describe('qrCode', () => {
  const link = 'https://t.me/takaway_tgbot?start=link_AbCdEfGhIjKlMnOpQrStUv';

  it('draws one square per dark module of the same code the library makes', () => {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    const dark = Array.from({ length: qr.getModuleCount() ** 2 }, (_, i) =>
      qr.isDark(Math.floor(i / qr.getModuleCount()), i % qr.getModuleCount()),
    ).filter(Boolean).length;

    const code = qrCode(link);
    expect(code.size).toBe(qr.getModuleCount());
    expect(code.path.match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(dark);
  });

  it('is the same picture for the same link and another for another', () => {
    expect(qrCode(link)).toEqual(qrCode(link));
    expect(qrCode(link).path).not.toBe(qrCode(`${link}x`).path);
  });
});
