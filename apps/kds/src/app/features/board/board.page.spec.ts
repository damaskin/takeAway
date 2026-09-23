import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { KdsApi, type KdsOrder } from '../../core/kds/kds.service';
import { KdsRealtimeService } from '../../core/realtime/realtime.service';
import { StoresApi } from '../../core/stores/stores.service';
import { KdsBoardPage } from './board.page';

/**
 * The ticket is the only place a barista learns what to make. It used to say
 * "2× Латте" and nothing else, whatever size, milk and syrup the customer paid
 * for.
 */
describe('KdsBoardPage ticket', () => {
  const order: KdsOrder = {
    id: 'order-1',
    orderCode: '4832',
    status: 'PAID',
    pickupMode: 'ASAP',
    pickupAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    customerName: 'Иван',
    notes: null,
    items: [
      {
        quantity: 2,
        productSnapshot: {
          id: 'p-latte',
          name: 'Латте',
          variations: [
            { id: 'v-oat', type: 'MILK', name: 'Овсяное', priceDeltaCents: 60 },
            { id: 'v-l', type: 'SIZE', name: 'L', priceDeltaCents: 140 },
          ],
          modifierLines: [{ id: 'm-vanilla', name: 'Ваниль', count: 2, priceCents: 50 }],
          notes: 'поменьше пены',
        },
      },
      {
        quantity: 1,
        // Placed before options were snapshotted: ids only.
        productSnapshot: { id: 'p-cappuccino', name: 'Капучино', variationIds: ['v-s'], modifiers: {}, notes: null },
      },
    ],
  };

  let fixture: ComponentFixture<KdsBoardPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KdsBoardPage],
      providers: [
        provideTranslateService(),
        { provide: KdsApi, useValue: { list: () => of([order]) } },
        {
          provide: StoresApi,
          useValue: { listMine: () => of([{ id: 'store-1', slug: 'centre', name: 'Центр', city: '' }]) },
        },
        { provide: KdsRealtimeService, useValue: { subscribeToStore: () => () => undefined } },
        { provide: AuthStore, useValue: { user: signal(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KdsBoardPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  /** Each ticket line as the barista reads it: every piece of text, in order. */
  const lines = (): string[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('article li')).map((li) => {
      const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      const pieces: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text) pieces.push(text);
      }
      return pieces.join(' ');
    });

  it('reads size, then milk, then the extras with their counts, then the note', () => {
    expect(lines()[0]).toBe('2× Латте L Овсяное + Ваниль ×2 ✎ поменьше пены');
  });

  it('shows an order from before options were snapshotted by its name alone', () => {
    expect(lines()[1]).toBe('1× Капучино');
  });
});
