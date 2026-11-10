import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { KitchenApi } from '../../core/kitchen/kitchen.api';
import { KitchenDeviceService } from '../../core/kitchen/kitchen-device.service';
import { KITCHEN_STORE_KEY } from '../../core/kitchen/kitchen-mode.service';
import { KitchenRealtimeService } from '../../core/kitchen/kitchen-realtime.service';
import { OrderAlertsService } from '../../core/kitchen/order-alerts.service';
import { KitchenPage } from './kitchen.page';

const STORES = [
  { id: 's1', name: 'Качели - Балка', timezone: 'Europe/Chisinau', status: 'OPEN', currency: 'RUP' },
  { id: 's2', name: 'Центр', timezone: 'Europe/Chisinau', status: 'OPEN', currency: 'RUP' },
];

describe('KitchenPage — which store the board shows', () => {
  let list: jest.Mock;
  let pending: ReturnType<typeof signal<ReadonlyMap<string, number>>>;
  let fixture: ComponentFixture<KitchenPage>;

  async function open(remembered: string | null, orders: unknown[] = []): Promise<HTMLElement> {
    if (remembered) localStorage.setItem(KITCHEN_STORE_KEY, remembered);
    else localStorage.removeItem(KITCHEN_STORE_KEY);
    list = jest.fn().mockReturnValue(of(orders));
    pending = signal<ReadonlyMap<string, number>>(new Map());
    TestBed.configureTestingModule({
      imports: [KitchenPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: AdminCatalogApi, useValue: { listStores: () => of(STORES) } },
        { provide: ActiveBrandService, useValue: { activeId: signal('b1'), reset: jest.fn() } },
        { provide: KitchenApi, useValue: { list, shift: () => of(null) } },
        {
          provide: KitchenRealtimeService,
          useValue: { connected: signal(true), watch: () => () => undefined, disconnect: jest.fn() },
        },
        {
          provide: OrderAlertsService,
          useValue: {
            pendingByStore: pending,
            soundOn: signal(true),
            remind: jest.fn(),
            dismiss: jest.fn(),
            toggleSound: jest.fn(),
          },
        },
        { provide: KitchenDeviceService, useValue: { ensureBound: jest.fn() } },
        { provide: AuthService, useValue: { logout: () => of(undefined) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(KitchenPage);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const select = (el: HTMLElement) => el.querySelector<HTMLSelectElement>('[data-testid="kitchen-store"]');
  const shown = (el: HTMLElement) => select(el)?.selectedOptions[0]?.textContent?.trim();

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => localStorage.removeItem(KITCHEN_STORE_KEY));

  it('shows the remembered store in the selector, not the first one by name (item 12)', async () => {
    const el = await open('s2');

    expect(fixture.componentInstance.storeId()).toBe('s2');
    expect(list).toHaveBeenLastCalledWith('s2');
    expect(select(el)?.value).toBe('s2');
    expect(shown(el)).toBe('Центр');
  });

  it('switches the store when a link with ?store= is followed while the board is open', async () => {
    const el = await open('s2');

    await TestBed.inject(Router).navigateByUrl('/?store=s1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.storeId()).toBe('s1');
    expect(list).toHaveBeenLastCalledWith('s1');
    expect(shown(el)).toBe('Качели - Балка');
  });

  it('ignores a ?store= the brand does not have', async () => {
    await open('s2');

    await TestBed.inject(Router).navigateByUrl('/?store=elsewhere');
    fixture.detectChanges();

    expect(fixture.componentInstance.storeId()).toBe('s2');
  });

  it('says which other stores have orders waiting, and opens one on a tap', async () => {
    const el = await open('s2');
    expect(el.querySelector('[data-testid="kitchen-elsewhere"]')).toBeNull();

    pending.set(new Map([['s1', 1]]));
    fixture.detectChanges();

    const notice = el.querySelector('[data-testid="kitchen-elsewhere"]');
    expect(notice?.textContent).toContain('Ждут принятия в других точках:');
    expect([...(select(el)?.options ?? [])].map((o) => o.textContent?.trim())).toEqual([
      'Качели - Балка · ждут: 1',
      'Центр',
    ]);

    notice?.querySelector('button')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.storeId()).toBe('s1');
    expect(localStorage.getItem(KITCHEN_STORE_KEY)).toBe('s1');
    expect(shown(el)).toBe('Качели - Балка · ждут: 1');
    expect(el.querySelector('[data-testid="kitchen-elsewhere"]')).toBeNull();
  });

  it('shows the picks of a product on the options catalog on its ticket', async () => {
    const pick = (groupId: string, name: string, extra: Record<string, unknown> = {}) => ({
      groupId,
      groupName: groupId,
      kind: 'ADDON',
      type: 'A',
      optionId: `${groupId}-${name}`,
      name,
      qty: 1,
      unitPriceCents: 0,
      freeQty: 0,
      totalCents: 0,
      ...extra,
    });
    const el = await open('s1', [
      {
        id: 'o1',
        orderCode: '0042',
        status: 'PAID',
        pickupMode: 'ASAP',
        pickupAt: new Date(Date.now() + 600_000).toISOString(),
        createdAt: new Date().toISOString(),
        customerName: 'Ира',
        notes: null,
        items: [
          {
            quantity: 1,
            productSnapshot: {
              id: 'p1',
              name: 'Капучино',
              optionLines: [
                pick('size', 'M', { kind: 'VARIANT' }),
                pick('serve', 'Горячий', { kind: 'VARIANT' }),
                pick('syrups', 'Ваниль'),
                pick('syrups', 'Солёная карамель'),
                pick('sugar', 'Сахар', { type: 'C', qty: 2 }),
              ],
            },
          },
        ],
      },
    ]);

    const chips = [...el.querySelectorAll('[data-testid="ticket-variant"]')].map((c) => c.textContent?.trim());
    const addons = [...el.querySelectorAll('[data-testid="ticket-addon"]')].map((a) => a.textContent?.trim());
    expect(chips).toEqual(['M', 'Горячий']);
    expect(addons).toEqual(['+ Ваниль + Солёная карамель', '+ Сахар ×2']);
  });

  it('tells the kitchen a takeAway promo order is paid in full', async () => {
    const order = (id: string, takeawayPromo: unknown) => ({
      id,
      orderCode: id.toUpperCase(),
      status: 'PAID',
      pickupMode: 'ASAP',
      pickupAt: new Date(Date.now() + 600_000).toISOString(),
      createdAt: new Date().toISOString(),
      customerName: 'Ира',
      notes: null,
      takeawayPromo,
      items: [{ quantity: 1, productSnapshot: { id: 'p1', name: 'Капучино' } }],
    });
    const el = await open('s1', [
      order('a1', {
        code: 'HELLO10',
        name: 'Приветственный бонус',
        percent: 10,
        menuTotalCents: 10000,
        discountCents: 1000,
        paidByGuestCents: 9000,
      }),
      order('a2', null),
    ]);

    const lines = [...el.querySelectorAll('[data-testid="ticket-takeaway-promo"]')].map((n) =>
      (n.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(lines).toEqual(['Акция takeAway −10% · оплачено полностью, 10 руб. компенсирует takeAway']);
    expect(el.querySelector('[data-testid="ticket-A1"] [data-testid="ticket-takeaway-promo"]')).not.toBeNull();
  });
});
