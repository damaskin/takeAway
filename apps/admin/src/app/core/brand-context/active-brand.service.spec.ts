import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AdminCatalogApi, type BrandDto } from '../catalog/admin-catalog.service';
import { ActiveBrandService } from './active-brand.service';

function brand(id: string, name = id): BrandDto {
  return { id, slug: id, name, currency: 'USD', locale: 'EN', logoUrl: null };
}

describe('ActiveBrandService', () => {
  let listMyBrands: jest.Mock;

  function make(): ActiveBrandService {
    listMyBrands = jest.fn();
    TestBed.configureTestingModule({
      providers: [ActiveBrandService, { provide: AdminCatalogApi, useValue: { listMyBrands } }],
    });
    return TestBed.inject(ActiveBrandService);
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('activates the first brand returned', () => {
    const service = make();
    listMyBrands.mockReturnValue(of([brand('b1', 'Alpha'), brand('b2', 'Beta')]));
    service.refresh();

    expect(service.activeId()).toBe('b1');
    expect(service.active()?.name).toBe('Alpha');
    expect(service.isEmpty()).toBe(false);
    expect(service.loadError()).toBeNull();
  });

  it('reports an empty list as empty, not as an error', () => {
    const service = make();
    listMyBrands.mockReturnValue(of([]));
    service.refresh();

    expect(service.active()).toBeNull();
    expect(service.isEmpty()).toBe(true);
    expect(service.loadError()).toBeNull();
  });

  // The whole point of the fix: a failed request used to be indistinguishable
  // from "this account owns no brand", which is what surfaced to the operator
  // as a flat "the user has no brand" on the stores page.
  it('keeps the reason when the request fails, and is not "empty"', () => {
    const service = make();
    listMyBrands.mockReturnValue(throwError(() => ({ status: 403, error: { message: 'Insufficient permissions' } })));
    service.refresh();

    expect(service.active()).toBeNull();
    expect(service.loadError()).toBe('Insufficient permissions');
    expect(service.isEmpty()).toBe(false);
  });

  it('falls back to a generic reason when the error carries no message', () => {
    const service = make();
    listMyBrands.mockReturnValue(throwError(() => ({ status: 0 })));
    service.refresh();

    expect(service.loadError()).toBe('Network error');
  });

  it('clears a stale error on a successful retry', () => {
    const service = make();
    listMyBrands.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    service.refresh();
    expect(service.loadError()).not.toBeNull();

    listMyBrands.mockReturnValue(of([brand('b1')]));
    service.refresh();
    expect(service.loadError()).toBeNull();
    expect(service.activeId()).toBe('b1');
  });

  it('drops a persisted brand that is no longer in scope', () => {
    localStorage.setItem('takeaway.admin.activeBrandId', 'gone');
    const service = make();
    listMyBrands.mockReturnValue(of([brand('b1')]));
    service.refresh();

    expect(service.activeId()).toBe('b1');
  });

  it('adopts a newly created brand as the active one', () => {
    const service = make();
    listMyBrands.mockReturnValue(of([]));
    service.refresh();
    expect(service.isEmpty()).toBe(true);

    service.adopt(brand('new', 'Fresh'));

    expect(service.activeId()).toBe('new');
    expect(service.active()?.name).toBe('Fresh');
    expect(service.isEmpty()).toBe(false);
  });
});
