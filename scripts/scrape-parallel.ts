/**
 * Parallel scraping script — scrapes all food subcategories concurrently.
 *
 * Run locally:
 *   DATABASE_URL=... npx tsx scripts/scrape-parallel.ts
 *   DATABASE_URL=... CONCURRENCY=5 npx tsx scripts/scrape-parallel.ts
 *   DATABASE_URL=... CITY_KASPI_ID=710000000 npx tsx scripts/scrape-parallel.ts  # Astana
 *   DATABASE_URL=... MAX_PRODUCTS=10 npx tsx scripts/scrape-parallel.ts
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { discoverSubcategories, scrapeCategory } from "../lib/scraper";

type Product = { id: string; name: string; imageUrl?: string; productUrl: string; price: number };

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter, log: ["error", "warn"] });

const CITY_KASPI_ID = process.env.CITY_KASPI_ID ?? "750000000";
const CONCURRENCY = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY) : 3;
const BATCH_SIZE = 50;

async function getCity(kaspiId: string) {
  return prisma.city.findUnique({ where: { kaspiId } });
}

async function getOrCreateCity(kaspiId: string): Promise<number> {
  const existing = await getCity(kaspiId);
  if (existing) return existing.id;
  const created = await prisma.city.create({ data: { kaspiId, name: kaspiId } });
  return created.id;
}

async function flush(products: Product[], cityDbId: number, category?: string) {
  if (products.length === 0) return;

  const values = products
    .map((_, i) => `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`)
    .join(", ");
  const params = products.flatMap((p) => [p.id, p.name, p.imageUrl ?? null, p.productUrl, category ?? null]);

  await prisma.$executeRawUnsafe(
    `INSERT INTO products (kaspi_id, name, image_url, product_url, category)
     VALUES ${values}
     ON CONFLICT (kaspi_id) DO UPDATE SET
       name        = EXCLUDED.name,
       image_url   = EXCLUDED.image_url,
       product_url = EXCLUDED.product_url,
       category    = EXCLUDED.category`,
    ...params
  );

  const dbProducts = await prisma.product.findMany({
    where: { kaspiId: { in: products.map((p) => p.id) } },
    select: { id: true, kaspiId: true },
  });
  const idMap = new Map(dbProducts.map((p) => [p.kaspiId, p.id]));

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const productIds = dbProducts.map((p) => p.id);

  const rawMaxPrices = await prisma.$queryRaw`
    SELECT product_id, MAX(price) as max_price
    FROM price_snapshots
    WHERE product_id = ANY(${productIds}::int[])
      AND city_id = ${cityDbId}
      AND scraped_at >= ${thirtyDaysAgo}
    GROUP BY product_id
  `;
  const maxPriceMap = new Map(
    (rawMaxPrices as { product_id: number; max_price: unknown }[]).map((r) => [
      Number(r.product_id),
      Number(r.max_price),
    ])
  );

  const now = new Date();
  const snapshots = products
    .filter((p) => idMap.has(p.id))
    .map((p) => {
      const dbId = idMap.get(p.id)!;
      const maxPrice = maxPriceMap.get(dbId);
      const trueDiscount =
        maxPrice && maxPrice > p.price
          ? Math.round(((maxPrice - p.price) / maxPrice) * 100 * 10) / 10
          : 0;
      return { productId: dbId, cityId: cityDbId, price: p.price, trueDiscount, scrapedAt: now };
    });

  if (snapshots.length > 0) {
    await prisma.priceSnapshot.createMany({ data: snapshots });
  }
}

async function scrapeSubcategory(
  categoryUrl: string,
  label: string,
  cityDbId: number
): Promise<{ total: number; errors: number }> {
  let total = 0;
  let errors = 0;
  let buffer: Product[] = [];

  for await (const page of scrapeCategory(categoryUrl, label)) {
    buffer.push(...page);
    total += page.length;

    if (buffer.length >= BATCH_SIZE) {
      try {
        await flush(buffer, cityDbId, label);
      } catch (err) {
        console.error(`[${label}] Batch flush error:`, (err as Error).message);
        errors++;
      }
      buffer = [];
    }
  }

  if (buffer.length > 0) {
    try {
      await flush(buffer, cityDbId, label);
    } catch (err) {
      console.error(`[${label}] Final flush error:`, (err as Error).message);
      errors++;
    }
  }

  return { total, errors };
}

async function main() {
  console.log(`Starting parallel scrape — city: ${CITY_KASPI_ID}, concurrency: ${CONCURRENCY}`);
  const startedAt = new Date();

  const cityDbId = await getOrCreateCity(CITY_KASPI_ID);
  console.log(`City DB id: ${cityDbId}`);

  console.log("Discovering subcategories…");
  const subcategories = await discoverSubcategories(CITY_KASPI_ID);

  if (subcategories.length === 0) {
    console.error("No subcategories discovered — aborting.");
    process.exit(1);
  }

  console.log(`Found ${subcategories.length} subcategories: ${subcategories.map((s) => s.title).join(", ")}`);

  let grandTotal = 0;
  let grandErrors = 0;

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < subcategories.length; i += CONCURRENCY) {
    const chunk = subcategories.slice(i, i + CONCURRENCY);
    console.log(
      `\nChunk ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(subcategories.length / CONCURRENCY)}: ${chunk.map((s) => s.title).join(", ")}`
    );

    const results = await Promise.all(
      chunk.map((sub) => scrapeSubcategory(sub.url, sub.title, cityDbId))
    );

    for (const r of results) {
      grandTotal += r.total;
      grandErrors += r.errors;
    }
  }

  // Prune snapshots older than 90 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const { count: pruned } = await prisma.priceSnapshot.deleteMany({
    where: { scrapedAt: { lt: ninetyDaysAgo } },
  });

  const elapsed = Math.round((Date.now() - startedAt.getTime()) / 1000);
  console.log(
    `\nDone. Products: ${grandTotal}, errors: ${grandErrors}, pruned: ${pruned}, elapsed: ${elapsed}s`
  );
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
