import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CATEGORY_KIND_STEMS, categoryKindPattern } from '@takeaway/utils';

/**
 * The migration filled in the kind of every existing category with the same
 * rules the admin suggests a kind with (`inferCategoryKind`). This keeps the
 * two from drifting apart: same kinds, same order, same patterns.
 */
describe('category kind migration', () => {
  const sql = readFileSync(
    join(__dirname, '../../../../prisma/migrations/20261011120000_category_kind_option_presets/migration.sql'),
    'utf8',
  );
  const updates = [...sql.matchAll(/UPDATE "Category" SET "kind" = '(\w+)'[\s\S]*?~ '([^']+)';/g)].map(
    ([, kind, pattern]) => [kind, pattern] as const,
  );

  it('infers kinds in the order the shared util checks them', () => {
    expect(updates.map(([kind]) => kind)).toEqual(CATEGORY_KIND_STEMS.map(([kind]) => kind));
  });

  it('uses exactly the patterns of the shared util', () => {
    expect(updates.map(([, pattern]) => pattern)).toEqual(
      CATEGORY_KIND_STEMS.map(([, stems]) => categoryKindPattern(stems)),
    );
  });

  it('only fills categories still at OTHER, lower-casing both alphabets', () => {
    const upper = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const statements = sql.split(';').filter((s) => s.includes('UPDATE "Category"'));
    expect(statements).toHaveLength(4);
    for (const statement of statements) {
      expect(statement).toContain(`WHERE "kind" = 'OTHER'`);
      expect(statement).toContain(`translate("name", '${upper}', '${upper.toLowerCase()}')`);
    }
  });
});
