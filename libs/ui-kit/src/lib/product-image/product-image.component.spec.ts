import { TestBed } from '@angular/core/testing';

import { ProductImageComponent } from './product-image.component';
import { productPlaceholderSrc } from './product-placeholder';

describe('productPlaceholderSrc', () => {
  it('picks the illustration by category kind', () => {
    expect(productPlaceholderSrc('HOT_DRINKS')).toBe('/ui-kit/product-placeholders/hot-drink.svg');
    expect(productPlaceholderSrc('COLD_DRINKS')).toBe('/ui-kit/product-placeholders/cold-drink.svg');
    expect(productPlaceholderSrc('FOOD')).toBe('/ui-kit/product-placeholders/food.svg');
    expect(productPlaceholderSrc('BAKERY')).toBe('/ui-kit/product-placeholders/bakery.svg');
  });

  it('draws the neutral bag for OTHER, a missing kind or one it does not know', () => {
    for (const kind of ['OTHER', null, undefined, '', 'FLOWERS', 'constructor']) {
      expect(productPlaceholderSrc(kind)).toBe('/ui-kit/product-placeholders/other.svg');
    }
  });
});

describe('ProductImageComponent', () => {
  async function render(inputs: { src?: string | null; kind?: string | null }) {
    const fixture = TestBed.createComponent(ProductImageComponent);
    fixture.componentRef.setInput('alt', 'Латте');
    if (inputs.src !== undefined) fixture.componentRef.setInput('src', inputs.src);
    if (inputs.kind !== undefined) fixture.componentRef.setInput('kind', inputs.kind);
    await fixture.whenStable();
    return fixture;
  }

  function image(host: HTMLElement): HTMLImageElement | null {
    return host.querySelector('img');
  }

  it('shows the photo when there is one', async () => {
    const fixture = await render({ src: 'https://cdn/latte.jpg', kind: 'HOT_DRINKS' });
    const host = fixture.nativeElement as HTMLElement;
    expect(image(host)?.getAttribute('src')).toBe('https://cdn/latte.jpg');
    expect(image(host)?.getAttribute('alt')).toBe('Латте');
    expect(host.classList).not.toContain('lib-product-image--placeholder');
  });

  it("shows the kind's illustration without a photo", async () => {
    const fixture = await render({ src: null, kind: 'BAKERY' });
    const host = fixture.nativeElement as HTMLElement;
    expect(image(host)?.getAttribute('src')).toBe('/ui-kit/product-placeholders/bakery.svg');
    expect(host.classList).toContain('lib-product-image--placeholder');
  });

  it('falls back to the illustration when the photo fails, and tries a new photo again', async () => {
    const fixture = await render({ src: 'https://cdn/broken.jpg', kind: 'FOOD' });
    const host = fixture.nativeElement as HTMLElement;

    image(host)?.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(image(host)?.getAttribute('src')).toBe('/ui-kit/product-placeholders/food.svg');

    fixture.componentRef.setInput('src', 'https://cdn/fixed.jpg');
    await fixture.whenStable();
    expect(image(host)?.getAttribute('src')).toBe('https://cdn/fixed.jpg');
  });

  it('loads lazily unless told to load at once', async () => {
    const fixture = await render({ src: 'https://cdn/latte.jpg' });
    const host = fixture.nativeElement as HTMLElement;
    expect(image(host)?.getAttribute('loading')).toBe('lazy');

    fixture.componentRef.setInput('eager', true);
    await fixture.whenStable();
    expect(image(host)?.hasAttribute('loading')).toBe(false);
  });
});
