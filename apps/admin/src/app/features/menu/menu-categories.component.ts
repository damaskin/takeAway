import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type CategoryAdminDto } from '../../core/catalog/admin-catalog.service';
import { describeMenuError, menuErrorCode } from './menu-errors';
import { MENU_FORM_STYLES } from './menu-form.styles';
import { swapped } from './menu-order';

/**
 * The category rail: pick, add, rename, hide, reorder and delete. A
 * category that still has products cannot simply go (the API answers 409),
 * so the rail offers to move them into another category first — in one
 * request — instead of leaving the owner staring at an error.
 */
@Component({
  selector: 'app-menu-categories',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe],
  styles: [MENU_FORM_STYLES],
  template: `
    <aside
      class="flex flex-col"
      style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 16px; gap: 4px; min-width: 0"
    >
      <div class="flex items-center justify-between" style="padding: 0 8px 12px 8px; gap: 8px">
        <h2
          style="font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
        >
          {{ 'admin.menu.categories' | translate }}
        </h2>
        @if (brandId()) {
          <a
            routerLink="/menu/categories/new"
            style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--color-caramel); text-decoration: none"
          >
            {{ 'admin.menu.add' | translate }}
          </a>
        }
      </div>

      @if (categories().length === 0) {
        <p
          style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); padding: 8px; margin: 0"
        >
          {{ 'admin.menu.noCategories' | translate }}
        </p>
      }

      @for (cat of categories(); track cat.id; let i = $index, first = $first, last = $last) {
        <div
          class="flex items-center"
          [style.background]="selectedId() === cat.id ? 'var(--color-caramel-light)' : 'transparent'"
          style="border-radius: 10px; gap: 2px; min-width: 0"
        >
          <button
            type="button"
            (click)="selected.emit(cat.id)"
            class="flex items-center"
            [style.color]="selectedId() === cat.id ? 'var(--color-caramel)' : 'var(--color-text-primary)'"
            style="flex: 1; min-width: 0; min-height: 40px; padding: 4px 8px 4px 12px; gap: 8px; font-family: var(--font-sans); font-size: 14px; font-weight: 500; text-align: left; background: transparent"
          >
            <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{
              cat.name
            }}</span>
            @if (!cat.visible) {
              <span
                style="font-size: 10px; font-weight: 600; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.5px"
                >{{ 'admin.menu.hidden' | translate }}</span
              >
            }
            @if (cat._count) {
              <span
                [title]="'admin.menu.category.productCount' | translate: { count: cat._count.products }"
                style="font-size: 12px; color: var(--color-text-tertiary)"
                >{{ cat._count.products }}</span
              >
            }
          </button>
          <button
            type="button"
            (click)="move(i, -1)"
            [disabled]="first || busy()"
            [title]="'admin.menu.moveUp' | translate"
            [attr.aria-label]="'admin.menu.moveUp' | translate"
            class="disabled:opacity-30"
            [style]="iconStyle"
          >
            ↑
          </button>
          <button
            type="button"
            (click)="move(i, 1)"
            [disabled]="last || busy()"
            [title]="'admin.menu.moveDown' | translate"
            [attr.aria-label]="'admin.menu.moveDown' | translate"
            class="disabled:opacity-30"
            [style]="iconStyle"
          >
            ↓
          </button>
          <a
            class="flex items-center justify-center"
            [routerLink]="['/menu/categories', cat.id]"
            [title]="'common.change' | translate"
            [attr.aria-label]="'common.change' | translate"
            [style]="iconStyle"
            style="text-decoration: none"
          >
            ✎
          </a>
          <button
            type="button"
            (click)="startDelete(cat)"
            [disabled]="busy()"
            [title]="'admin.menu.deleteCategory' | translate"
            [attr.aria-label]="'admin.menu.deleteCategory' | translate"
            class="disabled:opacity-30"
            [style]="deleteIconStyle"
          >
            ×
          </button>
        </div>

        @if (deleting()?.id === cat.id) {
          <div
            class="flex flex-col"
            style="gap: 8px; margin: 4px 0 8px; padding: 12px; background: var(--color-cream); border-radius: 12px"
          >
            <p style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)">
              {{ 'admin.menu.category.notEmpty' | translate: { name: cat.name, count: deletingCount() } }}
            </p>
            @if (moveTargets().length > 0) {
              <label class="field">
                <span class="label">{{ 'admin.menu.category.moveTo' | translate }}</span>
                <select class="control small" [formControl]="moveTarget">
                  @for (t of moveTargets(); track t.id) {
                    <option [value]="t.id">{{ t.name }}</option>
                  }
                </select>
              </label>
              <div class="flex items-center flex-wrap" style="gap: 8px 12px">
                <button
                  type="button"
                  class="primary small disabled:opacity-50"
                  [disabled]="busy() || !moveTarget.value"
                  (click)="remove(cat, moveTarget.value)"
                >
                  {{ 'admin.menu.category.moveAndDelete' | translate }}
                </button>
                <button type="button" class="link muted" (click)="deleting.set(null)">
                  {{ 'common.cancel' | translate }}
                </button>
              </div>
            } @else {
              <p class="hint" style="margin: 0">{{ 'admin.menu.category.noOther' | translate }}</p>
              <button type="button" class="link muted" style="align-self: flex-start" (click)="deleting.set(null)">
                {{ 'common.close' | translate }}
              </button>
            }
          </div>
        }
      }

      @if (error()) {
        <p role="alert" class="error" style="margin: 8px 0 0; padding: 0 8px; font-size: 13px">{{ error() }}</p>
      }
    </aside>
  `,
})
export class MenuCategoriesComponent {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);

  readonly categories = input.required<CategoryAdminDto[]>();
  readonly selectedId = input<string | null>(null);
  readonly brandId = input<string | null>(null);

  readonly selected = output<string>();
  /** The list changed on the server: reload it. */
  readonly changed = output<void>();
  /** A category is gone; `movedTo` got its products. */
  readonly deleted = output<{ id: string; movedTo: string | null }>();

  readonly deleting = signal<CategoryAdminDto | null>(null);
  readonly deletingCount = signal(0);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly moveTarget = new FormControl('', { nonNullable: true });
  readonly moveTargets = computed(() => this.categories().filter((c) => c.id !== this.deleting()?.id));

  readonly iconStyle =
    'width: 26px; height: 28px; flex: 0 0 auto; font-size: 14px; color: var(--color-text-tertiary); background: transparent';
  readonly deleteIconStyle = `${this.iconStyle}; color: var(--color-berry); margin-right: 4px`;

  move(index: number, delta: -1 | 1): void {
    const list = swapped(this.categories(), index, index + delta);
    if (!list) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.reorderCategories(list.map((c) => c.id)).subscribe({
      next: () => {
        this.busy.set(false);
        this.changed.emit();
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  startDelete(cat: CategoryAdminDto): void {
    this.error.set(null);
    const count = cat._count?.products ?? 0;
    if (count > 0) return this.askWhereTo(cat, count);
    if (!confirm(this.translate.instant('admin.menu.deleteCategoryConfirm', { name: cat.name }))) return;
    this.remove(cat);
  }

  remove(cat: CategoryAdminDto, moveTo?: string): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.deleteCategory(cat.id, moveTo || undefined).subscribe({
      next: () => {
        this.busy.set(false);
        this.deleting.set(null);
        this.deleted.emit({ id: cat.id, movedTo: moveTo || null });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        // The count we had was stale: someone added a product meanwhile.
        if (menuErrorCode(err) === 'CATEGORY_NOT_EMPTY' && !moveTo) {
          const count = (err as { error?: { productCount?: unknown } }).error?.productCount;
          return this.askWhereTo(cat, typeof count === 'number' ? count : 1);
        }
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }

  private askWhereTo(cat: CategoryAdminDto, count: number): void {
    this.deleting.set(cat);
    this.deletingCount.set(count);
    this.moveTarget.setValue(this.moveTargets()[0]?.id ?? '');
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.error.set(describeMenuError(err, this.translate));
  }
}
