import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LocalDatePipe } from '@takeaway/i18n';
import type { InboxItem } from '@takeaway/shared-types';

import { InboxService, inboxLinkRoute } from '../../core/inbox/inbox.service';

/**
 * «Уведомления» — campaigns of the places the customer orders from and
 * announcements from takeAway, newest first. Opening a message marks it
 * read and shows the whole text; a message about a place offers its menu.
 * A tapped browser push lands here with `?open=<id>`, that message open.
 * Signed-in only (the route's guard).
 */
@Component({
  selector: 'app-profile-inbox',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LocalDatePipe],
  template: `
    <section style="min-height: calc(100vh - 72px); background: var(--color-cream); padding: 32px 16px">
      <div style="max-width: 640px; margin: 0 auto">
        <a
          routerLink="/profile"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); text-decoration: none"
          >← {{ 'common.back' | translate }}</a
        >
        <div class="flex items-center justify-between flex-wrap" style="gap: 8px; margin: 12px 0 8px">
          <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 0">
            {{ 'web.profile.inbox.title' | translate }}
          </h1>
          @if (hasUnread()) {
            <button type="button" class="read-all" (click)="readAll()">
              {{ 'web.profile.inbox.readAll' | translate }}
            </button>
          }
        </div>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
          {{ 'web.profile.inbox.subtitle' | translate }}
          <a routerLink="/profile/notifications" style="color: var(--color-caramel); font-weight: 600">{{
            'web.profile.inbox.settings' | translate
          }}</a>
        </p>

        @if (error()) {
          <div class="flex flex-col" style="gap: 8px">
            <p
              role="alert"
              style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0"
            >
              {{ 'web.profile.inbox.error' | translate }}
            </p>
            <button type="button" class="read-all" style="align-self: flex-start" (click)="reload()">
              {{ 'common.retry' | translate }}
            </button>
          </div>
        } @else if (loading() && items().length === 0) {
          <p style="font-family: var(--font-sans); color: var(--color-text-secondary)">
            {{ 'common.loading' | translate }}
          </p>
        } @else {
          <ul class="inbox-list">
            @for (item of items(); track item.id) {
              <li>
                <button
                  type="button"
                  class="inbox-row"
                  [class.is-open]="openId() === item.id"
                  [attr.aria-expanded]="openId() === item.id"
                  (click)="toggle(item)"
                >
                  @if (item.sender.logoUrl) {
                    <img class="avatar" [src]="item.sender.logoUrl" alt="" loading="lazy" />
                  } @else if (item.sender.kind === 'PLATFORM') {
                    <img class="avatar avatar-mark" src="/favicon.svg" alt="" />
                  } @else {
                    <span class="avatar avatar-letter" aria-hidden="true">{{ item.sender.name.charAt(0) }}</span>
                  }
                  <span class="flex flex-col flex-1" style="gap: 2px; min-width: 0">
                    <span class="flex items-center" style="gap: 8px">
                      <span class="sender">{{ item.sender.name }}</span>
                      <span class="time">{{ item.createdAt | localDate: 'dateTime' }}</span>
                    </span>
                    <span class="title">{{ item.title }}</span>
                    <span class="body" [class.is-clamped]="openId() !== item.id">{{ item.body }}</span>
                  </span>
                  @if (!item.readAt) {
                    <span class="unread-dot" [attr.aria-label]="'web.profile.inbox.unread' | translate"></span>
                  }
                </button>
                @if (openId() === item.id && item.link; as link) {
                  <a class="link-cta" [routerLink]="linkRoute(item)">
                    {{
                      (link.storeSlug || link.storeId ? 'web.profile.inbox.openMenu' : 'web.profile.inbox.openStores')
                        | translate: { name: link.name }
                    }}
                  </a>
                }
              </li>
            } @empty {
              <li class="empty">
                <span style="font-size: 36px" aria-hidden="true">🔔</span>
                <span>{{ 'web.profile.inbox.empty' | translate }}</span>
              </li>
            }
          </ul>
          @if (nextCursor()) {
            <button type="button" class="load-more" [disabled]="loading()" (click)="loadMore()">
              {{ (loading() ? 'common.loading' : 'web.profile.inbox.loadMore') | translate }}
            </button>
          }
        }
      </div>
    </section>
  `,
  styles: [
    `
      .inbox-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .inbox-row {
        width: 100%;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 16px;
        background: var(--color-foam);
        border-radius: 14px;
        text-align: left;
        cursor: pointer;
        border: 1px solid transparent;
      }
      .inbox-row.is-open {
        border-color: var(--color-border-light);
      }
      .avatar {
        width: 40px;
        height: 40px;
        border-radius: 9999px;
        flex-shrink: 0;
        object-fit: cover;
        background: var(--color-cream);
      }
      .avatar-mark {
        object-fit: contain;
        padding: 6px;
      }
      .avatar-letter {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-display);
        font-size: 18px;
        font-weight: 700;
        color: var(--color-caramel);
      }
      .sender {
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-caramel);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .time {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
        white-space: nowrap;
      }
      .title {
        font-family: var(--font-sans);
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .body {
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--color-text-secondary);
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .body.is-clamped {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .unread-dot {
        width: 10px;
        height: 10px;
        margin-top: 6px;
        border-radius: 9999px;
        background: var(--color-caramel);
        flex-shrink: 0;
      }
      .link-cta {
        display: inline-flex;
        align-items: center;
        height: 40px;
        margin: 8px 0 4px 68px;
        padding: 0 16px;
        background: var(--color-caramel);
        color: white;
        border-radius: var(--radius-pill);
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
      }
      .read-all,
      .load-more {
        height: 36px;
        padding: 0 14px;
        background: transparent;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-pill);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .load-more {
        display: block;
        margin: 16px auto 0;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 32px 16px;
        background: var(--color-foam);
        border-radius: var(--radius-card);
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--color-text-secondary);
        text-align: center;
      }
    `,
  ],
})
export class ProfileInboxPage implements OnInit {
  private readonly inbox = inject(InboxService);
  private readonly openParam = inject(ActivatedRoute).snapshot.queryParamMap.get('open');

  readonly items = signal<InboxItem[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  /** The message whose whole text is shown. */
  readonly openId = signal<string | null>(null);
  readonly hasUnread = computed(() => this.items().some((i) => !i.readAt));

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.items.set([]);
    this.nextCursor.set(null);
    this.error.set(false);
    this.fetch(undefined, () => this.openFromPush());
  }

  loadMore(): void {
    const cursor = this.nextCursor();
    if (cursor && !this.loading()) this.fetch(cursor);
  }

  /** Opens (and marks read) or closes a message. */
  toggle(item: InboxItem): void {
    if (this.openId() === item.id) {
      this.openId.set(null);
      return;
    }
    this.open(item);
  }

  readAll(): void {
    const now = new Date().toISOString();
    this.inbox.markAllRead().subscribe({ error: () => this.inbox.refreshUnread() });
    this.items.update((list) => list.map((i) => (i.readAt ? i : { ...i, readAt: now })));
  }

  linkRoute(item: InboxItem): string | null {
    return item.link ? inboxLinkRoute(item.link) : null;
  }

  private open(item: InboxItem): void {
    this.openId.set(item.id);
    if (item.readAt) return;
    this.inbox.markRead(item).subscribe({ error: () => this.inbox.refreshUnread() });
    const now = new Date().toISOString();
    this.items.update((list) => list.map((i) => (i.id === item.id ? { ...i, readAt: now } : i)));
  }

  /** `?open=<id>` from a tapped push: that message, open — fetched on its own when it is not on the first page. */
  private openFromPush(): void {
    const id = this.openParam;
    if (!id) return;
    const found = this.items().find((i) => i.id === id);
    if (found) {
      this.open(found);
      return;
    }
    this.inbox.get(id).subscribe({
      next: (item) => {
        this.items.update((list) => [item, ...list.filter((i) => i.id !== item.id)]);
        this.open(item);
      },
      error: () => undefined,
    });
  }

  private fetch(cursor: string | undefined, then?: () => void): void {
    this.loading.set(true);
    this.inbox.list(cursor).subscribe({
      next: (page) => {
        this.items.update((list) => [...list, ...page.items.filter((i) => !list.some((x) => x.id === i.id))]);
        this.nextCursor.set(page.nextCursor);
        this.loading.set(false);
        then?.();
      },
      error: () => {
        this.loading.set(false);
        if (this.items().length === 0) this.error.set(true);
      },
    });
  }
}
