import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';

import { SITE_LINKS, SITE_LINKS_CONFIG, type SiteLinks } from '../../core/config/site-links';
import { AppInstallPage } from './app-install.page';
import { INSTALL_DEVICE, type InstallDevice, installPlatform, storeFor } from './install-platform';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const links = (apps: Partial<SiteLinks['apps']>): SiteLinks => ({
  ...SITE_LINKS,
  apps: { appStoreId: '', googlePlayId: '', ...apps },
});

describe('installPlatform', () => {
  it('tells iPhones, iPads and Android phones from computers', () => {
    expect(installPlatform(IPHONE)).toBe('ios');
    expect(installPlatform(ANDROID)).toBe('android');
    expect(installPlatform(WINDOWS)).toBeNull();
    // A Mac with a touch screen is an iPad asking for the desktop site.
    expect(installPlatform(IPAD_DESKTOP_MODE, 5)).toBe('ios');
    expect(installPlatform(IPAD_DESKTOP_MODE, 0)).toBeNull();
  });
});

describe('storeFor', () => {
  it('sends each phone to its own store', () => {
    const both = links({ appStoreId: '1234567890', googlePlayId: 'md.takeaway.app' });
    expect(storeFor('ios', both)).toBe('https://apps.apple.com/app/id1234567890');
    expect(storeFor('android', both)).toBe('https://play.google.com/store/apps/details?id=md.takeaway.app');
    expect(storeFor(null, both)).toBeNull();
  });

  it('sends nowhere a phone whose store has no listing', () => {
    expect(storeFor('ios', links({ googlePlayId: 'md.takeaway.app' }))).toBeNull();
    expect(storeFor('android', links({ appStoreId: 'id1234567890' }))).toBeNull();
    expect(storeFor('ios', links({ appStoreId: 'id1234567890' }))).toBe('https://apps.apple.com/app/id1234567890');
  });
});

describe('AppInstallPage', () => {
  let fixture: ComponentFixture<AppInstallPage>;
  let opened: string[];

  // Google Play is listed, the App Store is not (yet).
  const playOnly = links({ googlePlayId: 'md.takeaway.app' });

  async function render(userAgent: string, siteLinks = playOnly): Promise<HTMLElement> {
    opened = [];
    const device: InstallDevice = { userAgent, maxTouchPoints: 0, open: (url) => opened.push(url) };
    TestBed.configureTestingModule({
      imports: [AppInstallPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: INSTALL_DEVICE, useValue: device },
        { provide: SITE_LINKS_CONFIG, useValue: siteLinks },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(AppInstallPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('sends an Android phone straight to Google Play', async () => {
    const el = await render(ANDROID);
    expect(opened).toEqual(['https://play.google.com/store/apps/details?id=md.takeaway.app']);
    expect(el.textContent).toContain('Открываем Google Play');
    expect(el.querySelector('.install-qr')).toBeNull();
  });

  it('shows a computer the store buttons there are and a QR code of /app', async () => {
    const el = await render(WINDOWS);
    expect(opened).toEqual([]);
    const play = el.querySelector<HTMLAnchorElement>('a[data-store="google-play"]');
    expect(play?.href).toBe('https://play.google.com/store/apps/details?id=md.takeaway.app');
    // No App Store id yet: no button rather than a dead one.
    expect(el.querySelector('a[data-store="app-store"]')).toBeNull();
    expect(el.querySelector<HTMLImageElement>('.install-qr img')?.getAttribute('src')).toBe('/app-qr.svg');
    expect(el.querySelector('a[href="/menu"]')).not.toBeNull();
  });

  it('keeps an iPhone on the site while there is no App Store listing', async () => {
    const el = await render(IPHONE);
    expect(opened).toEqual([]);
    expect(el.querySelector('[data-testid="no-ios"]')).not.toBeNull();
  });

  it('sends an iPhone to the App Store once the id is filled in', async () => {
    const el = await render(IPHONE, links({ appStoreId: '1234567890', googlePlayId: 'md.takeaway.app' }));
    expect(opened).toEqual(['https://apps.apple.com/app/id1234567890']);
    expect(el.textContent).toContain('Открываем App Store');
    expect(el.querySelector('[data-testid="no-ios"]')).toBeNull();
  });
});
