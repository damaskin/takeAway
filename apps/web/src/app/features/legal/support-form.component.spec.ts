import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type WritableSignal, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';

import { API_CONFIG } from '../../core/api/api.config';
import { AuthStore } from '../../core/auth/auth.store';
import { SupportFormComponent } from './support-form.component';

describe('SupportFormComponent', () => {
  let fixture: ComponentFixture<SupportFormComponent>;
  let http: HttpTestingController;
  let signedIn: WritableSignal<boolean>;

  async function render(asCustomer = false): Promise<HTMLElement> {
    signedIn = signal(asCustomer);
    TestBed.configureTestingModule({
      imports: [SupportFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        { provide: AuthStore, useValue: { isAuthenticated: signedIn } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SupportFormComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function type(el: HTMLElement, name: string, value: string): void {
    const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
    if (!field) throw new Error(`no field ${name}`);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }

  async function submit(el: HTMLElement): Promise<void> {
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('sends a visitor’s question with a name and a way to answer', async () => {
    const el = await render();
    type(el, 'name', ' Ион ');
    type(el, 'contact', ' 069 123 456 ');
    type(el, 'message', '  Где мой заказ 1234?  ');
    await submit(el);

    const req = http.expectOne('/api/feedback/support');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      kind: 'QUESTION',
      message: 'Где мой заказ 1234?',
      name: 'Ион',
      contact: '069 123 456',
    });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    expect(el.textContent).toContain('Сообщение отправлено');
  });

  it('asks a visitor for an email or a phone before sending', async () => {
    const el = await render();
    type(el, 'message', 'Hello');
    await submit(el);
    expect(el.textContent).toContain('Укажите email или телефон');

    type(el, 'contact', '@ivan_tg');
    await fixture.whenStable();
    expect(el.textContent).toContain('Это не похоже на email или номер телефона.');
    await submit(el);
    http.expectNone('/api/feedback/support');
  });

  it('lets a signed-in customer write without a contact or a name', async () => {
    const el = await render(true);
    expect(el.querySelector('[name="name"]')).toBeNull();
    const topic = el.querySelector<HTMLSelectElement>('select');
    if (!topic) throw new Error('no topic');
    topic.value = 'PROBLEM';
    topic.dispatchEvent(new Event('change'));
    type(el, 'message', 'Не пришёл возврат');
    await submit(el);

    const req = http.expectOne('/api/feedback/support');
    // Only the topic and the message: the account says who it is.
    expect(req.request.body).toEqual({ kind: 'PROBLEM', message: 'Не пришёл возврат' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    expect(el.textContent).toContain('Сообщение отправлено');
  });

  it('passes the honeypot on, so the server can drop it', async () => {
    const el = await render();
    type(el, 'contact', 'bot@spam.io');
    type(el, 'message', 'Buy now');
    type(el, 'website', 'https://spam.io');
    await submit(el);
    const req = http.expectOne('/api/feedback/support');
    expect(req.request.body.website).toBe('https://spam.io');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('says to wait when the server has had too many', async () => {
    const el = await render();
    type(el, 'contact', 'ion@mail.md');
    type(el, 'message', 'Hello');
    await submit(el);
    http
      .expectOne('/api/feedback/support')
      .flush({ code: 'FEEDBACK_TOO_MANY' }, { status: 429, statusText: 'Too Many Requests' });
    await fixture.whenStable();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Попробуйте через час');
    // What they typed is still there.
    expect(el.querySelector<HTMLTextAreaElement>('[name="message"]')?.value).toBe('Hello');
  });
});
