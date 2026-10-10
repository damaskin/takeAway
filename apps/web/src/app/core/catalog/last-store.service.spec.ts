import { TestBed } from '@angular/core/testing';

import { LastStoreService } from './last-store.service';

describe('LastStoreService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => jest.restoreAllMocks());

  it('remembers the store across visits', () => {
    TestBed.inject(LastStoreService).remember('noname-centre');

    TestBed.resetTestingModule();
    expect(TestBed.inject(LastStoreService).slug()).toBe('noname-centre');
  });

  it('starts with nothing on a first visit', () => {
    expect(TestBed.inject(LastStoreService).slug()).toBeNull();
  });

  it('still remembers for this visit when the browser refuses storage', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const lastStore = TestBed.inject(LastStoreService);

    lastStore.remember('kacheli-balka');
    expect(lastStore.slug()).toBe('kacheli-balka');
  });
});
