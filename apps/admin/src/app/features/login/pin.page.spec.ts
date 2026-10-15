import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { TRANSLATIONS_EN } from '@takeaway/i18n/en';
import type { KitchenDeviceStores } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { KITCHEN_DEVICE_KEY, KitchenDeviceService } from '../../core/kitchen/kitchen-device.service';
import { KitchenApi } from '../../core/kitchen/kitchen.api';
import { KitchenModeService } from '../../core/kitchen/kitchen-mode.service';
import { PinLoginPage } from './pin.page';

const NONAME: KitchenDeviceStores = {
  brandId: 'brand-1',
  brandName: 'NoName Coffee',
  stores: [
    { id: 'store-1', name: 'NoName - центр', city: 'Тирасполь' },
    { id: 'store-2', name: 'NoName - вокзал', city: 'Тирасполь' },
  ],
};

describe('PinLoginPage', () => {
  let api: { deviceStores: jest.Mock; pairDevice: jest.Mock; bindDevice: jest.Mock };
  let loginWithPin: jest.Mock;
  let navigate: jest.SpyInstance;

  function make(opts: { token?: string | null; pair?: string } = {}): PinLoginPage {
    localStorage.clear();
    if (opts.token) localStorage.setItem(KITCHEN_DEVICE_KEY, opts.token);
    api = {
      deviceStores: jest.fn().mockReturnValue(of(NONAME)),
      pairDevice: jest
        .fn()
        .mockReturnValue(of({ deviceToken: 'paired-token', brandId: 'brand-1', brandName: 'NoName' })),
      bindDevice: jest.fn(),
    };
    loginWithPin = jest.fn().mockReturnValue(of({}));
    TestBed.configureTestingModule({
      imports: [PinLoginPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: KitchenApi, useValue: api },
        { provide: AuthService, useValue: { loginWithPin } },
        { provide: KitchenModeService, useValue: { enter: jest.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(opts.pair ? { pair: opts.pair } : {}) } },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.setTranslation('en', TRANSLATIONS_EN as unknown as Translation);
    translate.use('ru');
    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return TestBed.createComponent(PinLoginPage).componentInstance;
  }

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => localStorage.clear());

  it('explains how to bind an unbound tablet and lists no stores at all', () => {
    const page = make();
    expect(page.state()).toBe('unbound');
    expect(api.deviceStores).not.toHaveBeenCalled();
    expect(page.stores()).toEqual([]);
  });

  it('lists only the bound brand’s stores', () => {
    const page = make({ token: 'tablet-token' });
    expect(api.deviceStores).toHaveBeenCalledWith('tablet-token');
    expect(page.state()).toBe('bound');
    expect(page.brandName()).toBe('NoName Coffee');
    expect(page.stores().map((s) => s.id)).toEqual(['store-1', 'store-2']);
  });

  it('accepts a 6-digit PIN and sends it only on «Войти», with the tablet token', () => {
    const page = make({ token: 'tablet-token' });
    page.selectStore('store-1');
    for (const d of '4821') page.press(d);
    expect(loginWithPin).not.toHaveBeenCalled(); // no auto-submit at four digits
    expect(page.canSubmit()).toBe(true);
    for (const d of '379') page.press(d); // the seventh digit is ignored
    expect(page.pin()).toBe('482137');

    page.submit();
    expect(loginWithPin).toHaveBeenCalledWith('store-1', '482137', 'tablet-token');
    expect(navigate).toHaveBeenCalledWith(['/kitchen'], { queryParams: { store: 'store-1' } });
  });

  it('cannot send fewer than four digits', () => {
    const page = make({ token: 'tablet-token' });
    page.selectStore('store-1');
    for (const d of '482') page.press(d);
    expect(page.canSubmit()).toBe(false);
    page.submit();
    expect(loginWithPin).not.toHaveBeenCalled();
  });

  it('says how long to wait when the tablet is paused', () => {
    const page = make({ token: 'tablet-token' });
    loginWithPin.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 429,
            error: { code: 'KDS_PIN_LOCKED', retryAfterSeconds: 130 },
          }),
      ),
    );
    page.selectStore('store-1');
    for (const d of '000000') page.press(d);
    page.submit();
    expect(page.error()).toContain('3 мин');
    expect(page.pin()).toBe('');
  });

  it('forgets an unbound tablet’s token and shows the binding steps again', () => {
    const page = make({ token: 'tablet-token' });
    loginWithPin.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401, error: { code: 'KDS_DEVICE_UNKNOWN' } })),
    );
    page.selectStore('store-1');
    for (const d of '482137') page.press(d);
    page.submit();
    expect(page.state()).toBe('unbound');
    expect(localStorage.getItem(KITCHEN_DEVICE_KEY)).toBeNull();
    expect(TestBed.inject(KitchenDeviceService).token()).toBeNull();
  });

  it('binds the tablet from a one-time link and drops the code from the address', () => {
    const page = make({ pair: 'one-time-code-1234567890' });
    expect(api.pairDevice).toHaveBeenCalledWith('one-time-code-1234567890');
    expect(localStorage.getItem(KITCHEN_DEVICE_KEY)).toBe('paired-token');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: {}, replaceUrl: true }));
    expect(page.state()).toBe('bound');
  });

  it('says a used or expired link no longer works, on an unbound tablet', () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    api = {
      deviceStores: jest.fn(),
      pairDevice: jest
        .fn()
        .mockReturnValue(
          throwError(() => new HttpErrorResponse({ status: 401, error: { code: 'KDS_PAIRING_INVALID' } })),
        ),
      bindDevice: jest.fn(),
    };
    TestBed.configureTestingModule({
      imports: [PinLoginPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: KitchenApi, useValue: api },
        { provide: AuthService, useValue: { loginWithPin: jest.fn() } },
        { provide: KitchenModeService, useValue: { enter: jest.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ pair: 'used-code' }) } },
        },
      ],
    });
    TestBed.inject(TranslateService).setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    TestBed.inject(TranslateService).use('ru');
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const page = TestBed.createComponent(PinLoginPage).componentInstance;

    expect(page.state()).toBe('unbound');
    expect(page.notice()).toContain('недействительна');
  });
});
