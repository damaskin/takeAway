import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_EN, TRANSLATIONS_RU } from '@takeaway/i18n';

import { PRIVACY_RU } from './content/privacy.ru';
import type { LegalDocKey } from './legal-document';
import { LegalPage } from './legal.page';

const SITE_TITLE = 'takeAway — кофе и еда без очереди';
const SITE_DESCRIPTION = 'Предзаказ кофе и еды с собой.';

describe('LegalPage', () => {
  let fixture: ComponentFixture<LegalPage>;
  let translate: TranslateService;

  async function open(doc: LegalDocKey): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [LegalPage],
      providers: [provideRouter([]), provideTranslateService({ fallbackLang: 'ru' })],
    });
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.setTranslation('en', TRANSLATIONS_EN as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(LegalPage);
    fixture.componentRef.setInput('doc', doc);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function heading(el: HTMLElement): string {
    return el.querySelector('h1')?.textContent?.trim() ?? '';
  }

  function descriptionTag(): HTMLMetaElement {
    let tag = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.name = 'description';
      document.head.appendChild(tag);
    }
    return tag;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    // What index.html sets for every page.
    document.title = SITE_TITLE;
    descriptionTag().content = SITE_DESCRIPTION;
  });

  it('opens the privacy policy in Russian, dated, with its contents and the contact address', async () => {
    const el = await open('privacy');

    expect(heading(el)).toBe('Политика конфиденциальности');
    expect(el.textContent).toContain('Действует с 28 сентября 2026 года');
    const contents = PRIVACY_RU.sections.filter((s) => s.id && s.heading && s.level !== 3);
    expect(el.querySelectorAll('nav.legal-toc li')).toHaveLength(contents.length);
    expect(el.querySelector('#deletion')?.textContent).toContain('Как удалить аккаунт');
    expect(el.querySelector('a[href="mailto:help@takeaway.md"]')).not.toBeNull();
  });

  it('switches to English with the language switcher', async () => {
    const el = await open('privacy');

    translate.use('en');
    await fixture.whenStable();

    expect(heading(el)).toBe('Privacy Policy');
    expect(el.querySelector('nav.legal-toc')?.textContent).toContain('Contents');
  });

  it('names the browser tab after the document and gives the site its own title back on the way out', async () => {
    await open('privacy');

    expect(document.title).toBe('Политика конфиденциальности — takeAway');
    expect(descriptionTag().content).toBe(PRIVACY_RU.description);

    fixture.destroy();

    expect(document.title).toBe(SITE_TITLE);
    expect(descriptionTag().content).toBe(SITE_DESCRIPTION);
  });

  it('opens site links through the router and web links in a new tab', async () => {
    const el = await open('terms');

    const privacy = el.querySelector<HTMLAnchorElement>('.legal-prose a[href="/privacy"]');
    expect(privacy?.target).toBe('');
    const telegram = el.querySelector<HTMLAnchorElement>('a[href="https://t.me/takaway_tgbot"]');
    expect(telegram?.target).toBe('_blank');
    expect(telegram?.rel).toBe('noopener');
  });

  it('keeps support short — no contents list — and links both documents at the bottom', async () => {
    const el = await open('support');

    expect(heading(el)).toBe('Поддержка');
    expect(el.querySelector('nav.legal-toc')).toBeNull();
    const related = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav.legal-related a'));
    expect(related.map((a) => [a.getAttribute('href'), a.textContent?.trim()])).toEqual([
      ['/privacy', 'Политика конфиденциальности'],
      ['/terms', 'Условия использования'],
    ]);
  });
});
