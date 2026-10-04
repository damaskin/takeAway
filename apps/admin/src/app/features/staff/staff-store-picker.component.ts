import { Component, input, model } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export interface PickableStore {
  id: string;
  name: string;
  city?: string | null;
}

/** "Works at": one checkbox per store, as a fieldset so it reads as one question. */
@Component({
  selector: 'app-staff-store-picker',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <fieldset class="picker" [disabled]="disabled()">
      <legend class="field-label">{{ 'admin.staff.storesLabel' | translate }}</legend>
      @if (stores().length === 0) {
        <p class="empty">{{ 'admin.staff.noStores' | translate }}</p>
      } @else {
        <div class="grid">
          @for (s of stores(); track s.id) {
            <label class="option" [class.option-on]="isOn(s.id)">
              <input type="checkbox" [checked]="isOn(s.id)" (change)="toggle(s.id, $event)" />
              <span class="name">{{ s.name }}</span>
              @if (s.city) {
                <span class="city">{{ s.city }}</span>
              }
            </label>
          }
        </div>
      }
    </fieldset>
  `,
  styles: [
    `
      .picker {
        border: 0;
        margin: 0;
        padding: 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .picker legend {
        padding: 0;
        margin-bottom: 8px;
      }
      .grid {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      }
      .option {
        display: grid;
        grid-template-columns: auto 1fr;
        column-gap: 10px;
        align-items: center;
        min-height: 44px;
        padding: 8px 12px;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        cursor: pointer;
        font-family: var(--font-sans);
      }
      .option-on {
        border-color: var(--color-caramel);
      }
      .option input {
        width: 18px;
        height: 18px;
        accent-color: var(--color-caramel);
        grid-row: span 2;
      }
      .name {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }
      .city {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .empty {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      fieldset:disabled .option {
        cursor: default;
        opacity: 0.7;
      }
    `,
  ],
})
export class StaffStorePickerComponent {
  readonly stores = input.required<PickableStore[]>();
  readonly selected = model<string[]>([]);
  readonly disabled = input(false);

  isOn(id: string): boolean {
    return this.selected().includes(id);
  }

  toggle(id: string, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.selected.update((ids) => (on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id)));
  }
}
