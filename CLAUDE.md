# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this project does

Daily price tracker for Kaspi.kz grocery (food) category products. A Puppeteer scraper runs on GitHub Actions, upserts products and price snapshots into a Neon PostgreSQL database, and computes a "true discount" (current price vs. 30-day max for that city). A Next.js frontend lets users browse and search products sorted by real discount.

## Commands

```bash
npm run dev                  # Start Next.js dev server
npm run build                # Production build
npm run lint                 # ESLint
npm run scrape               # Sequential full-category scraper
npm run scrape:parallel      # Parallel subcategory scraper (3 concurrent)
npm run scrape:test          # Scrape only 10 products (MAX_PRODUCTS=10)
npm run db:generate          # Regenerate Prisma client after schema changes
npm run db:migrate           # Create and apply a new migration (dev)
npm run db:migrate:deploy    # Apply pending migrations (CI/prod)
```

## Architecture

### Data pipeline

1. `scripts/scrape-parallel.ts` runs at 02:00 UTC via GitHub Actions — discovers food subcategories from the Kaspi window object, scrapes up to 3 concurrently.
2. `scripts/scrape.ts` runs at 03:00 UTC — sequential fallback/complement scraper for the full food category.
3. Both scripts: batch-upsert products (50/flush), write `PriceSnapshot` rows, recompute `trueDiscount` (vs. 30-day max in city), prune snapshots older than 90 days.
4. Core scraping logic lives in `lib/scraper.ts` (Puppeteer, page navigation, card extraction).

### Database (Prisma + Neon PostgreSQL)

Schema: `prisma/schema.prisma`. Three models:
- `City` — Kaspi city IDs (Almaty 750000000, Astana 710000000, Shymkent 720000000)
- `Product` — deduplicated by `kaspiId`
- `PriceSnapshot` — price per product/city/date, with `trueDiscount`

Prisma client is generated into `app/generated/prisma/` (non-standard location). The singleton is in `lib/db.ts` using `@prisma/adapter-pg`.

### Frontend (Next.js App Router)

- `app/page.tsx` — server component, hero text in Russian
- `app/api/products/route.ts` — GET endpoint; raw SQL with a LATERAL join for the latest snapshot per product, sorted by `true_discount DESC`
- `app/components/ProductsView.tsx` — client component; MUI Card grid, debounced search, URL-param pagination
- `app/components/ThemeRegistry.tsx` — MUI theme with Kaspi red (`#e53935`)

### Environment

Only one required env var: `DATABASE_URL` (PostgreSQL connection string). See `.env.example`.

### Scraper env vars (optional)

| Var | Default | Purpose |
|-----|---------|---------|
| `MAX_PRODUCTS` | unlimited | Cap products scraped (for testing) |
| `CITY_KASPI_ID` | 750000000 | City to scrape |
| `CONCURRENCY` | 3 | Parallel subcategory workers |
