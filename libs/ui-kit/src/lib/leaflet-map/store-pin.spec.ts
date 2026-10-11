import { storePinIcon, storePinKind } from './store-pin';

describe('store pins', () => {
  it('show a cup for a coffee shop', () => {
    expect(storePinKind(['COFFEE'])).toBe('coffee');
  });

  it('show a fork and knife for a place that sells food only', () => {
    expect(storePinKind(['FOOD'])).toBe('food');
  });

  it('show both for a place that sells both, in either order', () => {
    expect(storePinKind(['COFFEE', 'FOOD'])).toBe('both');
    expect(storePinKind(['FOOD', 'COFFEE'])).toBe('both');
  });

  it('treat a store that has not said as a coffee shop', () => {
    expect(storePinKind([])).toBe('coffee');
  });

  function glyphs(html: string): string[] {
    const host = document.createElement('div');
    host.innerHTML = html;
    return Array.from(host.querySelectorAll('[data-glyph]')).map((el) => el.getAttribute('data-glyph') ?? '');
  }

  it('draw the glyphs of what the store sells, with the tip on the spot', () => {
    const coffee = storePinIcon('coffee').options;
    expect(glyphs(String(coffee.html))).toEqual(['COFFEE']);
    expect(coffee.iconAnchor).toEqual([16, 42]);

    expect(glyphs(String(storePinIcon('food').options.html))).toEqual(['FOOD']);

    const both = storePinIcon('both').options;
    expect(glyphs(String(both.html))).toEqual(['COFFEE', 'FOOD']);
    expect(both.iconAnchor).toEqual([24, 40]);
  });
});
