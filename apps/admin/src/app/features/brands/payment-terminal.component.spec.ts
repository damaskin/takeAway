import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { PaymentTerminalView } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { PaymentTerminalService } from '../../core/brands/payment-terminal.service';
import { PaymentTerminalComponent } from './payment-terminal.component';

const unset = { set: false, last4: null };
const noCert = { set: false, subject: null, validTo: null };

/** A brand whose QR payments land on its own terminal; cards still on takeAway's default one. */
const VIEW: PaymentTerminalView = {
  brandId: 'b1',
  id: 'term-1',
  card: {
    source: 'NONE',
    merchantId: null,
    terminalId: null,
    privateKey: unset,
    certificate: noCert,
    bankCertificate: noCert,
  },
  web: { source: 'NONE', merchantLogin: null, merchantId: null, merchantPass: unset, bankCertificate: noCert },
  qr: {
    source: 'BRAND',
    terminalId: 'QRT123456789012345',
    login: 'noname',
    password: { set: true, last4: '9876' },
    externalToken: unset,
  },
  holdUntilAccepted: false,
  isTest: false,
  note: null,
  updatedAt: '2026-11-17T10:00:00Z',
  updatedByName: 'Иван',
  defaultTerminal: {
    card: { configured: true, merchantId: 'M00012345', terminalId: 'E1043280' },
    web: { configured: false, merchantLogin: null },
    qr: { configured: true, terminalId: 'QRT169007299815722' },
  },
};

function setup(view: PaymentTerminalView = VIEW) {
  const api = {
    get: jest.fn().mockReturnValue(of(view)),
    save: jest.fn().mockReturnValue(of(view)),
    remove: jest.fn().mockReturnValue(of({ ...view, id: null, qr: { ...view.qr, source: 'NONE' } })),
    check: jest
      .fn()
      .mockReturnValue(of({ checks: [{ flow: 'qr', outcome: 'OK', message: 'Банк ответил: счёта нет' }] })),
  };
  TestBed.configureTestingModule({
    imports: [PaymentTerminalComponent],
    providers: [provideTranslateService(), { provide: PaymentTerminalService, useValue: api }],
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
  translate.use('ru');
  const fixture = TestBed.createComponent(PaymentTerminalComponent);
  fixture.componentRef.setInput('brandId', 'b1');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const byTestId = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (id: string) => {
    byTestId(id)?.click();
    fixture.detectChanges();
  };
  const type = (selector: string, value: string) => {
    const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!input) throw new Error(`no ${selector}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  return { fixture, api, el, byTestId, click, type };
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('PaymentTerminalComponent («Платёжный терминал»)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('loads only when opened and says which flows the brand takes on its own terminal, and which not at all', () => {
    const { api, click, byTestId } = setup();
    expect(api.get).not.toHaveBeenCalled();
    click('payment-terminal-toggle');

    expect(api.get).toHaveBeenCalledWith('b1');
    const flows = text(byTestId('payment-terminal-flows'));
    expect(flows).toContain('Привязанные карты: нет своего терминала — оплата на месте');
    expect(flows).toContain('Web-платёж: нет своего терминала — оплата на месте');
    expect(flows).not.toContain('по умолчанию');
    expect(flows).toContain('Мобильный платёж (QR): терминал бренда · QRT123456789012345');
  });

  it('shows a stored secret only as «задан» and its tail, and never sends it back untouched', () => {
    const { click, byTestId, fixture, api } = setup();
    click('payment-terminal-toggle');

    expect(text(byTestId('payment-terminal-qr'))).toContain('Пароль · задан · …9876');
    expect(text(byTestId('payment-terminal-qr'))).not.toContain('noname-password');
    click('payment-terminal-save');

    expect(api.save).toHaveBeenCalledWith('b1', {});
    expect(fixture.componentInstance.request()).toEqual({});
  });

  it('sends what was changed or typed, and nulls for a section taken off', () => {
    const { click, type, el, fixture, api } = setup();
    click('payment-terminal-toggle');

    type('[data-testid="payment-terminal-card"] input[type="text"]', ' M00099999 ');
    type('[data-testid="payment-terminal-qr"] input[type="password"]', 'new-pass');
    const clearQr = el.querySelector<HTMLInputElement>('[data-testid="payment-terminal-qr"] input[type="checkbox"]');
    clearQr?.click();
    fixture.detectChanges();
    click('payment-terminal-save');

    expect(api.save).toHaveBeenCalledWith('b1', {
      cardMerchantId: 'M00099999',
      qrTerminalId: null,
      qrLogin: null,
      qrPassword: null,
      qrExternalToken: null,
      qrDeviceId: null,
    });
  });

  it('checks the connection and shows the bank’s answer per flow', () => {
    const { click, byTestId, api } = setup();
    click('payment-terminal-toggle');
    click('payment-terminal-check');

    expect(api.check).toHaveBeenCalledWith('b1');
    expect(text(byTestId('payment-terminal-checks'))).toBe(
      'Мобильный платёж (QR): подключено — Банк ответил: счёта нет',
    );
  });

  it('asks before removing the terminal', () => {
    const { click, api } = setup();
    click('payment-terminal-toggle');
    click('payment-terminal-remove');
    expect(api.remove).not.toHaveBeenCalled();
    click('payment-terminal-remove-confirm');
    expect(api.remove).toHaveBeenCalledWith('b1');
  });
});
