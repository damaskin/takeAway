import type { OptionLine } from '@takeaway/shared-types';

import { ticketOptions } from './ticket-options';

function line(extra: Partial<OptionLine> & Pick<OptionLine, 'groupId' | 'name'>): OptionLine {
  return {
    groupName: extra.groupId,
    kind: 'ADDON',
    type: 'A',
    optionId: `${extra.groupId}-${extra.name}`,
    qty: 1,
    unitPriceCents: 0,
    freeQty: 0,
    totalCents: 0,
    ...extra,
  };
}

describe('ticketOptions', () => {
  it('lays out a catalog choice: variants as chips, each add-on group on its own row', () => {
    const lines = [
      line({ groupId: 'size', name: 'M', kind: 'VARIANT' }),
      line({ groupId: 'serve', name: 'Горячий', kind: 'VARIANT' }),
      line({ groupId: 'milk', name: 'Овсяное' }),
      line({ groupId: 'syrups', name: 'Ваниль' }),
      line({ groupId: 'syrups', name: 'Солёная карамель' }),
      line({ groupId: 'sugar', name: 'Сахар', type: 'C', qty: 2 }),
    ];
    expect(ticketOptions(lines)).toEqual({
      variants: ['M', 'Горячий'],
      addons: ['Овсяное', 'Ваниль + Солёная карамель', 'Сахар ×2'],
    });
  });

  it('leaves out a counter at the amount the dish includes', () => {
    const meat = line({ groupId: 'meat', name: 'Мясо', type: 'C', qty: 1, freeQty: 1 });
    expect(ticketOptions([meat]).addons).toEqual([]);
    expect(ticketOptions([{ ...meat, qty: 2 }]).addons).toEqual(['Мясо ×2']);
  });

  it('is empty for a line without catalog picks', () => {
    expect(ticketOptions([])).toEqual({ variants: [], addons: [] });
  });
});
