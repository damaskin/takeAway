import { TestBed } from '@angular/core/testing';
import qrcode from 'qrcode-generator';

import { QrCodeComponent } from './qr-code.component';

describe('QrCodeComponent', () => {
  const invoice = 'QRT000000000000123:12.50:4200000017';

  function render(text: string, label = '') {
    const fixture = TestBed.createComponent(QrCodeComponent);
    fixture.componentRef.setInput('text', text);
    fixture.componentRef.setInput('label', label);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws one square per dark module of the code the library makes, inside a quiet zone', () => {
    const qr = qrcode(0, 'M');
    qr.addData(invoice);
    qr.make();
    const size = qr.getModuleCount();
    let dark = 0;
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) if (qr.isDark(row, col)) dark++;

    const el = render(invoice, 'QR-код для оплаты');
    const svg = el.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe(`-4 -4 ${size + 8} ${size + 8}`);
    expect(svg?.getAttribute('aria-label')).toBe('QR-код для оплаты');
    expect(
      el
        .querySelector('path')
        ?.getAttribute('d')
        ?.match(/M\d+ \d+h1v1h-1z/g),
    ).toHaveLength(dark);
  });

  it('draws another picture for another text, and nothing for none', () => {
    const first = render(invoice).querySelector('path')?.getAttribute('d');
    const second = render(`${invoice}1`).querySelector('path')?.getAttribute('d');
    expect(first).not.toBe(second);
    expect(render('').querySelector('svg')).toBeNull();
  });
});
