import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StoreListItem } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';

interface HomeCategory {
  slug: string;
  name: string;
  bg: string;
  emoji: string;
}

interface HowStep {
  num: string;
  title: string;
  desc: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <!-- Store locator section — pencil IzEzR -->
    <section
      style="background: var(--color-foam); padding: 64px 80px; display: flex; flex-direction: column; gap: 32px"
    >
      <div class="flex items-end justify-between flex-wrap" style="gap: 24px">
        <div class="flex flex-col" style="gap: 8px">
          <h2
            style="font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-espresso); line-height: 1.1"
          >
            Find a store near you
          </h2>
          <p style="font-family: var(--font-sans); font-size: 16px; color: var(--color-text-secondary)">
            Pick up your order at any of our locations
          </p>
        </div>
        <a
          routerLink="/stores"
          class="flex items-center"
          style="gap: 8px; height: 42px; padding: 0 20px; border: 1.5px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
          >🗺️ View on map</a
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
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
                >{{ store.city }} · ready in {{ etaMin(store) }} min</span
              >
            </div>
            <span
              class="flex items-center justify-center"
              [style.background]="etaBg(store)"
              style="color: white; border-radius: var(--radius-pill); padding: 4px 12px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
              >{{ etaMin(store) }}m</span
            >
          </a>
        }
      </div>
    </section>

    <!-- Menu highlights — pencil HjOL8 -->
    <section
      style="background: var(--color-cream); padding: 64px 80px; display: flex; flex-direction: column; gap: 32px"
    >
      <div class="flex items-end justify-between flex-wrap" style="gap: 24px">
        <div class="flex flex-col" style="gap: 8px">
          <h2
            style="font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-espresso); line-height: 1.1"
          >
            From the menu
          </h2>
          <p style="font-family: var(--font-sans); font-size: 16px; color: var(--color-text-secondary)">
            Freshly prepared, just for you
          </p>
        </div>
        <a
          routerLink="/menu"
          class="flex items-center"
          style="gap: 8px; height: 42px; padding: 0 20px; border: 1.5px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
          >View menu →</a
        >
      </div>

      <div
        class="grid"
        style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 16px; justify-items: center"
      >
        @for (cat of categories; track cat.slug) {
          <a [routerLink]="['/menu']" [fragment]="cat.slug" class="flex flex-col items-center" style="gap: 12px">
            <div
              class="flex items-center justify-center"
              [style.background]="cat.bg"
              style="width: 80px; height: 80px; border-radius: 999px; font-size: 32px"
            >
              {{ cat.emoji }}
            </div>
            <span
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
              >{{ cat.name }}</span
            >
          </a>
        }
      </div>
    </section>

    <!-- How it works — pencil 0kQGF -->
    <section
      id="how-it-works"
      class="flex flex-col items-center"
      style="background: var(--color-cream); padding: 80px; gap: 48px"
    >
      <div class="flex flex-col items-center" style="gap: 8px">
        <h2
          style="font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-espresso); line-height: 1.1; text-align: center"
        >
          How it works
        </h2>
        <p
          style="font-family: var(--font-sans); font-size: 16px; color: var(--color-text-secondary); text-align: center"
        >
          Three simple steps to your perfect order
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 w-full" style="gap: 48px; max-width: 1200px">
        @for (step of howSteps; track step.num) {
          <article class="flex flex-col items-center" style="gap: 20px; text-align: center">
            <div
              class="flex items-center justify-center"
              style="width: 96px; height: 96px; background: var(--color-caramel-light); border-radius: 999px; font-size: 40px"
            >
              ☕
            </div>
            <span
              style="font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-caramel)"
              >{{ step.num }}</span
            >
            <h3
              style="font-family: var(--font-sans); font-size: 20px; font-weight: 600; color: var(--color-text-primary)"
            >
              {{ step.title }}
            </h3>
            <p
              style="font-family: var(--font-sans); font-size: 15px; color: var(--color-text-secondary); max-width: 280px"
            >
              {{ step.desc }}
            </p>
          </article>
        }
      </div>
    </section>

    <!-- Loyalty — pencil 3MYXK -->
    <section
      id="loyalty"
      class="flex items-center"
      style="background: var(--color-foam); padding: 64px 80px; gap: 48px; flex-wrap: wrap"
    >
      <div class="flex flex-col flex-1" style="gap: 24px; min-width: 360px">
        <span
          class="inline-flex items-center self-start"
          style="gap: 6px; height: 28px; padding: 0 12px; background: var(--color-caramel-light); border-radius: 999px"
        >
          <span style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-caramel)"
            >🏆 Coffeepass</span
          >
        </span>
        <h2
          style="font-family: var(--font-display); font-size: 40px; font-weight: 700; color: var(--color-espresso); line-height: 1.1"
        >
          Earn rewards<br />with every order
        </h2>
        <p
          style="font-family: var(--font-sans); font-size: 16px; line-height: 1.6; color: var(--color-text-secondary); max-width: 480px"
        >
          Join Coffeepass and earn points on every order. Unlock free drinks, exclusive perks and tier-based benefits.
        </p>
        <a
          routerLink="/login"
          class="self-start flex items-center justify-center"
          style="gap: 10px; height: 52px; padding: 0 28px; background: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: white"
          >Join</a
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
            <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: white"
              >Coffeepass</span
            >
            <span style="font-family: var(--font-sans); font-size: 12px; color: rgba(255,255,255,0.7)">GOLD</span>
          </div>
          <span style="font-family: var(--font-sans); font-size: 40px; font-weight: 700; color: white">2,450</span>
          <span style="font-family: var(--font-sans); font-size: 14px; color: rgba(255,255,255,0.6)"
            >points earned</span
          >
        </div>
      </div>
    </section>

    <!-- Gift cards — pencil RWxHF -->
    <section
      class="flex items-center"
      style="background: var(--color-cream); padding: 64px 80px; gap: 48px; flex-wrap: wrap"
    >
      <div
        class="flex items-center justify-center"
        style="width: 480px; max-width: 100%; height: 280px; background: var(--color-caramel-light); border-radius: 24px; font-size: 96px"
      >
        🎁
      </div>
      <div class="flex flex-col flex-1" style="gap: 24px; min-width: 360px">
        <h2
          style="font-family: var(--font-display); font-size: 40px; font-weight: 700; color: var(--color-espresso); line-height: 1.1"
        >
          Gift the joy<br />of great coffee
        </h2>
        <p
          style="font-family: var(--font-sans); font-size: 16px; line-height: 1.6; color: var(--color-text-secondary); max-width: 440px"
        >
          Send a takeAway gift card to friends and family. Perfect for any occasion.
        </p>
        <button
          type="button"
          class="self-start flex items-center justify-center"
          style="gap: 10px; height: 52px; padding: 0 28px; border: 1.5px solid var(--color-border); border-radius: var(--radius-button); background: transparent; font-family: var(--font-sans); font-size: 16px; font-weight: 600; color: var(--color-text-primary)"
        >
          Buy gift card
        </button>
      </div>
    </section>

    <!-- Footer — pencil O5wdQ -->
    <footer
      style="background: var(--color-espresso); padding: 64px 80px 40px; display: flex; flex-direction: column; gap: 48px"
    >
      <div class="flex items-start justify-between flex-wrap" style="gap: 32px">
        <div class="flex flex-col" style="max-width: 280px; gap: 16px">
          <span style="font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-caramel)"
            >takeAway</span
          >
          <p style="font-family: var(--font-sans); font-size: 14px; line-height: 1.6; color: rgba(248,243,235,0.6)">
            Coffee and food to-go.<br />Skip the queue, not the quality.
          </p>
        </div>

        @for (col of footerColumns; track col.title) {
          <div class="flex flex-col" style="gap: 16px">
            <span
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; letter-spacing: 1px; color: rgba(248,243,235,0.4)"
              >{{ col.title }}</span
            >
            @for (link of col.links; track link) {
              <a href="#" style="font-family: var(--font-sans); font-size: 14px; color: rgba(248,243,235,0.8)">{{
                link
              }}</a>
            }
          </div>
        }
      </div>

      <div style="height: 1px; background: rgba(248,243,235,0.08)"></div>

      <div class="flex items-center justify-between flex-wrap" style="gap: 16px">
        <span style="font-family: var(--font-sans); font-size: 13px; color: rgba(248,243,235,0.4)">
          © 2026 takeAway. All rights reserved.
        </span>
        <div class="flex items-center" style="gap: 20px; color: rgba(248,243,235,0.6)">
          <span>📷</span><span>🐦</span><span>📘</span>
        </div>
      </div>
    </footer>

    <!-- Hero — pencil SNCQE (bottom banner) -->
    <section
      class="flex flex-col items-center justify-center text-center"
      style="background: var(--color-caramel); padding: 80px 120px; gap: 32px; min-height: 600px"
    >
      <h1
        style="font-family: var(--font-display); font-size: 56px; font-weight: 700; color: var(--color-cream); line-height: 1.05; max-width: 900px"
      >
        Pre-order. Zero queue.
      </h1>
      <p
        style="font-family: var(--font-sans); font-size: 20px; color: var(--color-cream); max-width: 700px; text-align: center; line-height: 1.5"
      >
        Your coffee and food ready the moment you arrive. No waiting.
      </p>
      <div class="flex items-center" style="gap: 16px; flex-wrap: wrap; justify-content: center">
        <a
          routerLink="/menu"
          style="padding: 14px 32px; background: var(--color-cream); color: var(--color-caramel); border-radius: 14px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
          >Order now</a
        >
        <a
          href="#"
          style="padding: 14px 32px; background: var(--color-caramel); border: 2px solid var(--color-cream); color: var(--color-cream); border-radius: 14px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
          >Download app</a
        >
      </div>
    </section>
  `,
})
export class HomePage implements OnInit {
  private readonly catalog = inject(CatalogService);
  readonly stores = signal<StoreListItem[]>([]);

  readonly categories: HomeCategory[] = [
    { slug: 'coffee', name: 'Coffee', bg: 'var(--color-caramel-light)', emoji: '☕' },
    { slug: 'tea', name: 'Tea', bg: '#9DB87E33', emoji: '🍵' },
    { slug: 'signature', name: 'Signature', bg: '#8E5FB033', emoji: '✨' },
    { slug: 'breakfast', name: 'Breakfast', bg: '#F5C95C33', emoji: '🍳' },
    { slug: 'lunch', name: 'Lunch', bg: '#C86A4B33', emoji: '🥗' },
    { slug: 'desserts', name: 'Desserts', bg: '#E8A0B433', emoji: '🍰' },
  ];

  readonly howSteps: HowStep[] = [
    { num: '01', title: 'Choose a store', desc: 'Find the nearest takeAway store on the map' },
    { num: '02', title: 'Customize', desc: 'Pick size, milk, syrups and toppings' },
    { num: '03', title: 'Pick it up', desc: 'Grab your order — no queue, no waiting' },
  ];

  readonly footerColumns = [
    { title: 'PRODUCT', links: ['Menu', 'Stores', 'Loyalty', 'Gift cards'] },
    { title: 'COMPANY', links: ['About', 'Franchise', 'Careers', 'Press'] },
    { title: 'SUPPORT', links: ['Help center', 'Contact us', 'Privacy policy', 'Terms of service'] },
  ];

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => this.stores.set(list.slice(0, 6)),
    });
  }

  etaMin(store: StoreListItem): number {
    return Math.max(1, Math.round(store.currentEtaSeconds / 60));
  }

  etaBg(store: StoreListItem): string {
    if (store.busyMeter >= 75) return 'var(--color-berry)';
    if (store.busyMeter >= 40) return 'var(--color-amber)';
    return 'var(--color-mint)';
  }
}
