import { HttpErrorResponse } from '@angular/common/http';
import type { TranslateService } from '@ngx-translate/core';

import { describeMenuError, menuErrorCode } from './menu-errors';
import { swapped } from './menu-order';
import { isStopActive, nextMidnightIn } from './stock';

/** Knows a few keys and, like ngx-translate, echoes any other key back; fills in {{params}}. */
function translator(known: Record<string, string>): TranslateService {
  const instant = (key: string, params: Record<string, unknown> = {}) =>
    (known[key] ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(params[name] ?? ''));
  return { instant } as unknown as TranslateService;
}

function httpError(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error, url: '/api/admin/categories/c1' });
}

describe('describeMenuError', () => {
  const translate = translator({
    'admin.menu.errors.CATEGORY_NOT_EMPTY': 'Сначала перенесите или удалите товары категории.',
    'admin.menu.errors.status.413': 'Файл больше 5 МБ',
    'admin.menu.errors.storageUnavailable': 'Загрузка фото не настроена',
    'admin.menu.errors.invalidField': 'Проверьте поле «{{field}}»',
    'admin.menu.errors.status.0': 'Нет связи с сервером.',
    'admin.menu.fields.name': 'Название',
    'admin.menu.fields.basePriceCents': 'Цена',
    'common.genericError': 'Что-то пошло не так',
  });

  it('translates a domain code first', () => {
    const err = httpError(409, { code: 'CATEGORY_NOT_EMPTY', message: 'Move or delete the products first' });
    expect(describeMenuError(err, translate)).toBe('Сначала перенесите или удалите товары категории.');
  });

  it('translates a known status', () => {
    expect(describeMenuError(httpError(413, { message: 'The image is larger than 5 MB' }), translate)).toBe(
      'Файл больше 5 МБ',
    );
  });

  it('lets the screen say what a status means there', () => {
    const err = httpError(503, { message: 'Object storage is not configured on this deployment' });
    expect(describeMenuError(err, translate, { 503: 'admin.menu.errors.storageUnavailable' })).toBe(
      'Загрузка фото не настроена',
    );
  });

  it('names the fields a validation failure is about instead of showing "Http failure response … 400"', () => {
    const err = httpError(400, {
      statusCode: 400,
      message: [
        'name must be longer than or equal to 1 characters',
        'basePriceCents must be an integer number',
        'something the menu has no label for',
      ],
    });
    expect(describeMenuError(err, translate)).toBe(
      'Проверьте поле «Название». Проверьте поле «Цена». something the menu has no label for.',
    );
  });

  it('says when the server could not be reached at all', () => {
    expect(describeMenuError(httpError(0, null), translate)).toBe('Нет связи с сервером.');
  });

  it('falls back to a plain sentence', () => {
    expect(describeMenuError(httpError(418, null), translate)).toBe('Что-то пошло не так');
    expect(describeMenuError(undefined, translate)).toBe('Что-то пошло не так');
  });

  it('exposes the code for flows that react to it', () => {
    expect(menuErrorCode(httpError(409, { code: 'CATEGORY_NOT_EMPTY' }))).toBe('CATEGORY_NOT_EMPTY');
    expect(menuErrorCode(httpError(500, 'boom'))).toBeNull();
  });
});

describe('swapped', () => {
  it('moves one item a step and leaves the input alone', () => {
    const list = ['a', 'b', 'c'];
    expect(swapped(list, 1, 0)).toEqual(['b', 'a', 'c']);
    expect(swapped(list, 1, 2)).toEqual(['a', 'c', 'b']);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('refuses to move past either end', () => {
    expect(swapped(['a', 'b'], 0, -1)).toBeNull();
    expect(swapped(['a', 'b'], 1, 2)).toBeNull();
  });
});

describe('stock', () => {
  const now = new Date('2026-09-23T10:00:00Z');

  it('counts an entry as active until it expires', () => {
    expect(isStopActive({ expiresAt: null }, now)).toBe(true);
    expect(isStopActive({ expiresAt: '2026-09-23T21:00:00.000Z' }, now)).toBe(true);
    expect(isStopActive({ expiresAt: '2026-09-23T09:59:00.000Z' }, now)).toBe(false);
  });

  it("ends the day at the store's midnight, not the browser's", () => {
    // Chisinau is UTC+3 in September: local midnight is 21:00 UTC.
    expect(nextMidnightIn('Europe/Chisinau', now).toISOString()).toBe('2026-09-23T21:00:00.000Z');
    // Late in the local evening it is still the same night.
    expect(nextMidnightIn('Europe/Chisinau', new Date('2026-09-23T20:30:00Z')).toISOString()).toBe(
      '2026-09-23T21:00:00.000Z',
    );
    // Just after local midnight it is the next one.
    expect(nextMidnightIn('Europe/Chisinau', new Date('2026-09-23T21:05:00Z')).toISOString()).toBe(
      '2026-09-24T21:00:00.000Z',
    );
    expect(nextMidnightIn('UTC', now).toISOString()).toBe('2026-09-24T00:00:00.000Z');
  });

  it('falls back to a later time for a zone it does not know', () => {
    expect(nextMidnightIn('Nowhere/Special', now).getTime()).toBeGreaterThan(now.getTime());
  });
});
