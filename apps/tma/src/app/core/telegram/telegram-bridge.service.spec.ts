import { TestBed } from '@angular/core/testing';

import { TelegramBridgeService, orderIdFromStartParam } from './telegram-bridge.service';

/** A MainButton that behaves like Telegram's: onClick adds, offClick removes. */
function fakeMainButton() {
  let handlers: Array<() => void> = [];
  return {
    setText: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    onClick: (cb: () => void) => {
      if (!handlers.includes(cb)) handlers.push(cb);
    },
    offClick: (cb: () => void) => {
      handlers = handlers.filter((h) => h !== cb);
    },
    press: () => handlers.forEach((h) => h()),
  };
}

describe('TelegramBridgeService main button', () => {
  let button: ReturnType<typeof fakeMainButton>;
  let service: TelegramBridgeService;

  beforeEach(() => {
    button = fakeMainButton();
    window.Telegram = {
      WebApp: {
        initData: '',
        ready: jest.fn(),
        expand: jest.fn(),
        close: jest.fn(),
        MainButton: button,
        BackButton: { show: jest.fn(), hide: jest.fn(), onClick: jest.fn(), offClick: jest.fn() },
      },
    };
    TestBed.configureTestingModule({});
    service = TestBed.inject(TelegramBridgeService);
  });

  afterEach(() => {
    delete window.Telegram;
  });

  // The product page re-labels the button on every option change; a tap used
  // to add the drink once per re-label.
  it('runs only the latest handler after the label changes', () => {
    const first = jest.fn();
    const latest = jest.fn();
    service.setMainButton('Добавить · 34 руб.', first);
    service.setMainButton('Добавить · 45 руб.', latest);

    button.press();

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('forgets the handler when the button is hidden', () => {
    const handler = jest.fn();
    service.setMainButton('Оплатить', handler);
    service.hideMainButton();

    button.press();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('orderIdFromStartParam', () => {
  it('reads the order from an order_<id> launch parameter', () => {
    expect(orderIdFromStartParam('order_cm1abc2def')).toBe('cm1abc2def');
  });

  it('ignores anything else', () => {
    expect(orderIdFromStartParam('promo_summer')).toBeNull();
    expect(orderIdFromStartParam('order_')).toBeNull();
    expect(orderIdFromStartParam(null)).toBeNull();
  });
});

describe('TelegramBridgeService launch parameter and links', () => {
  const openLink = jest.fn();
  let service: TelegramBridgeService;

  beforeEach(() => {
    openLink.mockReset();
    window.Telegram = {
      WebApp: {
        initData: '',
        initDataUnsafe: { start_param: 'order_ord-42' },
        ready: jest.fn(),
        expand: jest.fn(),
        close: jest.fn(),
        openLink,
        MainButton: fakeMainButton(),
        BackButton: { show: jest.fn(), hide: jest.fn(), onClick: jest.fn(), offClick: jest.fn() },
      },
    };
    TestBed.configureTestingModule({});
    service = TestBed.inject(TelegramBridgeService);
  });

  afterEach(() => {
    delete window.Telegram;
  });

  // The parameter stays on the launch all session; only the first screen follows it.
  it('hands out the launch order once', () => {
    expect(service.takeStartOrderId()).toBe('ord-42');
    expect(service.takeStartOrderId()).toBeNull();
  });

  it('opens outside pages through Telegram', () => {
    service.openLink('https://bank.example/pay');
    expect(openLink).toHaveBeenCalledWith('https://bank.example/pay');
  });
});

/** A BackButton that behaves like Telegram's: onClick adds, offClick removes. */
function fakeBackButton() {
  let handlers: Array<() => void> = [];
  return {
    visible: false,
    show: jest.fn(function (this: { visible: boolean }) {
      this.visible = true;
    }),
    hide: jest.fn(function (this: { visible: boolean }) {
      this.visible = false;
    }),
    onClick: (cb: () => void) => {
      if (!handlers.includes(cb)) handlers.push(cb);
    },
    offClick: (cb: () => void) => {
      handlers = handlers.filter((h) => h !== cb);
    },
    press: () => handlers.forEach((h) => h()),
    listeners: () => handlers.length,
  };
}

describe('TelegramBridgeService back button and swipe back', () => {
  let back: ReturnType<typeof fakeBackButton>;
  let service: TelegramBridgeService;

  beforeEach(() => {
    back = fakeBackButton();
    window.Telegram = {
      WebApp: {
        initData: '',
        ready: jest.fn(),
        expand: jest.fn(),
        close: jest.fn(),
        MainButton: fakeMainButton(),
        BackButton: back,
      },
    };
    TestBed.configureTestingModule({});
    service = TestBed.inject(TelegramBridgeService);
  });

  afterEach(() => {
    delete window.Telegram;
  });

  // Angular may create the next screen before it destroys the last one.
  it('runs only the newest screen’s handler and keeps the button while one is left', () => {
    const menu = jest.fn();
    const product = jest.fn();
    const leaveMenu = service.setBackButton(menu);
    const leaveProduct = service.setBackButton(product);
    leaveMenu();

    back.press();
    expect(product).toHaveBeenCalledTimes(1);
    expect(menu).not.toHaveBeenCalled();
    expect(back.visible).toBe(true);
    expect(back.listeners()).toBe(1);

    leaveProduct();
    expect(back.visible).toBe(false);
    expect(back.listeners()).toBe(0);
    expect(service.canGoBack()).toBe(false);
  });

  it('lets the edge swipe do what the back button does, and nothing on a tab', () => {
    expect(service.goBack()).toBe(false);
    const handler = jest.fn();
    service.setBackButton(handler);
    expect(service.canGoBack()).toBe(true);
    expect(service.goBack()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('TelegramBridgeService client features', () => {
  afterEach(() => {
    delete window.Telegram;
    document.documentElement.style.removeProperty('--tg-safe-area-bottom');
  });

  function boot(webApp: Partial<NonNullable<Window['Telegram']>['WebApp']>, version = '8.0') {
    window.Telegram = {
      WebApp: {
        initData: '',
        ready: jest.fn(),
        expand: jest.fn(),
        close: jest.fn(),
        MainButton: fakeMainButton(),
        BackButton: fakeBackButton(),
        isVersionAtLeast: (v: string) => Number(v) <= Number(version),
        ...webApp,
      },
    };
    // A fresh service per client: the bridge reads Telegram once, when it is made.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(TelegramBridgeService);
  }

  // The home indicator sat over the tab bar: the bar now rises by this much.
  it('exposes the bottom inset the phone and Telegram take', () => {
    const service = boot({
      safeAreaInset: { top: 47, bottom: 34, left: 0, right: 0 },
      contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 0 },
    });
    expect(service.safeAreaBottom()).toBe(34);
    expect(document.documentElement.style.getPropertyValue('--tg-safe-area-bottom')).toBe('34px');
    expect(document.documentElement.style.getPropertyValue('--tg-safe-area-top')).toBe('93px');
  });

  it('keeps vertical swipes for scrolling where the client supports it', () => {
    const disable = jest.fn();
    boot({ disableVerticalSwipes: disable }, '7.7').disableVerticalSwipes();
    expect(disable).toHaveBeenCalled();

    const old = jest.fn();
    boot({ disableVerticalSwipes: old }, '7.0').disableVerticalSwipes();
    expect(old).not.toHaveBeenCalled();
  });

  it('asks with Telegram’s own dialog', async () => {
    const showConfirm = jest.fn((_: string, cb?: (ok: boolean) => void) => cb?.(true));
    const service = boot({ showConfirm });
    await expect(service.confirm('Отменить заказ A-12?')).resolves.toBe(true);
    expect(showConfirm).toHaveBeenCalledWith('Отменить заказ A-12?', expect.any(Function));
  });

  describe('location', () => {
    function manager(over: Record<string, unknown> = {}) {
      return {
        isInited: true,
        isLocationAvailable: true,
        isAccessRequested: false,
        isAccessGranted: false,
        init: jest.fn((cb?: () => void) => cb?.()),
        getLocation: jest.fn((cb: (d: { latitude: number; longitude: number } | null) => void) =>
          cb({ latitude: 46.84, longitude: 29.62 }),
        ),
        openSettings: jest.fn(),
        ...over,
      };
    }

    afterEach(() => {
      Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    });

    it('asks Telegram’s LocationManager first', async () => {
      const lm = manager({ isInited: false });
      const service = boot({ LocationManager: lm });
      await expect(service.requestLocation()).resolves.toEqual({ kind: 'ok', lat: 46.84, lng: 29.62 });
      expect(lm.init).toHaveBeenCalled();
    });

    it('points to Telegram’s settings after a refusal', async () => {
      const lm = manager({ getLocation: jest.fn((cb: (d: null) => void) => cb(null)) });
      const service = boot({ LocationManager: lm });
      await expect(service.requestLocation()).resolves.toEqual({ kind: 'denied', canOpenSettings: true });
      service.openLocationSettings();
      expect(lm.openSettings).toHaveBeenCalled();
    });

    it('falls back to the browser where Telegram has no location', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
            ok({ coords: { latitude: 47.01, longitude: 28.86 } }),
        },
      });
      const service = boot({ LocationManager: manager({ isLocationAvailable: false }) });
      await expect(service.requestLocation()).resolves.toEqual({ kind: 'ok', lat: 47.01, lng: 28.86 });
    });

    it('says the browser was refused, with no settings to open', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: (_: unknown, fail: (e: { code: number }) => void) => fail({ code: 1 }) },
      });
      const service = boot({}, '7.0');
      await expect(service.requestLocation()).resolves.toEqual({ kind: 'denied', canOpenSettings: false });
    });
  });
});
