import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';

import { DateRangeComponent, type DateRangeValue } from './date-range.component';

@Component({
  standalone: true,
  imports: [DateRangeComponent],
  template: `<app-date-range [(value)]="range" />`,
})
class HostComponent {
  readonly range = signal<DateRangeValue>({ days: 7 });
}

describe('DateRangeComponent', () => {
  async function render() {
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideTranslateService()] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('switches presets', async () => {
    const fixture = await render();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.range-pill');
    expect([...buttons].map((b) => b.textContent?.trim())).toEqual(['7 дн.', '14 дн.', '30 дн.', '90 дн.', 'Период…']);
    buttons[2]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.range()).toEqual({ days: 30 });
  });

  it('applies a calendar range and refuses a reversed one', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelectorAll<HTMLButtonElement>('.range-pill')[4]?.click();
    fixture.detectChanges();

    const [from, to] = [...el.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    const type = (input: HTMLInputElement | undefined, value: string) => {
      if (!input) throw new Error('no input');
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    type(from, '2026-09-20');
    type(to, '2026-09-10');
    expect(el.querySelector('.range-error')?.textContent).toContain('Начало позже конца');
    expect(el.querySelector<HTMLButtonElement>('.range-apply')?.disabled).toBe(true);

    type(to, '2026-09-25');
    el.querySelector<HTMLButtonElement>('.range-apply')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.range()).toEqual({ from: '2026-09-20', to: '2026-09-25' });
    expect(el.querySelectorAll('.range-pill')[4]?.textContent).toContain('20.09');
  });
});
