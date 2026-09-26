import { TestBed } from '@angular/core/testing';

import { TelegramBridgeService } from './telegram-bridge.service';

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
