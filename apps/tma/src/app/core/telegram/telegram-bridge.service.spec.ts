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
