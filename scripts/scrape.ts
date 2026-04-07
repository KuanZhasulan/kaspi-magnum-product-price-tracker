/**
 * Daily scraping script — run by GitHub Actions.
 *
 * Run locally:
 *   DATABASE_URL=... npx tsx scripts/scrape.ts
 *   DATABASE_URL=... MAX_PRODUCTS=100 npx tsx scripts/scrape.ts
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { scrapeAllProducts } from "../lib/scraper";

type Product = { id: string; name: string; imageUrl?: string; productUrl: string; price: number };

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter, log: ["error", "warn"] });

const BATCH_SIZE = 50;

async function flush(products: Product[]) {
  if (products.length === 0) return;

  // Bulk upsert products via raw SQL — avoids transaction timeout on Neon free tier
  const values = products
    .map((_, i) => {
      const base = i * 4;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    })
    .join(", ");

  const params = products.flatMap((p) => [
    p.id,
    p.name,
    p.imageUrl ?? null,
    p.productUrl,
  ]);

  await prisma.$executeRawUnsafe(
    `INSERT INTO products (kaspi_id, name, image_url, product_url)
     VALUES ${values}
     ON CONFLICT (kaspi_id) DO UPDATE SET
       name        = EXCLUDED.name,
       image_url   = EXCLUDED.image_url,
       product_url = EXCLUDED.product_url`,
    ...params
  );

  // Fetch DB ids
  const dbProducts = await prisma.product.findMany({
    where: { kaspiId: { in: products.map((p) => p.id) } },
    select: { id: true, kaspiId: true },
  });
  const idMap = new Map(dbProducts.map((p) => [p.kaspiId, p.id]));

  // 30-day max prices for true discount calculation
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const productIds = dbProducts.map((p) => p.id);

  const rawMaxPrices = await prisma.$queryRaw`
    SELECT product_id, MAX(price) as max_price
    FROM price_snapshots
    WHERE product_id = ANY(${productIds}::int[])
      AND scraped_at >= ${thirtyDaysAgo}
    GROUP BY product_id
  `;
  const maxPriceMap = new Map(
    (rawMaxPrices as { product_id: number; max_price: unknown }[]).map((r) => [
      Number(r.product_id),
      Number(r.max_price),
    ])
  );

  // Bulk insert price snapshots
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
      return { productId: dbId, price: p.price, trueDiscount, scrapedAt: now };
    });

  if (snapshots.length > 0) {
    await prisma.priceSnapshot.createMany({ data: snapshots });
  }
}

async function main() {
  console.log("Starting daily price scrape…");
  const startedAt = new Date();
  let total = 0;
  let errors = 0;
  let buffer: Product[] = [];

  for await (const page of scrapeAllProducts()) {
    buffer.push(...page);
    total += page.length;

    if (buffer.length >= BATCH_SIZE) {
      try {
        await flush(buffer);
      } catch (err) {
        console.error("Batch flush error:", (err as Error).message);
        errors++;
      }
      buffer = [];
    }
  }

  if (buffer.length > 0) {
    try {
      await flush(buffer);
    } catch (err) {
      console.error("Final flush error:", (err as Error).message);
      errors++;
    }
  }

  // Prune snapshots older than 90 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const { count: pruned } = await prisma.priceSnapshot.deleteMany({
    where: { scrapedAt: { lt: ninetyDaysAgo } },
  });

  const elapsed = Math.round((Date.now() - startedAt.getTime()) / 1000);
  console.log(
    `Done. Products: ${total}, errors: ${errors}, pruned: ${pruned}, elapsed: ${elapsed}s`
  );
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
