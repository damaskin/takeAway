/**
 * takeAway — development seed.
 *
 * Creates a single brand, two demo stores, a minimal menu, and variations/modifiers.
 * Idempotent: uses `upsert` keyed on slugs so it can be re-run safely.
 *
 * Run with:
 *   pnpm prisma:seed
 */

import { PrismaClient, VariationType } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.user.upsert({
    where: { phone: '+10000000001' },
    update: { role: 'SUPER_ADMIN' },
    create: { phone: '+10000000001', name: 'Dev Super Admin', role: 'SUPER_ADMIN' },
  });

  const brand = await prisma.brand.upsert({
    where: { slug: 'takeaway' },
    update: {},
    create: {
      slug: 'takeaway',
      name: 'takeAway',
      currency: 'USD',
      locale: 'EN',
    },
  });

  await prisma.store.upsert({
    where: { slug: 'dubai-marina' },
    update: {},
    create: {
      brandId: brand.id,
      slug: 'dubai-marina',
      name: 'takeAway Marina',
      addressLine: 'Marina Walk, Dubai Marina',
      city: 'Dubai',
      country: 'AE',
      latitude: 25.078,
      longitude: 55.141,
      timezone: 'Asia/Dubai',
      currency: 'AED',
      fulfillmentTypes: ['TAKEAWAY', 'DINE_IN'],
      pickupPointType: 'SHELF',
      busyMeter: 35,
      currentEtaSeconds: 360,
      workingHours: {
        create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          opensAt: 7 * 60,
          closesAt: 22 * 60,
        })),
      },
    },
  });

  await prisma.store.upsert({
    where: { slug: 'london-shoreditch' },
    update: {},
    create: {
      brandId: brand.id,
      slug: 'london-shoreditch',
      name: 'takeAway Shoreditch',
      addressLine: '1 Old Street',
      city: 'London',
      country: 'GB',
      latitude: 51.525,
      longitude: -0.087,
      timezone: 'Europe/London',
      currency: 'GBP',
      fulfillmentTypes: ['TAKEAWAY'],
      pickupPointType: 'COUNTER',
      busyMeter: 60,
      currentEtaSeconds: 540,
      workingHours: {
        create: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          opensAt: 7 * 60 + 30,
          closesAt: 20 * 60,
        })),
      },
    },
  });

  const coffee = await prisma.category.upsert({
    where: { brandId_slug: { brandId: brand.id, slug: 'coffee' } },
    update: {},
    create: { brandId: brand.id, slug: 'coffee', name: 'Coffee', sortOrder: 10 },
  });

  const breakfast = await prisma.category.upsert({
    where: { brandId_slug: { brandId: brand.id, slug: 'breakfast' } },
    update: {},
    create: {
      brandId: brand.id,
      slug: 'breakfast',
      name: 'Breakfast',
      sortOrder: 20,
      availableFrom: 7 * 60,
      availableTo: 12 * 60,
    },
  });

  const desserts = await prisma.category.upsert({
    where: { brandId_slug: { brandId: brand.id, slug: 'desserts' } },
    update: {},
    create: { brandId: brand.id, slug: 'desserts', name: 'Desserts', sortOrder: 30 },
  });

  const latte = await prisma.product.upsert({
    where: { brandId_slug: { brandId: brand.id, slug: 'latte' } },
    update: {},
    create: {
      brandId: brand.id,
      categoryId: coffee.id,
      slug: 'latte',
      name: 'Latte',
      description: 'Espresso with steamed milk and a thin layer of foam.',
      basePriceCents: 450,
      prepTimeSeconds: 180,
      caffeineLevel: 2,
      calories: 150,
      allergens: ['milk'],
    },
  });

  for (const v of [
    { type: VariationType.SIZE, name: 'Small', priceDeltaCents: 0, isDefault: true, sortOrder: 1 },
    { type: VariationType.SIZE, name: 'Medium', priceDeltaCents: 70, sortOrder: 2 },
    { type: VariationType.SIZE, name: 'Large', priceDeltaCents: 140, sortOrder: 3 },
    { type: VariationType.TEMPERATURE, name: 'Hot', isDefault: true, sortOrder: 1 },
    { type: VariationType.TEMPERATURE, name: 'Iced', sortOrder: 2 },
    { type: VariationType.MILK, name: 'Whole', isDefault: true, sortOrder: 1 },
    { type: VariationType.MILK, name: 'Oat', priceDeltaCents: 60, sortOrder: 2 },
    { type: VariationType.MILK, name: 'Almond', priceDeltaCents: 60, sortOrder: 3 },
  ]) {
    await prisma.variation.create({ data: { productId: latte.id, ...v } });
  }

  for (const m of [
    { slug: 'extra-shot', name: 'Extra shot', priceDeltaCents: 80, prepTimeDeltaSeconds: 20, maxCount: 3 },
    { slug: 'vanilla-syrup', name: 'Vanilla syrup', priceDeltaCents: 50, maxCount: 2 },
    { slug: 'caramel-syrup', name: 'Caramel syrup', priceDeltaCents: 50, maxCount: 2 },
  ]) {
    await prisma.modifier.create({ data: { productId: latte.id, ...m } });
  }

  await prisma.product.upsert({
    where: { brandId_slug: { brandId: brand.id, slug: 'avocado-toast' } },
    update: {},
    create: {
      brandId: brand.id,
      categoryId: breakfast.id,
      slug: 'avocado-toast',
      name: 'Avocado Toast',
      description: 'Sourdough, smashed avocado, chili flakes, lemon.',
      basePriceCents: 950,
      prepTimeSeconds: 300,
      calories: 380,
      dietTags: ['VEGAN'],
      allergens: ['gluten'],
    },
  });

  await prisma.product.upsert({
    where: { brandId_slug: { brandId: brand.id, slug: 'almond-croissant' } },
    update: {},
    create: {
      brandId: brand.id,
      categoryId: desserts.id,
      slug: 'almond-croissant',
      name: 'Almond Croissant',
      description: 'Flaky pastry with almond cream.',
      basePriceCents: 480,
      prepTimeSeconds: 60,
      calories: 420,
      allergens: ['gluten', 'nuts', 'milk'],
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
