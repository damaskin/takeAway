import { STORE_PIN_TONES, storePinColors, storePinIcon, storePinKind } from './store-pin';

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

  function paint(html: string): { body: string | null; ink: string[]; tone: string | null } {
    const host = document.createElement('div');
    host.innerHTML = html;
    const svg = host.querySelector('svg');
    return {
      body: svg?.querySelector('path')?.getAttribute('fill') ?? null,
      ink: Array.from(host.querySelectorAll('[data-glyph] path')).map((el) => el.getAttribute('fill') ?? ''),
      tone: svg?.getAttribute('data-tone') ?? null,
    };
  }

  it('take the colours of the store cards: mint for open, amber for busy, berry for closed', () => {
    expect(STORE_PIN_TONES.open.fill).toContain('--color-mint');
    expect(STORE_PIN_TONES.busy.fill).toContain('--color-amber');
    expect(STORE_PIN_TONES.closed.fill).toContain('--color-berry');
  });

  it('paint the body in the status colour and the glyph in its darker shade', () => {
    for (const tone of ['open', 'busy', 'closed'] as const) {
      const single = paint(String(storePinIcon('coffee', tone).options.html));
      expect(single).toEqual({ body: STORE_PIN_TONES[tone].fill, ink: [STORE_PIN_TONES[tone].ink], tone });

      const both = paint(String(storePinIcon('both', tone).options.html));
      expect(both).toEqual({
        body: STORE_PIN_TONES[tone].fill,
        ink: [STORE_PIN_TONES[tone].ink, STORE_PIN_TONES[tone].ink],
        tone,
      });
      expect(storePinIcon('food', tone).options.className).toContain(`lib-store-pin--${tone}`);
    }
  });

  it('stay caramel without a status, as on the order mini-map', () => {
    const plain = paint(String(storePinIcon('food').options.html));
    expect(plain.body).toContain('--color-caramel');
    expect(plain.ink).toEqual([plain.body]);
    expect(plain.tone).toBeNull();
    expect(storePinColors()).toEqual({ fill: plain.body, ink: plain.body });
  });
});
