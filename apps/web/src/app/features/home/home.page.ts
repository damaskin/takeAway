import { ViewportScroller } from '@angular/common';
import { Component, Injector, OnInit, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';
import { isStoreInactive, sortStoresByAvailability } from '@takeaway/utils';
import { TranslatePipe } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import { BrandLogoComponent, StoreLogoComponent } from '@takeaway/ui-kit';
import { catchError, forkJoin, map, of } from 'rxjs';

import { CatalogService } from '../../core/catalog/catalog.service';
import { refreshStoresWhileVisible } from '../../core/catalog/live-store-refresh';
import { mixMenuPicks, storesToSample, type MenuPick } from '../../core/catalog/menu-picks';
import { storeAddress } from '../../core/catalog/store-place';

interface HowStep {
  icon: string;
  title: string;
  desc: string;
}

interface FooterLink {
  label: string;
  route: string;
  fragment?: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, TranslatePipe, BrandLogoComponent, StoreLogoComponent],
  template: `
    <!-- Hero — pencil SNCQE. The design's closing banner; it opens the page. -->
    <section
      class="flex flex-col items-center justify-center text-center"
      style="background: var(--color-caramel); padding: clamp(56px, 9vw, 104px) clamp(20px, 7vw, 120px); gap: 24px"
    >
      <h1
        style="font-family: var(--font-display); font-size: clamp(34px, 6vw, 60px); font-weight: 700; color: var(--color-cream); line-height: 1.05; max-width: 900px"
      >
        {{ 'web.home.closing.title' | translate }}
      </h1>
      <p
        style="font-family: var(--font-sans); font-size: clamp(16px, 2vw, 20px); color: var(--color-cream); opacity: 0.9; max-width: 640px; line-height: 1.5"
      >
        {{ 'web.home.closing.subtitle' | translate }}
      </p>
      <div class="flex items-center" style="gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 8px">
        <a
          routerLink="/menu"
          style="padding: 14px 32px; background: var(--color-cream); color: var(--color-caramel); border-radius: 14px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
          >{{ 'web.home.closing.ctaMenu' | translate }}</a
        >
        <a
          routerLink="/stores"
          style="padding: 12px 30px; border: 2px solid var(--color-cream); color: var(--color-cream); border-radius: 14px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
          >{{ 'web.home.stores.cta' | translate }}</a
        >
      </div>
    </section>

    <!-- Store locator section — pencil IzEzR -->
    <section
      style="background: var(--color-foam); padding: clamp(40px, 8vw, 64px) clamp(16px, 5vw, 80px); display: flex; flex-direction: column; gap: 32px"
    >
      <div class="flex items-end justify-between flex-wrap" style="gap: 24px">
        <div class="flex flex-col" style="gap: 8px">
          <h2
            style="font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-espresso); line-height: 1.1"
          >
            {{ 'web.home.stores.title' | translate }}
          </h2>
          <p style="font-family: var(--font-sans); font-size: 16px; color: var(--color-text-secondary)">
            {{ 'web.home.stores.subtitle' | translate }}
          </p>
        </div>
        <a
          routerLink="/stores"
          class="flex items-center"
          style="gap: 8px; height: 42px; padding: 0 20px; border: 1.5px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
          >🗺️ {{ 'web.home.stores.cta' | translate }}</a
        >
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3" style="gap: 20px">
        @for (store of stores(); track store.id) {
          <a
            [routerLink]="closed(store) ? null : ['/stores', store.slug]"
            class="flex items-center"
            [style.opacity]="closed(store) ? 0.55 : 1"
            [style.cursor]="closed(store) ? 'default' : null"
            [attr.aria-disabled]="closed(store) || null"
            [attr.data-inactive]="closed(store) || null"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-card); padding: 20px; gap: 16px"
          >
            <lib-store-logo
              [photo]="store.heroImageUrl"
              [url]="store.logoUrl"
              [name]="store.brandName ?? store.name"
              [size]="52"
            />
            <div class="flex flex-col flex-1" style="gap: 4px">
              <span
                style="font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: var(--color-espresso)"
                >{{ store.name }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                address(store) || ('common.readyIn' | translate: { min: etaMin(store) })
              }}</span>
            </div>
            @if (closed(store)) {
              <span
                class="flex items-center justify-center"
                style="background: #d94b5e22; color: #8f2f3c; border-radius: var(--radius-pill); padding: 4px 12px; font-family: var(--font-sans); font-size: 12px; font-weight: 700"
                >{{ 'common.storeClosed.badge' | translate }}</span
              >
            } @else {
              <span
                class="flex items-center justify-center"
                [style.background]="etaBg(store)"
                style="color: white; border-radius: var(--radius-pill); padding: 4px 12px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
                >{{ etaMin(store) }} {{ 'common.units.min' | translate }}</span
              >
            }
          </a>
        }
      </div>
    </section>

    <!-- Menu highlights — pencil HjOL8. A mix from several places, each card naming its place. -->
    <section
      style="background: var(--color-cream); padding: clamp(40px, 8vw, 64px) clamp(16px, 5vw, 80px); display: flex; flex-direction: column; gap: 32px"
    >
      <div class="flex items-end justify-between flex-wrap" style="gap: 24px">
        <div class="flex flex-col" style="gap: 8px">
          <h2
            style="font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-espresso); line-height: 1.1"
          >
            {{ 'web.home.menu.title' | translate }}
          </h2>
          <p style="font-family: var(--font-sans); font-size: 16px; color: var(--color-text-secondary)">
            {{ 'web.home.menu.subtitle' | translate }}
          </p>
        </div>
        <a
          routerLink="/menu"
          class="flex items-center"
          style="gap: 8px; height: 42px; padding: 0 20px; border: 1.5px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
          >{{ 'web.home.menu.cta' | translate }}</a
        >
      </div>

      @if (picks().length > 0) {
        <!-- Eight cards: two full rows on a desktop, four on a phone. -->
        <div class="grid grid-cols-2 md:grid-cols-4" style="gap: clamp(12px, 2vw, 20px)">
          @for (pick of picks(); track pick.store.id + pick.product.id) {
            <a
              [routerLink]="['/products', pick.product.slug]"
              [queryParams]="{ store: pick.store.slug }"
              class="flex flex-col"
              data-testid="menu-pick"
              style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-card); overflow: hidden"
            >
              <img
                [src]="pick.product.imageUrls[0]"
                [alt]="pick.product.name"
                loading="lazy"
                decoding="async"
                style="width: 100%; aspect-ratio: 4 / 3; object-fit: cover; background: var(--color-latte)"
              />
              <div class="flex flex-1 flex-col" style="gap: 6px; padding: 12px 14px 14px">
                <span
                  class="line-clamp-2"
                  style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--color-text-primary)"
                  >{{ pick.product.name }}</span
                >
                <span
                  style="font-family: var(--font-sans); font-size: 15px; font-weight: 700; color: var(--color-caramel)"
                  >{{ price(pick) }}</span
                >
                <span class="flex items-center" style="gap: 8px; margin-top: auto; padding-top: 4px; min-width: 0">
                  <lib-store-logo
                    [photo]="pick.store.heroImageUrl"
                    [url]="pick.store.logoUrl"
                    [name]="pick.store.brandName ?? pick.store.name"
                    [size]="22"
                  />
                  <span
                    class="truncate"
                    data-testid="menu-pick-store"
                    style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
                    >{{ pick.store.name }}</span
                  >
                </span>
              </div>
            </a>
          }
        </div>
      }
    </section>

    <!-- How it works — pencil 0kQGF -->
    <section
      id="how-it-works"
      class="flex flex-col items-center"
      style="background: var(--color-cream); padding: clamp(48px, 8vw, 80px) clamp(16px, 5vw, 80px); gap: 48px"
    >
      <div class="flex flex-col items-center" style="gap: 8px">
        <h2
          style="font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-espresso); line-height: 1.1; text-align: center"
        >
          {{ 'web.home.howItWorks.title' | translate }}
        </h2>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 w-full" style="gap: 48px; max-width: 1200px">
        @for (step of howSteps; track step.title) {
          <article class="flex flex-col items-center" style="gap: 20px; text-align: center">
            <div
              class="flex items-center justify-center"
              style="width: 96px; height: 96px; background: var(--color-caramel-light); border-radius: 999px; font-size: 40px"
            >
              {{ step.icon }}
            </div>
            <h3
              style="font-family: var(--font-sans); font-size: 20px; font-weight: 600; color: var(--color-text-primary)"
            >
              {{ step.title | translate }}
            </h3>
            <p
              style="font-family: var(--font-sans); font-size: 15px; color: var(--color-text-secondary); max-width: 280px"
            >
              {{ step.desc | translate }}
            </p>
          </article>
        }
      </div>
    </section>

    <!-- Loyalty — pencil 3MYXK -->
    <section
      id="loyalty"
      class="flex items-center"
      style="background: var(--color-foam); padding: clamp(40px, 8vw, 64px) clamp(16px, 5vw, 80px); gap: 48px; flex-wrap: wrap"
    >
      <div class="flex flex-col flex-1" style="gap: 24px; min-width: min(360px, 100%)">
        <span
          class="inline-flex items-center self-start"
          style="gap: 6px; height: 28px; padding: 0 12px; background: var(--color-caramel-light); border-radius: 999px"
        >
          <span style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-caramel)"
            >🏆 {{ 'web.home.loyalty.badge' | translate }}</span
          >
        </span>
        <h2
          style="font-family: var(--font-display); font-size: 40px; font-weight: 700; color: var(--color-espresso); line-height: 1.1"
        >
          {{ 'web.home.loyalty.title' | translate }}
        </h2>
        <p
          style="font-family: var(--font-sans); font-size: 16px; line-height: 1.6; color: var(--color-text-secondary); max-width: 480px"
        >
          {{ 'web.home.loyalty.subtitle' | translate }}
        </p>
        <a
          routerLink="/login"
          class="self-start flex items-center justify-center"
          style="gap: 10px; height: 52px; padding: 0 28px; background: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: white"
          >{{ 'web.home.loyalty.cta' | translate }}</a
        >
      </div>

      <div
        class="flex items-center justify-center flex-col"
        style="width: 480px; max-width: 100%; height: 320px; background: var(--color-latte); border-radius: 24px; padding: 32px; gap: 16px"
      >
        <div
          class="w-full flex flex-col justify-center"
          style="padding: 24px; background: linear-gradient(135deg, var(--color-caramel) 0%, #a0612a 100%); border-radius: 20px; gap: 16px; min-height: 220px"
        >
          <div class="flex items-center justify-between">
            <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: white">{{
              'web.home.loyalty.badge' | translate
            }}</span>
            <span style="font-family: var(--font-sans); font-size: 12px; color: rgba(255,255,255,0.7)">GOLD</span>
          </div>
          <span style="font-family: var(--font-sans); font-size: 40px; font-weight: 700; color: white">2,450</span>
          <span style="font-family: var(--font-sans); font-size: 14px; color: rgba(255,255,255,0.6)">{{
            'web.home.loyalty.points' | translate
          }}</span>
        </div>
      </div>
    </section>

    <!-- Gift cards — pencil RWxHF -->
    <section
      class="flex items-center"
      style="background: var(--color-cream); padding: clamp(40px, 8vw, 64px) clamp(16px, 5vw, 80px); gap: 48px; flex-wrap: wrap"
    >
      <div
        class="flex items-center justify-center"
        style="width: 480px; max-width: 100%; height: 280px; background: var(--color-caramel-light); border-radius: 24px; font-size: 96px"
      >
        🎁
      </div>
      <div class="flex flex-col flex-1" style="gap: 24px; min-width: min(360px, 100%)">
        <h2
          style="font-family: var(--font-display); font-size: 40px; font-weight: 700; color: var(--color-espresso); line-height: 1.1"
        >
          {{ 'web.home.gift.title' | translate }}
        </h2>
        <p
          style="font-family: var(--font-sans); font-size: 16px; line-height: 1.6; color: var(--color-text-secondary); max-width: 440px"
        >
          {{ 'web.home.gift.subtitle' | translate }}
        </p>
        <a
          routerLink="/profile/gift-cards"
          class="self-start flex items-center justify-center"
          style="gap: 10px; height: 52px; padding: 0 28px; border: 1.5px solid var(--color-border); border-radius: var(--radius-button); background: transparent; font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: var(--color-text-primary)"
        >
          {{ 'web.home.gift.cta' | translate }}
        </a>
      </div>
    </section>

    <!-- Footer — pencil O5wdQ -->
    <footer
      style="background: var(--color-espresso); padding: clamp(40px, 8vw, 64px) clamp(16px, 5vw, 80px) 40px; display: flex; flex-direction: column; gap: 48px"
    >
      <div class="flex items-start justify-between flex-wrap" style="gap: 32px">
        <div class="flex flex-col" style="max-width: 280px; gap: 16px">
          <lib-brand-logo [size]="28" style="align-self: flex-start" />
          <p style="font-family: var(--font-sans); font-size: 14px; line-height: 1.6; color: rgba(248,243,235,0.6)">
            {{ 'web.home.footer.tagline' | translate }}<br />{{ 'web.home.footer.taglineMore' | translate }}
          </p>
        </div>

        @for (col of footerColumns; track col.title) {
          <div class="flex flex-col" style="gap: 16px">
            <span
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; letter-spacing: 1px; color: rgba(248,243,235,0.4)"
              >{{ col.title | translate }}</span
            >
            @for (link of col.links; track link.label) {
              <a
                [routerLink]="link.route"
                [fragment]="link.fragment"
                style="font-family: var(--font-sans); font-size: 14px; color: rgba(248,243,235,0.8)"
                >{{ link.label | translate }}</a
              >
            }
          </div>
        }
      </div>

      <div style="height: 1px; background: rgba(248,243,235,0.08)"></div>

      <div class="flex items-center justify-between flex-wrap" style="gap: 16px">
        <span style="font-family: var(--font-sans); font-size: 13px; color: rgba(248,243,235,0.4)">
          {{ 'web.home.footer.rights' | translate }}
        </span>
      </div>
    </footer>
  `,
})
export class HomePage implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly route = inject(ActivatedRoute);
  private readonly scroller = inject(ViewportScroller);
  private readonly injector = inject(Injector);
  private readonly fmt = inject(LocaleFormatService);
  readonly stores = signal<StoreListItem[]>([]);

  /**
   * «Из меню»: items from the menus of several places taking orders, each
   * card naming its place and opening that place's product — the site is a
   * marketplace, not one café. Built from the public store menus (one
   * request per business, cached for the menu page), so no new endpoint.
   */
  readonly picks = signal<MenuPick[]>([]);

  readonly howSteps: HowStep[] = [
    { icon: '📱', title: 'web.home.howItWorks.step1Title', desc: 'web.home.howItWorks.step1Body' },
    { icon: '💳', title: 'web.home.howItWorks.step2Title', desc: 'web.home.howItWorks.step2Body' },
    { icon: '🛍️', title: 'web.home.howItWorks.step3Title', desc: 'web.home.howItWorks.step3Body' },
  ];

  // Titles and labels are translation keys, run through the translate pipe.
  readonly footerColumns: { title: string; links: FooterLink[] }[] = [
    {
      title: 'web.home.menu.title',
      links: [
        { label: 'nav.menu', route: '/menu' },
        { label: 'nav.stores', route: '/stores' },
        { label: 'nav.loyalty', route: '/', fragment: 'loyalty' },
        { label: 'web.home.gift.title', route: '/profile/gift-cards' },
      ],
    },
    {
      title: 'nav.about',
      links: [
        { label: 'nav.about', route: '/', fragment: 'how-it-works' },
        { label: 'web.business.footerLink', route: '/business/signup' },
      ],
    },
    {
      title: 'web.home.footer.help',
      links: [
        { label: 'web.legal.support', route: '/support' },
        { label: 'web.legal.terms', route: '/terms' },
        { label: 'web.legal.privacy', route: '/privacy' },
      ],
    },
  ];

  constructor() {
    // Closed stores light up when their shift starts, without a reload.
    refreshStoresWhileVisible(() =>
      this.catalog.listStores().subscribe({ next: (list) => this.showStores(list), error: () => undefined }),
    );
  }

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        this.showStores(list);
        this.loadPicks(list);
      },
    });
  }

  closed(store: StoreListItem): boolean {
    return isStoreInactive(store);
  }

  /** Open stores first, closed ones after them; the first six. */
  private showStores(list: StoreListItem[]): void {
    this.stores.set(sortStoresByAvailability(list).slice(0, 6));
  }

  address(store: StoreListItem): string {
    return storeAddress(store);
  }

  etaMin(store: StoreListItem): number {
    return Math.max(1, Math.round(store.currentEtaSeconds / 60));
  }

  etaBg(store: StoreListItem): string {
    if (store.busyMeter >= 75) return 'var(--color-berry)';
    if (store.busyMeter >= 40) return 'var(--color-amber)';
    return 'var(--color-mint)';
  }

  price(pick: MenuPick): string {
    return this.fmt.money(pick.product.basePriceCents, pick.store.currency);
  }

  /** A menu that fails to load just leaves its place out of the mix. */
  private loadPicks(list: StoreListItem[]): void {
    const sampled = storesToSample(list);
    if (sampled.length === 0) return;
    forkJoin(
      sampled.map((store) =>
        this.catalog.getMenu(store.slug).pipe(
          map((menu) => ({ store, menu })),
          catchError(() => of(null)),
        ),
      ),
    ).subscribe((entries) => {
      this.picks.set(mixMenuPicks(entries.filter((e) => e !== null)));
      // The cards push the sections below them down: a link to one of those
      // ("О нас", "Лояльность") has to land on it again once they are in.
      const fragment = this.route.snapshot.fragment;
      if (fragment) afterNextRender(() => this.scroller.scrollToAnchor(fragment), { injector: this.injector });
    });
  }
}
