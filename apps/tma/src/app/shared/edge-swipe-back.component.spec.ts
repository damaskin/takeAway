import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { TelegramBridgeService } from '../core/telegram/telegram-bridge.service';
import { TmaEdgeSwipeBackComponent, keepsTouch } from './edge-swipe-back.component';

/** A touch event as a phone sends it; jsdom has no Touch constructor. */
function touch(type: string, x: number, y: number, target: EventTarget = document.body): void {
  const event = new Event(type, { bubbles: true });
  const point = [{ clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : point });
  Object.defineProperty(event, 'changedTouches', { value: point });
  Object.defineProperty(event, 'target', { value: target });
  document.dispatchEvent(event);
}

describe('TmaEdgeSwipeBackComponent', () => {
  let fixture: ComponentFixture<TmaEdgeSwipeBackComponent>;
  const goBack = jest.fn(() => true);
  const canGoBack = signal(true);

  beforeEach(async () => {
    goBack.mockClear();
    canGoBack.set(true);
    TestBed.configureTestingModule({
      imports: [TmaEdgeSwipeBackComponent],
      providers: [
        {
          provide: TelegramBridgeService,
          useValue: { canGoBack, goBack, safeAreaLeft: signal(0), haptic: jest.fn() },
        },
      ],
    });
    fixture = TestBed.createComponent(TmaEdgeSwipeBackComponent);
    await fixture.whenStable();
  });

  const hint = () => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="edge-swipe-hint"]');

  it('goes back like Telegram’s back button, with an arrow following the finger', async () => {
    touch('touchstart', 4, 300);
    touch('touchmove', 50, 302);
    await fixture.whenStable();
    expect(hint()).not.toBeNull();

    touch('touchmove', 120, 305);
    touch('touchend', 120, 305);
    await fixture.whenStable();
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(hint()).toBeNull();
  });

  it('does nothing on a screen without a way back', () => {
    canGoBack.set(false);
    touch('touchstart', 4, 300);
    touch('touchmove', 120, 300);
    touch('touchend', 120, 300);
    expect(goBack).not.toHaveBeenCalled();
  });

  it('leaves a touch on the map to the map', () => {
    const map = document.createElement('div');
    map.className = 'leaflet-container';
    touch('touchstart', 4, 300, map);
    touch('touchmove', 120, 300, map);
    touch('touchend', 120, 300, map);
    expect(goBack).not.toHaveBeenCalled();
  });
});

describe('keepsTouch', () => {
  it('leaves the map and scrolled strips their own touches', () => {
    const map = document.createElement('div');
    map.className = 'leaflet-container';
    const pin = document.createElement('span');
    map.appendChild(pin);
    expect(keepsTouch(pin)).toBe(true);

    const strip = document.createElement('div');
    const chip = document.createElement('button');
    strip.appendChild(chip);
    Object.defineProperty(strip, 'scrollWidth', { value: 900 });
    Object.defineProperty(strip, 'clientWidth', { value: 375 });
    expect(keepsTouch(chip)).toBe(false);
    // Scrolled along: a swipe right there scrolls the chips back.
    Object.defineProperty(strip, 'scrollLeft', { value: 120 });
    expect(keepsTouch(chip)).toBe(true);

    expect(keepsTouch(document.createElement('p'))).toBe(false);
  });
});
