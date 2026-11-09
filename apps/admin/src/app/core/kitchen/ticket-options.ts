import type { OptionLine } from '@takeaway/shared-types';
import { describeOptionLines } from '@takeaway/utils';

/**
 * A line's picks from the options catalog as the kitchen card lays them
 * out: the variants as chips next to each other (like the older sizes),
 * each add-on group on its own «+» row. The words are the receipt's
 * (`describeOptionLines`): «Ваниль + Солёная карамель», «Сахар ×2», and a
 * counter left at what the dish includes (one meat portion) is not shown.
 */
export interface TicketOptions {
  variants: string[];
  addons: string[];
}

export function ticketOptions(lines: readonly OptionLine[]): TicketOptions {
  const variants = lines.filter((l) => l.kind === 'VARIANT').map((l) => describeOptionLines([l]));
  const groups = new Map<string, OptionLine[]>();
  for (const line of lines) {
    if (line.kind === 'VARIANT') continue;
    groups.set(line.groupId, [...(groups.get(line.groupId) ?? []), line]);
  }
  const addons = [...groups.values()].map((group) => describeOptionLines(group)).filter((text) => text !== '');
  return { variants, addons };
}
