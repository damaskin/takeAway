import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

/**
 * Migration `20261118110000_drop_legacy_options` on a real Postgres, with
 * data in it: a database at the migration before is filled with a brand's
 * older options (variations, extras, the add-on library, a category set, a
 * store stop), carts made with them and a placed order, then migrated.
 *
 * Opt-in: set LEGACY_MIGRATION_IT_SERVER_URL to a Postgres the suite may
 * create a database on (e.g. `postgresql://postgres@localhost:55461/postgres`).
 * It creates `it_legacy_<time>`, applies the migrations into it with the
 * Prisma CLI and drops it again. Slow (two `migrate deploy` runs).
 */
const serverUrl = process.env['LEGACY_MIGRATION_IT_SERVER_URL'];
const suite = serverUrl ? describe : describe.skip;

const FIRST_NEW = '20261118100000';
const PRISMA_DIR = join(__dirname, '../../../prisma');

suite('dropping the older options (migration on Postgres)', () => {
  const database = `it_legacy_${Date.now()}`;
  let server: PrismaClient;
  let db: PrismaClient;
  let work: string;
  let dbUrl: string;

  /** `prisma migrate deploy` of the migrations copied into the work folder. */
  function deploy(): void {
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(work, 'schema.prisma')],
      {
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'pipe',
      },
    );
  }

  /** Copies the migrations before (or from) 2026-11-18 into the work folder. */
  function copyMigrations(newOnes: boolean): void {
    for (const name of readdirSync(join(PRISMA_DIR, 'migrations'))) {
      const isNew = name >= FIRST_NEW && name !== 'migration_lock.toml';
      if (isNew !== newOnes && name !== 'migration_lock.toml') continue;
      cpSync(join(PRISMA_DIR, 'migrations', name), join(work, 'migrations', name), { recursive: true });
    }
  }

  beforeAll(async () => {
    server = new PrismaClient({ datasources: { db: { url: serverUrl } } });
    await server.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    const url = new URL(serverUrl as string);
    url.pathname = `/${database}`;
    dbUrl = url.toString();

    work = mkdtempSync(join(tmpdir(), 'it-legacy-'));
    cpSync(join(PRISMA_DIR, 'schema.prisma'), join(work, 'schema.prisma'));
    copyMigrations(false);
    deploy();

    db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    for (const statement of FIXTURE) await db.$executeRawUnsafe(statement);

    copyMigrations(true);
    deploy();
  }, 300_000);

  afterAll(async () => {
    await db?.$disconnect();
    if (server) {
      await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await server.$disconnect();
    }
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('drops the cart lines made with older options and re-totals the carts', async () => {
    const lines = await db.$queryRaw<Array<{ id: string; cartId: string }>>`
      SELECT "id", "cartId" FROM "CartItem" ORDER BY "id"
    `;
    // ci1 (a variation), ci4 (an extra «1» as text) and ci5 (an extra ×3) go;
    // ci2 (catalog picks) and ci3 (an extra asked for 0 times) stay.
    expect(lines).toEqual([
      { id: 'ci2', cartId: 'cart1' },
      { id: 'ci3', cartId: 'cart2' },
    ]);
    const carts = await db.$queryRaw<Array<{ id: string; subtotalCents: number; etaSeconds: number }>>`
      SELECT "id", "subtotalCents", "etaSeconds" FROM "Cart" ORDER BY "id"
    `;
    expect(carts).toEqual([
      { id: 'cart1', subtotalCents: 2000, etaSeconds: 600 },
      { id: 'cart2', subtotalCents: 2000, etaSeconds: 600 },
      { id: 'cart3', subtotalCents: 0, etaSeconds: 0 },
    ]);
  });

  it('keeps what placed orders were made with', async () => {
    const [item] = await db.$queryRaw<Array<{ productSnapshot: { variations: Array<{ name: string }> } }>>`
      SELECT "productSnapshot" FROM "OrderItem" WHERE "id" = 'oit1'
    `;
    expect(item?.productSnapshot.variations.map((v) => v.name)).toEqual(['L']);
  });

  it('deletes the older options with their tables, and leaves the products', async () => {
    const tables = await db.$queryRaw<Array<{ name: string | null }>>`
      SELECT to_regclass(t)::text AS name
      FROM unnest(ARRAY['"Variation"', '"Modifier"', '"Ingredient"', '"CategoryOption"', '"StoreIngredientStop"']) AS t
    `;
    expect(tables.map((t) => t.name)).toEqual([null, null, null, null, null]);
    const types = await db.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type WHERE typname IN ('VariationType', 'CategoryOptionKind')
    `;
    expect(types).toEqual([]);
    const products = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Product" ORDER BY "id"`;
    expect(products.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

/** A brand with older options of every kind, carts made with them, an order — at the migration before. */
const FIXTURE = [
  `INSERT INTO "Brand" (id, slug, name, "updatedAt") VALUES ('b1', 'b1', 'Brand', now())`,
  `INSERT INTO "Store" (id, "brandId", slug, name, "addressLine", city, country, latitude, longitude, currency, "updatedAt")
   VALUES ('s1', 'b1', 's1', 'Store', 'a', 'c', 'MD', 0, 0, 'MDL', now())`,
  `INSERT INTO "User" (id, "updatedAt") VALUES ('u1', now()), ('u2', now()), ('u3', now())`,
  `INSERT INTO "Category" (id, "brandId", slug, name, "updatedAt") VALUES ('c1', 'b1', 'c1', 'Cat', now())`,
  `INSERT INTO "Product" (id, "brandId", "categoryId", slug, name, "basePriceCents", "updatedAt")
   VALUES ('p1', 'b1', 'c1', 'p1', 'Latte', 3000, now()), ('p2', 'b1', 'c1', 'p2', 'Tea', 1000, now())`,
  `INSERT INTO "Ingredient" (id, "brandId", name, "updatedAt") VALUES ('i1', 'b1', 'Oat', now())`,
  `INSERT INTO "Variation" (id, "productId", type, name, "ingredientId") VALUES ('v1', 'p1', 'SIZE', 'L', 'i1')`,
  `INSERT INTO "Modifier" (id, "productId", slug, name, "priceDeltaCents") VALUES ('m1', 'p1', 'vanilla', 'Vanilla', 500)`,
  `INSERT INTO "CategoryOption" (id, "categoryId", kind, name, "ingredientId") VALUES ('co1', 'c1', 'MODIFIER', 'Vanilla', 'i1')`,
  `INSERT INTO "StoreIngredientStop" ("storeId", "ingredientId") VALUES ('s1', 'i1')`,
  `INSERT INTO "Cart" (id, "userId", "storeId", "subtotalCents", "etaSeconds", "updatedAt")
   VALUES ('cart1', 'u1', 's1', 9500, 600, now()), ('cart2', 'u2', 's1', 2000, 600, now()), ('cart3', 'u3', 's1', 3500, 600, now())`,
  `INSERT INTO "CartItem" (id, "cartId", "productId", quantity, "variationIds", "modifiersJson", "optionsJson", "unitPriceCents", "unitPrepSeconds", "updatedAt") VALUES
   ('ci1', 'cart1', 'p1', 1, '{v1}', '{}', '[]', 3000, 180, now()),
   ('ci2', 'cart1', 'p2', 2, '{}', '{}', '[{"optionId":"oi_milk_oat","qty":1}]', 1000, 180, now()),
   ('ci3', 'cart2', 'p2', 2, '{}', '{"m1":0}', '[]', 1000, 180, now()),
   ('ci4', 'cart3', 'p1', 1, '{}', '{"m1":"1"}', '[]', 3500, 180, now()),
   ('ci5', 'cart1', 'p1', 1, '{}', '{"m1":3}', '[]', 4500, 180, now())`,
  `INSERT INTO "Order" (id, "storeId", "userId", "orderCode", "qrToken", "pickupAt", "subtotalCents", "totalCents", currency)
   VALUES ('o1', 's1', 'u1', 'A1', 'qr1', now(), 3000, 3000, 'MDL')`,
  `INSERT INTO "OrderItem" (id, "orderId", "productSnapshot", quantity, "unitPriceCents", "totalCents")
   VALUES ('oit1', 'o1', '{"id":"p1","name":"Latte","variationIds":["v1"],"modifiers":{},"variations":[{"id":"v1","type":"SIZE","name":"L","priceDeltaCents":0}],"modifierLines":[]}', 1, 3000, 3000)`,
];
