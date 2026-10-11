import { TestBed } from '@angular/core/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';

import { SITE_LINKS, SITE_LINKS_CONFIG, type SiteLinks } from '../../core/config/site-links';
import { SocialLinksComponent } from './social-links.component';

describe('SocialLinksComponent', () => {
  async function render(social: Partial<SiteLinks['social']>): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [SocialLinksComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'ru' }),
        {
          provide: SITE_LINKS_CONFIG,
          useValue: {
            ...SITE_LINKS,
            social: { instagram: '', telegram: '', tiktok: '', facebook: '', vk: '', ...social },
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(SocialLinksComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing while no profile is filled in', async () => {
    const el = await render({});
    expect(el.querySelector('nav')).toBeNull();
  });

  it('links each filled-in profile in a new tab, named for screen readers', async () => {
    const el = await render({ instagram: 'https://instagram.com/takeaway', telegram: 'https://t.me/takeaway_news' });
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://instagram.com/takeaway',
      'https://t.me/takeaway_news',
    ]);
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toBe('noopener');
      expect(a.querySelector('svg')).not.toBeNull();
    }
    expect(links[0]?.getAttribute('aria-label')).toBe('takeAway в Instagram');
  });
});
