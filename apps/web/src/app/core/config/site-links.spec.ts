import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SITE_LINKS, type SiteLinks, appStoreUrl, googlePlayUrl, socialProfiles } from './site-links';

const withSocial = (social: Partial<SiteLinks['social']>): SiteLinks => ({
  ...SITE_LINKS,
  social: { instagram: '', telegram: '', tiktok: '', facebook: '', vk: '', ...social },
});

describe('site links', () => {
  it('shows only the social profiles that have an https address, in footer order', () => {
    expect(socialProfiles(withSocial({}))).toEqual([]);
    expect(
      socialProfiles(
        withSocial({ vk: 'https://vk.com/takeaway', instagram: ' https://instagram.com/takeaway ', tiktok: 'tiktok' }),
      ),
    ).toEqual([
      { network: 'instagram', url: 'https://instagram.com/takeaway' },
      { network: 'vk', url: 'https://vk.com/takeaway' },
    ]);
  });

  it('builds the store addresses, and none without an id', () => {
    const apps = (a: Partial<SiteLinks['apps']>): SiteLinks => ({
      ...SITE_LINKS,
      apps: { appStoreId: '', googlePlayId: '', ...a },
    });
    expect(appStoreUrl(apps({ appStoreId: '6000000000' }))).toBe('https://apps.apple.com/app/id6000000000');
    expect(appStoreUrl(apps({ appStoreId: 'id6000000000' }))).toBe('https://apps.apple.com/app/id6000000000');
    expect(appStoreUrl(apps({ appStoreId: 'takeaway' }))).toBeNull();
    expect(appStoreUrl(apps({}))).toBeNull();
    expect(googlePlayUrl(apps({ googlePlayId: 'md.takeaway.app' }))).toBe(
      'https://play.google.com/store/apps/details?id=md.takeaway.app',
    );
    expect(googlePlayUrl(apps({}))).toBeNull();
  });

  it('links Google Play to the Android app id of apps/mobile', () => {
    const gradle = readFileSync(join(__dirname, '../../../../../mobile/android/app/build.gradle.kts'), 'utf8');
    expect(gradle).toContain(`applicationId = "${SITE_LINKS.apps.googlePlayId}"`);
  });

  // Safari reads the Smart App Banner only from the HTML as it arrives, so it
  // cannot be added by the app; index.html has to carry it — exactly when
  // the id is known.
  it('has the Smart App Banner in index.html exactly when the App Store id is known', () => {
    const html = readFileSync(join(__dirname, '../../../index.html'), 'utf8');
    const banner = /<meta\s+name="apple-itunes-app"\s+content="app-id=(\d+)[^"]*"\s*\/?>/.exec(html);
    const id = appStoreUrl()?.replace('https://apps.apple.com/app/id', '') ?? null;
    expect(banner?.[1] ?? null).toBe(id);
  });
});
