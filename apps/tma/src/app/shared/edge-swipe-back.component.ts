import { Component, DOCUMENT, DestroyRef, afterNextRender, inject, signal } from '@angular/core';

import { EdgeSwipe } from '../core/telegram/edge-swipe';
import { TelegramBridgeService } from '../core/telegram/telegram-bridge.service';

/** How far the hint slides in from behind the edge, in px. */
const HINT_TRAVEL = 44;
const HINT_SIZE = 40;

/**
 * Swipe right from the left edge to go back, as on an iPhone: Telegram gives
 * a Mini App only its BackButton. Does exactly what that button would do on
 * the screen shown (`TelegramBridgeService.goBack`), and nothing on screens
 * without one (the tabs). A round arrow follows the finger and fills in once
 * letting go would go back.
 *
 * Listeners are passive, so scrolling is never held up. A touch that starts
 * on the map, or inside a horizontal strip scrolled away from its start (the
 * menu's category chips), stays theirs.
 */
@Component({
  selector: 'app-tma-edge-swipe-back',
  standalone: true,
  template: `
    @if (progress() > 0) {
      <div
        aria-hidden="true"
        data-testid="edge-swipe-hint"
        class="edge-hint"
        [class.edge-hint-ready]="progress() >= 1"
        [style.top.px]="hintTop()"
        [style.transform]="'translateX(' + (progress() * travel - size) + 'px)'"
        [style.opacity]="0.35 + progress() * 0.65"
      >
        ‹
      </div>
    }
  `,
  styles: [
    `
      .edge-hint {
        position: fixed;
        left: 0;
        z-index: 50;
        width: 40px;
        height: 40px;
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding-bottom: 3px;
        box-sizing: border-box;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        box-shadow: var(--shadow-soft);
        color: var(--color-caramel);
        font-family: var(--font-sans);
        font-size: 28px;
        font-weight: 600;
        pointer-events: none;
      }
      .edge-hint-ready {
        background: var(--color-caramel);
        border-color: var(--color-caramel);
        color: white;
      }
    `,
  ],
})
export class TmaEdgeSwipeBackComponent {
  private readonly tg = inject(TelegramBridgeService);
  private readonly doc = inject(DOCUMENT);
  private readonly swipe = new EdgeSwipe();

  readonly travel = HINT_TRAVEL;
  readonly size = HINT_SIZE;
  readonly progress = signal(0);
  readonly hintTop = signal(0);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const options: AddEventListenerOptions = { passive: true };
      const listeners: Array<[string, (event: TouchEvent) => void]> = [
        ['touchstart', (e) => this.onStart(e)],
        ['touchmove', (e) => this.onMove(e)],
        ['touchend', (e) => this.onEnd(e)],
        ['touchcancel', () => this.reset()],
      ];
      for (const [type, listener] of listeners) {
        this.doc.addEventListener(type, listener as EventListener, options);
      }
      destroyRef.onDestroy(() => {
        for (const [type, listener] of listeners) {
          this.doc.removeEventListener(type, listener as EventListener, options);
        }
      });
    });
  }

  private onStart(event: TouchEvent): void {
    const touch = event.touches[0];
    if (event.touches.length !== 1 || !touch || !this.tg.canGoBack() || keepsTouch(event.target)) {
      this.reset();
      return;
    }
    this.swipe.start(touch.clientX, touch.clientY, event.timeStamp, this.tg.safeAreaLeft());
  }

  private onMove(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch || event.touches.length !== 1) {
      this.reset();
      return;
    }
    const progress = this.swipe.move(touch.clientX, touch.clientY);
    if (progress > 0) this.hintTop.set(Math.max(8, this.swipe.startY - HINT_SIZE / 2));
    this.progress.set(progress);
  }

  private onEnd(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    const back = !!touch && this.swipe.end(touch.clientX, event.timeStamp);
    this.progress.set(0);
    if (back && this.tg.goBack()) this.tg.haptic('light');
  }

  private reset(): void {
    this.swipe.cancel();
    this.progress.set(0);
  }
}

/**
 * The touch belongs to what it started on: the map pans, a range slider
 * slides, a horizontal strip that is scrolled along scrolls back.
 */
export function keepsTouch(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el) {
    if (el.classList.contains('leaflet-container')) return true;
    if (el instanceof HTMLInputElement && el.type === 'range') return true;
    if (el instanceof HTMLElement && el.scrollLeft > 0 && el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}
