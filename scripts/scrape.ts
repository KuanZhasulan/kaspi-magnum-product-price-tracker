/**
 * Daily scraping script — run by GitHub Actions.
 *
 * What it does:
 *   1. Fetches all Magnum food products from kaspi.kz
 *   2. Upserts product records
 *   3. Inserts a price snapshot for today
 *   4. Calculates "true_discount": how much cheaper the product is TODAY
 *      compared to its highest price in the last 30 days (not the badge kaspi shows)
 *
 * Run locally:
 *   DATABASE_URL=... npx tsx scripts/scrape.ts
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { scrapeAllProducts } from "../lib/scraper";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter, log: ["error", "warn"] });

const BATCH_SIZE = 100; // upsert products in batches

async function main() {
  console.log("Starting daily Magnum price scrape…");
  const startedAt = new Date();
  let total = 0;
  let errors = 0;

  // Buffer products and flush in batches for efficiency
  let buffer: { id: string; name: string; brand?: string; imageUrl?: string; productUrl: string; price: number; unit?: string }[] = [];

  async function flush(products: { id: string; name: string; brand?: string; imageUrl?: string; productUrl: string; price: number; unit?: string }[]) {
    if (products.length === 0) return;

    // Upsert all products
    await prisma.$transaction(
      products.map((p) =>
        prisma.product.upsert({
          where: { kaspiId: p.id },
          create: {
            kaspiId: p.id,
            name: p.name,
            brand: p.brand ?? null,
            imageUrl: p.imageUrl ?? null,
            productUrl: p.productUrl,
            unit: p.unit ?? null,
          },
          update: {
            name: p.name,
            imageUrl: p.imageUrl ?? null,
            productUrl: p.productUrl,
            unit: p.unit ?? null,
          },
        })
      )
    );

    // Get DB ids for these kaspiIds
    const dbProducts = await prisma.product.findMany({
      where: { kaspiId: { in: products.map((p) => p.id) } },
      select: { id: true, kaspiId: true },
    });
    const idMap = new Map(dbProducts.map((p) => [p.kaspiId, p.id]));

    // Calculate true discounts using 30-day max price from DB
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const productIds = dbProducts.map((p) => p.id);

    // Get 30-day max prices in bulk using a raw query for performance
    const rawMaxPrices = await prisma.$queryRaw`
      SELECT product_id, MAX(price) as max_price
      FROM price_snapshots
      WHERE product_id = ANY(${productIds}::int[])
        AND scraped_at >= ${thirtyDaysAgo}
      GROUP BY product_id
    `;
    const maxPriceMap = new Map(
      (rawMaxPrices as { product_id: number; max_price: unknown }[]).map(
        (r) => [Number(r.product_id), Number(r.max_price)]
      )
    );

    // Insert price snapshots
    const now = new Date();
    await prisma.priceSnapshot.createMany({
      data: products
        .filter((p) => idMap.has(p.id))
        .map((p) => {
          const dbId = idMap.get(p.id)!;
          const maxPrice = maxPriceMap.get(dbId);
          const trueDiscount =
            maxPrice && maxPrice > p.price
              ? Math.round(((maxPrice - p.price) / maxPrice) * 100 * 10) / 10
              : 0;
          return {
            productId: dbId,
            price: p.price,
            trueDiscount,
            scrapedAt: now,
          };
        }),
      skipDuplicates: false,
    });
  }

  for await (const page of scrapeAllProducts()) {
    buffer.push(...page);
    total += page.length;

    if (buffer.length >= BATCH_SIZE) {
      try {
        await flush(buffer);
      } catch (err) {
        console.error("Batch flush error:", err);
        errors++;
      }
      buffer = [];
    }

    if (total % 1000 === 0) {
      console.log(`  Processed ${total} products…`);
    }
  }

  // Final flush
  if (buffer.length > 0) {
    try {
      await flush(buffer);
    } catch (err) {
      console.error("Final flush error:", err);
      errors++;
    }
  }

  // Prune snapshots older than 90 days to keep DB size manageable
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const { count: pruned } = await prisma.priceSnapshot.deleteMany({
    where: { scrapedAt: { lt: ninetyDaysAgo } },
  });

  const elapsed = Math.round((Date.now() - startedAt.getTime()) / 1000);
  console.log(`Done. Products: ${total}, errors: ${errors}, pruned snapshots: ${pruned}, elapsed: ${elapsed}s`);
}

main()
  .catch((err) => {
    console.error("Fatal scrape error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
