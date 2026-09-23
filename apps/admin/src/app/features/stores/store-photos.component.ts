import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreImageKind, type StoreImagesDto } from '../../core/catalog/admin-catalog.service';
import { storeErrorMessage } from './store-errors';

/** Mirrors MAX_STORE_GALLERY_IMAGES on the API. */
export const MAX_GALLERY_PHOTOS = 8;

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';

/**
 * The store's cover photo and gallery. Each upload is saved the moment the
 * API accepts it, so this tab has nothing for the editor's Save button.
 */
@Component({
  selector: 'app-store-photos',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="flex flex-col" style="gap: 20px">
      <section class="flex flex-col" style="gap: 8px">
        <h4
          style="margin: 0; font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-espresso)"
        >
          {{ 'admin.stores.photos.hero' | translate }}
        </h4>
        <p style="margin: 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
          {{ 'admin.stores.photos.heroHint' | translate }}
        </p>
        <div class="flex items-center flex-wrap" style="gap: 12px">
          @if (hero(); as url) {
            <img
              [src]="url"
              alt=""
              style="width: 220px; max-width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 12px; border: 1px solid var(--color-border-light); background: var(--color-foam)"
            />
          } @else {
            <div
              class="flex items-center justify-center"
              style="width: 220px; max-width: 100%; aspect-ratio: 16 / 9; border-radius: 12px; border: 1px dashed var(--color-border); font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
            >
              {{ 'admin.stores.photos.noHero' | translate }}
            </div>
          }
          @if (canEdit()) {
            <div class="flex flex-col" style="gap: 8px">
              <label
                [style.opacity]="busy() ? 0.5 : 1"
                style="padding: 8px 14px; background: var(--color-latte); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-espresso); cursor: pointer"
              >
                {{
                  (busy() === 'hero'
                    ? 'admin.stores.photos.uploading'
                    : hero()
                      ? 'admin.stores.photos.replace'
                      : 'admin.stores.photos.upload'
                  ) | translate
                }}
                <input
                  type="file"
                  [accept]="accept"
                  [disabled]="!!busy()"
                  (change)="upload('hero', $event)"
                  style="display: none"
                />
              </label>
              @if (hero()) {
                <button
                  type="button"
                  (click)="remove('hero')"
                  [disabled]="!!busy()"
                  style="padding: 0; background: none; border: 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-berry); cursor: pointer"
                >
                  {{ 'admin.stores.photos.remove' | translate }}
                </button>
              }
            </div>
          }
        </div>
      </section>

      <section class="flex flex-col" style="gap: 8px">
        <h4
          style="margin: 0; font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-espresso)"
        >
          {{ 'admin.stores.photos.gallery' | translate }} · {{ gallery().length }}/{{ max }}
        </h4>
        <p style="margin: 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
          {{ 'admin.stores.photos.galleryHint' | translate: { max: max } }}
        </p>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px">
          @for (url of gallery(); track url) {
            <figure style="position: relative; margin: 0">
              <img
                [src]="url"
                alt=""
                style="display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 10px; border: 1px solid var(--color-border-light)"
              />
              @if (canEdit()) {
                <button
                  type="button"
                  (click)="remove('gallery', url)"
                  [disabled]="!!busy()"
                  [attr.aria-label]="'admin.stores.photos.remove' | translate"
                  [title]="'admin.stores.photos.remove' | translate"
                  style="position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; border-radius: 999px; background: rgba(26, 20, 20, 0.7); color: white; border: 0; font-size: 15px; line-height: 1; cursor: pointer"
                >
                  ×
                </button>
              }
            </figure>
          } @empty {
            @if (!canEdit()) {
              <p style="margin: 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
                {{ 'admin.stores.photos.empty' | translate }}
              </p>
            }
          }
          @if (canEdit() && gallery().length < max) {
            <label
              class="flex items-center justify-center"
              [style.opacity]="busy() ? 0.5 : 1"
              style="aspect-ratio: 4 / 3; border: 1px dashed var(--color-border); border-radius: 10px; font-family: var(--font-sans); font-size: 13px; color: var(--color-caramel); text-align: center; padding: 8px; cursor: pointer"
            >
              {{ (busy() === 'gallery' ? 'admin.stores.photos.uploading' : 'admin.stores.photos.add') | translate }}
              <input
                type="file"
                [accept]="accept"
                [disabled]="!!busy()"
                (change)="upload('gallery', $event)"
                style="display: none"
              />
            </label>
          }
        </div>
      </section>

      @if (error()) {
        <p role="alert" style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
          {{ error() }}
        </p>
      }
    </div>
  `,
})
export class StorePhotosComponent {
  readonly storeId = input.required<string>();
  readonly heroImageUrl = input<string | null>(null);
  readonly galleryUrls = input<string[]>([]);
  readonly canEdit = input(false);
  readonly changed = output<StoreImagesDto>();

  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);

  readonly max = MAX_GALLERY_PHOTOS;
  readonly accept = ACCEPT;
  readonly hero = linkedSignal(() => this.heroImageUrl());
  readonly gallery = linkedSignal(() => this.galleryUrls());
  readonly busy = signal<StoreImageKind | null>(null);
  readonly error = signal<string | null>(null);

  upload(kind: StoreImageKind, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy()) return;
    this.busy.set(kind);
    this.error.set(null);
    this.api.uploadStoreImage(this.storeId(), kind, file).subscribe({
      next: (images) => this.apply(images),
      error: (err) => this.fail(err),
    });
  }

  remove(kind: StoreImageKind, url?: string): void {
    if (this.busy()) return;
    if (!confirm(this.translate.instant('admin.stores.photos.removeConfirm'))) return;
    this.busy.set(kind);
    this.error.set(null);
    this.api.removeStoreImage(this.storeId(), kind, url).subscribe({
      next: (images) => this.apply(images),
      error: (err) => this.fail(err),
    });
  }

  private apply(images: StoreImagesDto): void {
    this.busy.set(null);
    this.hero.set(images.heroImageUrl);
    this.gallery.set(images.galleryUrls);
    this.changed.emit(images);
  }

  private fail(err: unknown): void {
    this.busy.set(null);
    this.error.set(storeErrorMessage(err, this.translate));
  }
}
