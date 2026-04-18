import { Component, signal } from '@angular/core';

interface Promo {
  code: string;
  label: string;
  type: 'PERCENT' | 'FIXED' | 'BOGO' | 'POINTS';
  value: string;
  startsAt: string;
  endsAt: string;
  usage: string;
  active: boolean;
}

/**
 * Admin Promo / Loyalty — pencil C4 (5fLM7).
 *
 * pTop (foam, 64px) — title + "New promo" CTA
 * pBody (padding 24, gap 24) — tier cards row + promo table.
 */
@Component({
  selector: 'app-admin-promo',
  standalone: true,
  template: `
    <div
      class="flex items-center justify-between"
      style="height: 64px; padding: 0 24px; background: var(--color-foam); border-bottom: 1px solid var(--color-border-light)"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        Promo & Loyalty
      </h1>
      <div class="flex items-center" style="gap: 8px">
        <button
          type="button"
          class="flex items-center"
          style="height: 36px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
        >
          Edit tiers
        </button>
        <button
          type="button"
          class="flex items-center"
          style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
        >
          + New promo
        </button>
      </div>
    </div>

    <section style="padding: 24px; display: flex; flex-direction: column; gap: 24px">
      <!-- Loyalty tier cards -->
      <div class="grid" style="grid-template-columns: repeat(4, 1fr); gap: 16px">
        @for (t of tiers; track t.name) {
          <article
            class="flex flex-col"
            [style.background]="t.gradient"
            style="border-radius: 20px; padding: 20px; gap: 8px; color: white"
          >
            <span
              style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8); letter-spacing: 1px"
              >{{ t.name.toUpperCase() }}</span
            >
            <span style="font-family: var(--font-display); font-size: 28px; font-weight: 700">
              {{ t.members }}
            </span>
            <span style="font-family: var(--font-sans); font-size: 12px; color: rgba(255,255,255,0.8)">
              {{ t.threshold }} pts · {{ t.benefit }}
            </span>
          </article>
        }
      </div>

      <!-- Active promos table -->
      <article
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; overflow: hidden"
      >
        <header
          class="flex items-center justify-between"
          style="padding: 20px; border-bottom: 1px solid var(--color-border-light)"
        >
          <div class="flex flex-col" style="gap: 4px">
            <h2
              style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
            >
              Active promotions
            </h2>
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
              >{{ promos.length }} total · 3 running now</span
            >
          </div>
          <div class="flex" style="gap: 8px">
            @for (f of filters; track f) {
              <button
                type="button"
                (click)="filter.set(f)"
                [style.background]="filter() === f ? 'var(--color-caramel)' : 'var(--color-cream)'"
                [style.color]="filter() === f ? 'white' : 'var(--color-text-primary)'"
                style="height: 30px; padding: 0 14px; border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
              >
                {{ f }}
              </button>
            }
          </div>
        </header>

        <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans)">
          <thead style="background: var(--color-cream)">
            <tr>
              <th
                style="text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Code
              </th>
              <th
                style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Label
              </th>
              <th
                style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Type
              </th>
              <th
                style="text-align: right; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Value
              </th>
              <th
                style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Window
              </th>
              <th
                style="text-align: right; padding: 12px 16px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Usage
              </th>
              <th
                style="text-align: center; padding: 12px 16px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            @for (p of promos; track p.code) {
              <tr style="border-top: 1px solid var(--color-border-light)">
                <td
                  style="padding: 12px 16px; font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--color-caramel)"
                >
                  {{ p.code }}
                </td>
                <td style="padding: 12px; font-size: 14px; color: var(--color-text-primary)">
                  {{ p.label }}
                </td>
                <td style="padding: 12px; font-size: 13px; color: var(--color-text-secondary)">
                  {{ p.type }}
                </td>
                <td
                  style="padding: 12px; font-size: 14px; font-weight: 600; color: var(--color-text-primary); text-align: right"
                >
                  {{ p.value }}
                </td>
                <td style="padding: 12px; font-size: 12px; color: var(--color-text-secondary)">
                  {{ p.startsAt }} — {{ p.endsAt }}
                </td>
                <td style="padding: 12px; font-size: 13px; color: var(--color-text-secondary); text-align: right">
                  {{ p.usage }}
                </td>
                <td style="padding: 12px 16px; text-align: center">
                  <span
                    [style.background]="p.active ? '#7BC4A433' : 'var(--color-surface-variant)'"
                    [style.color]="p.active ? '#3E8868' : 'var(--color-text-secondary)'"
                    style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                    >{{ p.active ? 'Running' : 'Paused' }}</span
                  >
                </td>
              </tr>
            }
          </tbody>
        </table>
      </article>
    </section>
  `,
})
export class AdminPromoPage {
  readonly filter = signal<'All' | 'Running' | 'Scheduled' | 'Expired'>('All');
  readonly filters: Array<'All' | 'Running' | 'Scheduled' | 'Expired'> = ['All', 'Running', 'Scheduled', 'Expired'];

  readonly tiers = [
    {
      name: 'Silver',
      members: '4,218',
      threshold: '0',
      benefit: '5% off every 10th cup',
      gradient: 'linear-gradient(135deg, #A39888 0%, #6B5E54 100%)',
    },
    {
      name: 'Gold',
      members: '1,842',
      threshold: '1,500',
      benefit: 'Free size upgrade',
      gradient: 'linear-gradient(135deg, var(--color-caramel) 0%, #a0612a 100%)',
    },
    {
      name: 'Platinum',
      members: '612',
      threshold: '3,000',
      benefit: 'Free drink every 8th visit',
      gradient: 'linear-gradient(135deg, #8E5FB0 0%, #5B3D78 100%)',
    },
    {
      name: 'Signature',
      members: '78',
      threshold: '10,000',
      benefit: 'Priority pickup + gifts',
      gradient: 'linear-gradient(135deg, #1a1414 0%, #3a3430 100%)',
    },
  ];

  readonly promos: Promo[] = [
    {
      code: 'WELCOME10',
      label: 'First-time 10% off',
      type: 'PERCENT',
      value: '10%',
      startsAt: 'Apr 1',
      endsAt: 'Jun 30',
      usage: '318/1000',
      active: true,
    },
    {
      code: 'MATCHAHAPPY',
      label: 'Matcha Happy Hour · 3-5 PM',
      type: 'PERCENT',
      value: '20%',
      startsAt: 'Apr 10',
      endsAt: 'Apr 30',
      usage: '72/500',
      active: true,
    },
    {
      code: 'CROISSANT2',
      label: 'Croissant BOGO',
      type: 'BOGO',
      value: 'Buy 1 get 1',
      startsAt: 'Apr 15',
      endsAt: 'May 5',
      usage: '44/200',
      active: true,
    },
    {
      code: 'SPRING2026',
      label: 'Spring points boost',
      type: 'POINTS',
      value: '2× pts',
      startsAt: 'May 1',
      endsAt: 'May 31',
      usage: '0/—',
      active: false,
    },
    {
      code: 'WINTER5',
      label: 'Loyalty winter $5',
      type: 'FIXED',
      value: '$5 off',
      startsAt: 'Dec 1',
      endsAt: 'Jan 15',
      usage: '1,240/1,500',
      active: false,
    },
  ];
}
