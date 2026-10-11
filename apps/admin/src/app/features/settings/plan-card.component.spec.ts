import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { of, throwError } from 'rxjs';

import { SettingsService } from '../../core/settings/settings.service';
import { PlanCardComponent } from './plan-card.component';

describe('PlanCardComponent — «Перейти на PRO»', () => {
  let requestPlan: jest.Mock;

  function make(planRequestedAt: string | null = null): PlanCardComponent {
    requestPlan = jest.fn().mockReturnValue(of({ requestedPlan: 'PRO', planRequestedAt: '2026-10-10T12:00:00.000Z' }));
    TestBed.configureTestingModule({
      imports: [PlanCardComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: SettingsService, useValue: { requestPlan } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(PlanCardComponent);
    fixture.componentRef.setInput('plan', 'BASIC');
    fixture.componentRef.setInput('planRequestedAt', planRequestedAt);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('sends the request and then says it is sent', () => {
    const card = make();
    expect(card.requestedAt()).toBeNull();

    card.requestPro();

    expect(requestPlan).toHaveBeenCalledWith('PRO');
    expect(card.requestedAt()).toBe('2026-10-10T12:00:00.000Z');
  });

  it('shows a standing request instead of the button', () => {
    const card = make('2026-10-09T08:00:00.000Z');

    expect(card.requestedAt()).toBe('2026-10-09T08:00:00.000Z');
  });

  it('explains the hourly cap in Russian', () => {
    const card = make();
    requestPlan.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 429, error: { code: 'FEEDBACK_TOO_MANY', message: 'x' } })),
    );

    card.requestPro();

    expect(card.requestError()).toBe(TRANSLATIONS_RU.admin.support.tooMany);
    expect(card.requestedAt()).toBeNull();
  });
});
