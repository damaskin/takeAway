import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  type CatalogGroup,
  type CatalogOption,
  OPTION_GROUP_KINDS,
  type OptionGroupKind,
  type UpsertCatalogGroupRequest,
  type UpsertCatalogOptionRequest,
} from '@takeaway/shared-types';
import { type Observable, forkJoin } from 'rxjs';

import { groupsOfKind, moveWrites, nextSortOrder, sortCatalog } from '../../core/catalog/option-catalog';
import { OptionCatalogApi } from '../../core/catalog/option-catalog.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { MENU_FORM_STYLES } from '../menu/menu-form.styles';
import { describeOptionError } from './option-errors';
import { OptionGroupFormComponent } from './option-group-form.component';
import { OptionItemFormComponent } from './option-item-form.component';

type PendingDelete = { group: CatalogGroup; option: CatalogOption | null };

/**
 * «Каталог добавок» — the platform's one catalog of option groups
 * (SUPER_ADMIN, `docs/option-groups.md`). Variants and add-ons in two
 * lists; each group with its type, bounds, condition and how many products
 * use it, and its options under it. The takeAway team creates, edits,
 * orders (up/down) and deletes groups and options here; a brand only
 * attaches groups to its products and prices them. A group attached to a
 * product cannot be deleted — the API refuses (OPTION_GROUP_IN_USE) and the
 * page says why.
 *
 * Every write reloads the catalog: it is a few dozen groups, and the list
 * then always shows what the API holds.
 */
@Component({
  selector: 'app-option-catalog',
  standalone: true,
  imports: [TranslatePipe, ConfirmDialogComponent, OptionGroupFormComponent, OptionItemFormComponent],
  styles: [
    MENU_FORM_STYLES,
    `
      .group {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 14px;
      }
      .kind-title {
        margin: 8px 0 0;
        font-family: var(--font-display);
        font-size: 18px;
        color: var(--color-espresso);
      }
      .group-name {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 15px;
        font-weight: 700;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }
      .meta {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .options {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .option {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 10px;
        padding: 6px 10px;
        border-radius: 8px;
        background: var(--color-cream);
        font-family: var(--font-sans);
        font-size: 13px;
      }
      .badge {
        padding: 1px 8px;
        border-radius: 9999px;
        background: var(--color-caramel-light);
        color: var(--color-caramel);
        font-size: 11px;
        font-weight: 600;
      }
      .actions {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin-left: auto;
      }
      .arrow {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        border: 1px solid var(--color-border-light);
        background: transparent;
        color: var(--color-text-secondary);
      }
    `,
  ],
  template: `
    <div
      class="flex items-center flex-wrap"
      style="min-height: 64px; padding: 12px clamp(12px, 3vw, 24px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px 16px"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.optionsCatalog.catalog.title' | translate }}
      </h1>
    </div>

    <section
      class="flex flex-col"
      style="padding: clamp(16px, 3vw, 24px); gap: 14px; max-width: 960px"
      data-testid="option-catalog"
    >
      <p class="hint" style="margin: 0; font-size: 13px; color: var(--color-text-secondary)">
        {{ 'admin.optionsCatalog.catalog.hint' | translate }}
      </p>

      @if (creating()) {
        <app-option-group-form
          [groups]="groups()"
          [busy]="busy()"
          (submitted)="createGroup($event)"
          (cancelled)="creating.set(false)"
        />
      } @else {
        <button
          type="button"
          class="primary"
          style="align-self: flex-start"
          (click)="startCreate()"
          data-testid="option-group-new"
        >
          {{ 'admin.optionsCatalog.catalog.newGroup' | translate }}
        </button>
      }

      @if (error(); as message) {
        <p role="alert" class="error" style="margin: 0; font-size: 13px" data-testid="option-catalog-error">
          {{ message }}
        </p>
      }
      @if (loading() && groups().length === 0) {
        <p class="hint" style="margin: 0">{{ 'common.loading' | translate }}</p>
      } @else if (loaded() && groups().length === 0) {
        <p class="hint" style="margin: 0">{{ 'admin.optionsCatalog.catalog.empty' | translate }}</p>
      }

      @for (kind of kinds; track kind) {
        <h2 class="kind-title">{{ 'admin.optionsCatalog.kindsPlural.' + kind | translate }}</h2>
        @for (g of byKind()[kind]; track g.id; let first = $first, last = $last, i = $index) {
          <article class="group" data-testid="option-group" [attr.data-group]="g.name">
            @if (editingGroupId() === g.id) {
              <app-option-group-form
                [group]="g"
                [groups]="groups()"
                [busy]="busy()"
                (submitted)="saveGroup(g, $event)"
                (cancelled)="editingGroupId.set(null)"
              />
            } @else {
              <div class="flex items-start flex-wrap" style="gap: 8px 12px">
                <div class="flex flex-col" style="gap: 2px; flex: 1 1 240px; min-width: 0">
                  <h3 class="group-name">{{ g.name }}</h3>
                  <span class="meta" data-testid="option-group-meta">{{ describeGroup(g) }}</span>
                </div>
                <span class="actions">
                  <button
                    type="button"
                    class="arrow disabled:opacity-30"
                    [disabled]="first || busy()"
                    [attr.aria-label]="'admin.optionsCatalog.catalog.moveUp' | translate"
                    (click)="moveGroup(kind, i, -1)"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="arrow disabled:opacity-30"
                    [disabled]="last || busy()"
                    [attr.aria-label]="'admin.optionsCatalog.catalog.moveDown' | translate"
                    (click)="moveGroup(kind, i, 1)"
                  >
                    ↓
                  </button>
                  <button type="button" class="link" [disabled]="busy()" (click)="editGroup(g)">
                    {{ 'admin.optionsCatalog.catalog.edit' | translate }}
                  </button>
                  <button
                    type="button"
                    class="link danger"
                    [disabled]="busy()"
                    (click)="askDelete(g, null)"
                    data-testid="option-group-delete"
                  >
                    {{ 'admin.optionsCatalog.catalog.delete' | translate }}
                  </button>
                </span>
              </div>
            }

            <ul class="options">
              @for (o of g.options; track o.id; let firstOption = $first, lastOption = $last, j = $index) {
                <li class="option" data-testid="option-row">
                  @if (editingOptionId() === o.id) {
                    <app-option-item-form
                      style="flex: 1 1 100%"
                      [group]="g"
                      [option]="o"
                      [busy]="busy()"
                      (submitted)="saveOption(o, $event)"
                      (cancelled)="editingOptionId.set(null)"
                    />
                  } @else {
                    <strong>{{ o.name }}</strong>
                    @if (o.note) {
                      <span class="meta">{{ o.note }}</span>
                    }
                    @if (g.type !== 'C' && o.isDefault) {
                      <span class="badge">{{ 'admin.optionsCatalog.catalog.isDefault' | translate }}</span>
                    }
                    @if (g.type === 'C') {
                      <span class="meta">{{ describeQty(o) }}</span>
                    }
                    <span class="actions">
                      <button
                        type="button"
                        class="arrow disabled:opacity-30"
                        [disabled]="firstOption || busy()"
                        [attr.aria-label]="'admin.optionsCatalog.catalog.moveUp' | translate"
                        (click)="moveOption(g, j, -1)"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        class="arrow disabled:opacity-30"
                        [disabled]="lastOption || busy()"
                        [attr.aria-label]="'admin.optionsCatalog.catalog.moveDown' | translate"
                        (click)="moveOption(g, j, 1)"
                      >
                        ↓
                      </button>
                      <button type="button" class="link" [disabled]="busy()" (click)="editOption(o)">
                        {{ 'admin.optionsCatalog.catalog.edit' | translate }}
                      </button>
                      <button type="button" class="link danger" [disabled]="busy()" (click)="askDelete(g, o)">
                        {{ 'admin.optionsCatalog.catalog.delete' | translate }}
                      </button>
                    </span>
                  }
                </li>
              } @empty {
                <li class="hint">{{ 'admin.optionsCatalog.catalog.noOptions' | translate }}</li>
              }
            </ul>

            @if (addingOptionTo() === g.id) {
              @for (key of [addFormKey()]; track key) {
                <app-option-item-form
                  [group]="g"
                  [busy]="busy()"
                  (submitted)="createOption(g, $event)"
                  (cancelled)="addingOptionTo.set(null)"
                />
              }
            } @else {
              <button
                type="button"
                class="link"
                style="align-self: flex-start"
                [disabled]="busy()"
                (click)="startAddOption(g)"
                data-testid="option-add"
              >
                {{ 'admin.optionsCatalog.catalog.addOption' | translate }}
              </button>
            }
          </article>
        } @empty {
          @if (loaded()) {
            <p class="hint" style="margin: 0">{{ 'admin.optionsCatalog.catalog.emptyKind' | translate }}</p>
          }
        }
      }

      @if (pendingDelete(); as d) {
        @if (d.option; as o) {
          <app-confirm-dialog
            tone="danger"
            [title]="'admin.optionsCatalog.catalog.deleteOptionTitle' | translate: { name: o.name }"
            [body]="'admin.optionsCatalog.catalog.deleteOptionBody' | translate"
            [confirmLabel]="'admin.optionsCatalog.catalog.delete' | translate"
            [cancelLabel]="'common.cancel' | translate"
            [busy]="busy()"
            (confirmed)="confirmDelete(d)"
            (cancelled)="pendingDelete.set(null)"
          />
        } @else {
          <app-confirm-dialog
            tone="danger"
            [title]="'admin.optionsCatalog.catalog.deleteGroupTitle' | translate: { name: d.group.name }"
            [body]="'admin.optionsCatalog.catalog.deleteGroupBody' | translate"
            [warning]="
              d.group.productCount
                ? ('admin.optionsCatalog.catalog.deleteGroupInUse' | translate: { count: d.group.productCount })
                : ''
            "
            [confirmLabel]="'admin.optionsCatalog.catalog.delete' | translate"
            [cancelLabel]="'common.cancel' | translate"
            [busy]="busy()"
            (confirmed)="confirmDelete(d)"
            (cancelled)="pendingDelete.set(null)"
          />
        }
      }
    </section>
  `,
})
export class OptionCatalogPage {
  private readonly api = inject(OptionCatalogApi);
  private readonly translate = inject(TranslateService);

  readonly kinds = OPTION_GROUP_KINDS;
  readonly groups = signal<CatalogGroup[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly creating = signal(false);
  readonly editingGroupId = signal<string | null>(null);
  readonly editingOptionId = signal<string | null>(null);
  readonly addingOptionTo = signal<string | null>(null);
  /** Bumped after an option is added: the add form starts again empty for the next one. */
  readonly addFormKey = signal(0);
  readonly pendingDelete = signal<PendingDelete | null>(null);

  readonly byKind = computed<Record<OptionGroupKind, CatalogGroup[]>>(() => ({
    VARIANT: groupsOfKind(this.groups(), 'VARIANT'),
    ADDON: groupsOfKind(this.groups(), 'ADDON'),
  }));

  /** Option id → «Холодный (Подача)», for the conditions. */
  private readonly optionLabels = computed(() => {
    const labels = new Map<string, string>();
    for (const g of this.groups()) for (const o of g.options) labels.set(o.id, `${o.name} (${g.name})`);
    return labels;
  });

  constructor() {
    this.load();
  }

  /** «A · Выбор из списка · выбрать от 0 до 2 · только если выбрано: Холодный (Подача) · в товарах: 3». */
  describeGroup(g: CatalogGroup): string {
    const t = (key: string, params?: Record<string, unknown>) =>
      this.translate.instant(`admin.optionsCatalog.${key}`, params);
    const parts = [`${g.type} · ${t(`types.${g.type}`)}`];
    if (g.type === 'A') parts.push(t('catalog.select', { min: g.minSelect ?? 0, max: g.maxSelect ?? 1 }));
    if (g.showIfOptionId) {
      parts.push(t('catalog.showIf', { option: this.optionLabels().get(g.showIfOptionId) ?? '—' }));
    }
    if (g.productCount !== undefined) parts.push(t('catalog.products', { count: g.productCount }));
    return parts.join(' · ');
  }

  describeQty(o: CatalogOption): string {
    return this.translate.instant('admin.optionsCatalog.catalog.qty', {
      min: o.minQty ?? 0,
      max: o.maxQty ?? 20,
      start: o.defaultQty ?? 0,
    });
  }

  startCreate(): void {
    this.closeForms();
    this.creating.set(true);
  }

  editGroup(g: CatalogGroup): void {
    this.closeForms();
    this.editingGroupId.set(g.id);
  }

  editOption(o: CatalogOption): void {
    this.closeForms();
    this.editingOptionId.set(o.id);
  }

  startAddOption(g: CatalogGroup): void {
    this.closeForms();
    this.addingOptionTo.set(g.id);
  }

  /** A new group goes to the end of the catalog and opens its first option's form. */
  createGroup(request: UpsertCatalogGroupRequest): void {
    this.run(this.api.createGroup({ ...request, sortOrder: nextSortOrder(this.groups()) }), (created) => {
      this.creating.set(false);
      this.load(() => {
        const id = created?.id ?? this.groups().find((g) => g.name === request.name)?.id ?? null;
        this.addingOptionTo.set(id);
      });
    });
  }

  saveGroup(g: CatalogGroup, request: UpsertCatalogGroupRequest): void {
    this.run(this.api.updateGroup(g.id, request), () => {
      this.editingGroupId.set(null);
      this.load();
    });
  }

  moveGroup(kind: OptionGroupKind, index: number, delta: -1 | 1): void {
    const writes = moveWrites(this.byKind()[kind], index, delta);
    this.runAll(writes.map((w) => this.api.updateGroup(w.id, { sortOrder: w.sortOrder })));
  }

  createOption(g: CatalogGroup, request: UpsertCatalogOptionRequest): void {
    this.run(this.api.createOption(g.id, { ...request, sortOrder: nextSortOrder(g.options) }), () => {
      this.addFormKey.update((k) => k + 1);
      this.load();
    });
  }

  saveOption(o: CatalogOption, request: UpsertCatalogOptionRequest): void {
    this.run(this.api.updateOption(o.id, request), () => {
      this.editingOptionId.set(null);
      this.load();
    });
  }

  moveOption(g: CatalogGroup, index: number, delta: -1 | 1): void {
    const writes = moveWrites(g.options, index, delta);
    this.runAll(writes.map((w) => this.api.updateOption(w.id, { sortOrder: w.sortOrder })));
  }

  askDelete(group: CatalogGroup, option: CatalogOption | null): void {
    this.error.set(null);
    this.pendingDelete.set({ group, option });
  }

  /** A refusal (a group still on products) closes the question and says why above the list. */
  confirmDelete(d: PendingDelete): void {
    const request: Observable<void> = d.option ? this.api.deleteOption(d.option.id) : this.api.deleteGroup(d.group.id);
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.pendingDelete.set(null);
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.pendingDelete.set(null);
        this.error.set(describeOptionError(err, this.translate));
      },
    });
  }

  private closeForms(): void {
    this.error.set(null);
    this.creating.set(false);
    this.editingGroupId.set(null);
    this.editingOptionId.set(null);
    this.addingOptionTo.set(null);
  }

  private runAll(requests: Observable<unknown>[]): void {
    if (requests.length === 0) return;
    this.run(forkJoin(requests), () => this.load());
  }

  private run<T>(request: Observable<T>, onSuccess: (value: T) => void): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: (value) => {
        this.busy.set(false);
        onSuccess(value);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(describeOptionError(err, this.translate));
        // A half-done reorder: show what the API holds now.
        this.load();
      },
    });
  }

  private load(then?: () => void): void {
    this.loading.set(true);
    this.api.listGroups().subscribe({
      next: (list) => {
        this.loading.set(false);
        this.loaded.set(true);
        this.groups.set(sortCatalog(list));
        then?.();
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.loaded.set(true);
        this.error.set(describeOptionError(err, this.translate));
      },
    });
  }
}
