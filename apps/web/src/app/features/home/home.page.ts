import { ViewportScroller } from '@angular/common';
import { Component, Injector, OnInit, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';
import { TranslatePipe } from '@ngx-translate/core';
import { BrandLogoComponent } from '@takeaway/ui-kit';

import { categoryIcon } from '../../core/catalog/category-icon';
import { CatalogService } from '../../core/catalog/catalog.service';
import { storeAddress } from '../../core/catalog/store-place';

interface HomeCategory {
  id: string;
  name: string;
  icon: string;
}

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
  imports: [RouterLink, TranslatePipe, BrandLogoComponent],
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
            [routerLink]="['/stores', store.slug]"
            class="flex items-center"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-card); padding: 20px; gap: 16px"
          >
            <div
              class="flex items-center justify-center"
              style="width: 52px; height: 52px; background: var(--color-latte); border-radius: 14px; font-size: 24px"
            >
              ☕
            </div>
            <div class="flex flex-col flex-1" style="gap: 4px">
              <span
                style="font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: var(--color-espresso)"
                >{{ store.name }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                address(store) || ('common.readyIn' | translate: { min: etaMin(store) })
              }}</span>
            </div>
            <span
              class="flex items-center justify-center"
              [style.background]="etaBg(store)"
              style="color: white; border-radius: var(--radius-pill); padding: 4px 12px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
              >{{ etaMin(store) }} {{ 'common.units.min' | translate }}</span
            >
          </a>
        }
      </div>
    </section>

    <!-- Menu highlights — pencil HjOL8 -->
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

      @if (menuStore(); as slug) {
        <div
          class="grid"
          style="grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 24px 16px; justify-items: center"
        >
          @for (cat of categories(); track cat.id; let i = $index) {
            <a
              [routerLink]="['/stores', slug]"
              [fragment]="'cat-' + cat.id"
              class="flex flex-col items-center text-center"
              style="gap: 12px"
            >
              <div
                class="flex items-center justify-center"
                [style.background]="tileColors[i % tileColors.length]"
                style="width: 80px; height: 80px; border-radius: 999px; font-size: 32px"
              >
                {{ cat.icon }}
              </div>
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--color-text-primary)"
                >{{ cat.name }}</span
              >
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
  readonly stores = signal<StoreListItem[]>([]);

  /**
   * The categories of the menu the header's "Меню" opens — the first store's
   * — so a tile leads to a section that exists. `menuStore` is its slug.
   */
  readonly categories = signal<HomeCategory[]>([]);
  readonly menuStore = signal<string | null>(null);
  readonly tileColors = ['var(--color-caramel-light)', '#9DB87E33', '#8E5FB033', '#F5C95C33', '#C86A4B33', '#E8A0B433'];

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
  ];

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        this.stores.set(list.slice(0, 6));
        const first = list[0];
        if (first) this.loadCategories(first.slug);
      },
    });
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

  private loadCategories(slug: string): void {
    this.catalog.getMenu(slug).subscribe({
      next: (menu) => {
        this.menuStore.set(slug);
        // The tiles push the sections below them down: a link to one of those
        // ("О нас", "Лояльность") has to land on it again once they are in.
        const fragment = this.route.snapshot.fragment;
        if (fragment) afterNextRender(() => this.scroller.scrollToAnchor(fragment), { injector: this.injector });
        this.categories.set(
          menu.categories
            .filter((c) => c.products.length > 0)
            .slice(0, 12)
            .map((c) => ({ id: c.id, name: c.name, icon: categoryIcon(c.name) })),
        );
      },
      error: () => this.categories.set([]),
    });
  }
}
