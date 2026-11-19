import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';

import { InactiveDaysComponent } from './inactive-days.component';

@Component({
  standalone: true,
  imports: [InactiveDaysComponent],
  template: `<app-inactive-days [(days)]="days" />`,
})
class PageHost {
  readonly days = signal(14);
}

@Component({
  standalone: true,
  imports: [InactiveDaysComponent, ReactiveFormsModule],
  template: `<app-inactive-days [formControl]="control" [showLabel]="false" />`,
})
class FormHost {
  readonly control = new FormControl<number>(3, { nonNullable: true });
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('InactiveDaysComponent', () => {
  function setUp() {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
  }

  const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button.idays-pill')];
  const pressed = (el: HTMLElement) => text(el.querySelector('button[aria-pressed="true"]'));

  beforeEach(() => TestBed.resetTestingModule());

  it('offers 7 / 14 / 30 / 90 days and «Свой…» under «Не заказывали»', () => {
    setUp();
    const fixture = TestBed.createComponent(PageHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('.idays-label'))).toBe('Не заказывали');
    expect(el.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Не заказывали');
    expect(buttons(el).map(text)).toEqual(['7 дн.', '14 дн.', '30 дн.', '90 дн.', 'Свой…']);
    expect(pressed(el)).toBe('14 дн.');
  });

  it('hands a preset back to the page', () => {
    setUp();
    const fixture = TestBed.createComponent(PageHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    buttons(el)[2]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.days()).toBe(30);
    expect(pressed(el)).toBe('30 дн.');
  });

  it('takes a custom whole number from 1 to 365 and shows it as its own pill', () => {
    setUp();
    const fixture = TestBed.createComponent(PageHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    buttons(el)[4]?.click();
    fixture.detectChanges();
    const field = el.querySelector('input') as HTMLInputElement;
    expect(field.value).toBe('14');
    expect(field.getAttribute('aria-label')).toBe('Дней без заказа, от 1 до 365');
    const apply = el.querySelector('.idays-apply') as HTMLButtonElement;

    for (const wrong of ['0', '366', '2.5', '']) {
      field.value = wrong;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(apply.disabled).toBe(true);
    }

    field.value = '45';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.days()).toBe(45);
    expect(el.querySelector('input')).toBeNull();
    expect(pressed(el)).toBe('45 дн.');
  });

  it('works as a form control: an old saved 3 shows, a pick writes the value, disabling disables it', () => {
    setUp();
    const fixture = TestBed.createComponent(FormHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.idays-label')).toBeNull();
    expect(pressed(el)).toBe('3 дн.');

    buttons(el)[3]?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBe(90);
    expect(fixture.componentInstance.control.touched).toBe(true);

    fixture.componentInstance.control.disable();
    fixture.detectChanges();
    expect(buttons(el).every((b) => b.disabled)).toBe(true);
  });
});
