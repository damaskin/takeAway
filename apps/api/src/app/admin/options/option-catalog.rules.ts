import type { OptionGroupKind, OptionGroupType } from '@prisma/client';
import { OPTION_MAX_QTY_LIMIT } from '@takeaway/shared-types';

import { menuBadRequest } from '../catalog/admin-menu.errors';

/** What a group's own fields have to satisfy (docs/option-groups.md, «Validation of catalog writes»). */
export interface GroupShape {
  kind: OptionGroupKind;
  type: OptionGroupType;
  minSelect: number | null;
  maxSelect: number | null;
}

/** Why a group cannot be saved as it is, or null. */
export function groupProblem(group: GroupShape): string | null {
  if (group.type === 'D') return 'Type D is reserved and cannot be created';
  if (group.kind === 'VARIANT' && group.type === 'C') return 'A variant group cannot be a counter (type C)';
  if (group.type !== 'A' && (group.minSelect !== null || group.maxSelect !== null)) {
    return 'Only a type A group has minSelect / maxSelect';
  }
  if (group.type === 'A') {
    if (group.maxSelect !== null && group.maxSelect < 1) return 'maxSelect must be at least 1';
    if (group.minSelect !== null && group.minSelect < 0) return 'minSelect cannot be negative';
    if (group.minSelect !== null && group.maxSelect !== null && group.minSelect > group.maxSelect) {
      return 'minSelect cannot be above maxSelect';
    }
  }
  return null;
}

/** What a C option's counter has to satisfy: 0 ≤ minQty ≤ defaultQty ≤ maxQty ≤ 20, nulls read as 0 / 0 / 20. */
export function qtyProblem(option: {
  minQty: number | null;
  maxQty: number | null;
  defaultQty: number | null;
}): string | null {
  const min = option.minQty ?? 0;
  const def = option.defaultQty ?? 0;
  const max = option.maxQty ?? OPTION_MAX_QTY_LIMIT;
  if (min < 0 || min > def || def > max || max > OPTION_MAX_QTY_LIMIT) {
    return `A counter needs 0 ≤ minQty ≤ defaultQty ≤ maxQty ≤ ${OPTION_MAX_QTY_LIMIT}`;
  }
  return null;
}

/** 400 OPTION_GROUP_INVALID when there is a problem. */
export function assertNoProblem(problem: string | null): void {
  if (problem) throw menuBadRequest('OPTION_GROUP_INVALID', problem);
}
