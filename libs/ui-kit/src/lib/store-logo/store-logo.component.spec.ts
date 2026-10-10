import { TestBed } from '@angular/core/testing';

import { StoreLogoComponent } from './store-logo.component';

describe('StoreLogoComponent', () => {
  async function render(inputs: { url?: string | null; photo?: string | null }) {
    const fixture = TestBed.createComponent(StoreLogoComponent);
    fixture.componentRef.setInput('name', 'NoName Coffee');
    if (inputs.url !== undefined) fixture.componentRef.setInput('url', inputs.url);
    if (inputs.photo !== undefined) fixture.componentRef.setInput('photo', inputs.photo);
    await fixture.whenStable();
    return fixture;
  }

  function image(host: HTMLElement): HTMLImageElement | null {
    return host.querySelector('img');
  }

  it("shows the store's photo over the brand logo", async () => {
    const fixture = await render({ url: 'https://cdn/logo.png', photo: 'https://cdn/hero.jpg' });
    const host = fixture.nativeElement as HTMLElement;
    expect(image(host)?.getAttribute('src')).toBe('https://cdn/hero.jpg');
    expect(image(host)?.classList).toContain('photo');
    expect(host.classList).toContain('lib-store-logo--photo');
  });

  it('falls back to the brand logo when the store has no photo', async () => {
    const fixture = await render({ url: 'https://cdn/logo.png', photo: null });
    const host = fixture.nativeElement as HTMLElement;
    expect(image(host)?.getAttribute('src')).toBe('https://cdn/logo.png');
    expect(host.classList).toContain('lib-store-logo--image');
  });

  it('falls back to the brand logo, then the icon, as images fail to load', async () => {
    const fixture = await render({ url: 'https://cdn/logo.png', photo: 'https://cdn/hero.jpg' });
    const host = fixture.nativeElement as HTMLElement;

    image(host)?.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(image(host)?.getAttribute('src')).toBe('https://cdn/logo.png');

    image(host)?.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(image(host)).toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
  });
});
