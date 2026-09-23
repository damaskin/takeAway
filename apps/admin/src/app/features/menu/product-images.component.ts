import { HttpEventType } from '@angular/common/http';
import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { describeMenuError } from './menu-errors';

/** Mirrors the API: six photos, raster formats only, 5 MB each. */
export const MAX_PRODUCT_IMAGES = 6;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * A product's photos: upload (several at once, one request each, with
 * progress), remove, and pick the main one — the first photo is what
 * customers see on the menu card. The API stays the judge of type and
 * size; the checks here only spare a pointless upload of a 20 MB HEIC.
 */
@Component({
  selector: 'app-product-images',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <section class="flex flex-col" style="gap: 10px">
      <div class="flex items-center justify-between" style="gap: 8px; flex-wrap: wrap">
        <h4
          style="margin: 0; font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-espresso)"
        >
          {{ 'admin.menu.images.title' | translate }}
        </h4>
        <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
          'admin.menu.images.count' | translate: { count: urls().length, max: max }
        }}</span>
      </div>
      <p style="margin: 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">
        {{ 'admin.menu.images.hint' | translate }}
      </p>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 10px">
        @for (url of urls(); track url; let first = $first) {
          <div class="flex flex-col" style="gap: 6px; min-width: 0">
            <div
              style="position: relative; aspect-ratio: 1 / 1; border-radius: 12px; overflow: hidden; background: linear-gradient(135deg, var(--color-latte) 0%, var(--color-cream) 100%); border: 1px solid var(--color-border-light)"
            >
              <img
                [src]="url"
                alt=""
                loading="lazy"
                style="display: block; width: 100%; height: 100%; object-fit: cover"
              />
              @if (first) {
                <span
                  style="position: absolute; left: 6px; top: 6px; padding: 2px 8px; border-radius: 9999px; background: var(--color-caramel); color: white; font-family: var(--font-sans); font-size: 10px; font-weight: 700"
                  >{{ 'admin.menu.images.primary' | translate }}</span
                >
              }
            </div>
            <div class="flex flex-wrap" style="gap: 4px 10px">
              @if (!first) {
                <button
                  type="button"
                  (click)="makePrimary(url)"
                  [disabled]="busy()"
                  class="disabled:opacity-50"
                  style="padding: 0; font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-caramel); text-align: left"
                >
                  {{ 'admin.menu.images.makePrimary' | translate }}
                </button>
              }
              <button
                type="button"
                (click)="remove(url)"
                [disabled]="busy()"
                class="disabled:opacity-50"
                style="padding: 0; font-family: var(--font-sans); font-size: 12px; font-weight: 500; color: var(--color-berry)"
              >
                {{ 'admin.menu.images.remove' | translate }}
              </button>
            </div>
          </div>
        }

        @if (urls().length < max) {
          <label
            class="flex items-center justify-center"
            [style.cursor]="busy() ? 'default' : 'pointer'"
            [style.opacity]="busy() && !uploading() ? 0.5 : 1"
            style="aspect-ratio: 1 / 1; padding: 8px; border: 1px dashed var(--color-border); border-radius: 12px; background: var(--color-foam); font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-caramel); text-align: center"
          >
            @if (uploading()) {
              <span aria-live="polite">{{ 'admin.menu.images.uploading' | translate: { percent: progress() } }}</span>
            } @else {
              <span>{{ 'admin.menu.images.add' | translate }}</span>
            }
            <input
              type="file"
              [accept]="accept"
              multiple
              [disabled]="busy()"
              (change)="onPicked($event)"
              style="display: none"
            />
          </label>
        }
      </div>

      @if (notice()) {
        <p style="margin: 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">
          {{ notice() }}
        </p>
      }
      @if (error()) {
        <p role="alert" style="margin: 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-berry)">
          {{ error() }}
        </p>
      }
    </section>
  `,
})
export class ProductImagesComponent {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);

  readonly productId = input.required<string>();
  readonly imageUrls = input.required<string[]>();
  /** The new list after every successful change, for the product table's thumbnail. */
  readonly changed = output<string[]>();

  readonly max = MAX_PRODUCT_IMAGES;
  readonly accept = ACCEPTED_TYPES.join(',');
  readonly urls = linkedSignal(() => this.imageUrls());
  readonly busy = signal(false);
  readonly uploading = signal(false);
  readonly progress = signal(0);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  onPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0 || this.busy()) return;
    this.error.set(null);
    this.notice.set(null);

    // A type the browser knows and we do not take, or an oversized file,
    // is refused here; an unknown type ("") is left to the server.
    const bad = files.find((f) => f.type !== '' && !ACCEPTED_TYPES.includes(f.type));
    if (bad) return this.error.set(this.translate.instant('admin.menu.errors.imageType'));
    if (files.some((f) => f.size > MAX_BYTES))
      return this.error.set(this.translate.instant('admin.menu.errors.imageSize'));

    const room = this.max - this.urls().length;
    if (files.length > room) this.notice.set(this.translate.instant('admin.menu.images.onlySome', { max: this.max }));
    this.busy.set(true);
    this.uploadNext(files.slice(0, room));
  }

  makePrimary(url: string): void {
    this.run(this.api.reorderProductImages(this.productId(), [url]));
  }

  remove(url: string): void {
    if (!confirm(this.translate.instant('admin.menu.images.removeConfirm'))) return;
    this.run(this.api.removeProductImage(this.productId(), url));
  }

  private uploadNext(queue: File[]): void {
    const [file, ...rest] = queue;
    if (!file) {
      this.uploading.set(false);
      this.busy.set(false);
      return;
    }
    this.uploading.set(true);
    this.progress.set(0);
    this.api.uploadProductImage(this.productId(), file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.progress.set(Math.min(99, Math.round((100 * event.loaded) / event.total)));
        } else if (event.type === HttpEventType.Response && event.body) {
          this.apply(event.body.imageUrls);
        }
      },
      error: (err: unknown) => {
        this.uploading.set(false);
        this.busy.set(false);
        this.error.set(this.describe(err));
      },
      complete: () => this.uploadNext(rest),
    });
  }

  private run(request: ReturnType<AdminCatalogApi['removeProductImage']>): void {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    request.subscribe({
      next: (res) => {
        this.busy.set(false);
        this.apply(res.imageUrls);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.describe(err));
      },
    });
  }

  private apply(urls: string[]): void {
    this.urls.set(urls);
    this.changed.emit(urls);
  }

  private describe(err: unknown): string {
    return describeMenuError(err, this.translate, { 503: 'admin.menu.errors.storageUnavailable' });
  }
}
