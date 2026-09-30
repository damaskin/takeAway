import { parseLegalText } from './legal-document';

describe('parseLegalText', () => {
  it('leaves plain prose alone', () => {
    expect(parseLegalText('Коротко: мы собираем только нужное.')).toEqual([
      { kind: 'text', text: 'Коротко: мы собираем только нужное.' },
    ]);
  });

  it('keeps the text around a link, spaces included', () => {
    expect(parseLegalText('Пишите на [help@takeaway.md](mailto:help@takeaway.md) — ответим.')).toEqual([
      { kind: 'text', text: 'Пишите на ' },
      { kind: 'link', text: 'help@takeaway.md', href: 'mailto:help@takeaway.md', external: false },
      { kind: 'text', text: ' — ответим.' },
    ]);
  });

  it('opens web links in a new tab and mail links in place', () => {
    const [telegram] = parseLegalText('[@takaway_tgbot](https://t.me/takaway_tgbot)');
    expect(telegram).toEqual({
      kind: 'link',
      text: '@takaway_tgbot',
      href: 'https://t.me/takaway_tgbot',
      external: true,
    });
  });

  it('routes links to pages of this site, with the section anchor', () => {
    expect(parseLegalText('[Политике](/privacy#deletion) и [условиях](/terms)')).toEqual([
      { kind: 'route', text: 'Политике', path: '/privacy', fragment: 'deletion' },
      { kind: 'text', text: ' и ' },
      { kind: 'route', text: 'условиях', path: '/terms', fragment: undefined },
    ]);
  });

  it('marks emphasis', () => {
    expect(parseLegalText('В приложении: **Профиль → Удалить аккаунт**.')).toEqual([
      { kind: 'text', text: 'В приложении: ' },
      { kind: 'strong', text: 'Профиль → Удалить аккаунт' },
      { kind: 'text', text: '.' },
    ]);
  });
});
