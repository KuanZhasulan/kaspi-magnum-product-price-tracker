/**
 * Kaspi.kz food category scraper using Puppeteer.
 *
 * Navigates https://kaspi.kz/shop/c/food/ and paginates through all pages,
 * extracting product cards from the rendered DOM.
 *
 * Set MAX_PRODUCTS env var to limit how many products to fetch (useful for testing).
 */
import puppeteer, { type Browser, type Page } from "puppeteer";

export interface KaspiProduct {
  id: string;
  name: string;
  imageUrl?: string;
  productUrl: string;
  price: number;
}

const PAGE_WAIT_MS = 2500;
const MAX_PRODUCTS = process.env.MAX_PRODUCTS ? parseInt(process.env.MAX_PRODUCTS) : Infinity;

async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
}

/** Parse price text like "285 ₸" → 285 */
function parsePrice(text: string): number {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

/** Extract all product cards visible on the current page */
async function extractCards(page: Page): Promise<KaspiProduct[]> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".item-card"));
    return cards.map((card) => {
      const id = card.getAttribute("data-product-id") ?? "";
      const nameLink = card.querySelector<HTMLAnchorElement>(".item-card__name-link");
      const name = nameLink?.textContent?.trim() ?? "";
      const relativeUrl = nameLink?.getAttribute("href") ?? "";
      const productUrl = relativeUrl.startsWith("http")
        ? relativeUrl
        : "https://kaspi.kz" + relativeUrl;
      const img = card.querySelector<HTMLImageElement>(".item-card__image");
      const imageUrl = img?.getAttribute("src") ?? undefined;
      // First price span is the actual price (second is instalment)
      const priceEl = card.querySelector(".item-card__prices-price");
      const priceText = priceEl?.textContent?.trim() ?? "0";
      return { id, name, imageUrl, productUrl, priceText };
    });
  }).then((raw) =>
    raw
      .filter((r) => r.id && r.name)
      .map((r) => ({
        id: r.id,
        name: r.name,
        imageUrl: r.imageUrl || undefined,
        productUrl: r.productUrl,
        price: parsePrice(r.priceText),
      }))
  );
}

/** Returns true if the "Next" button exists and is not disabled */
async function hasNextPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll(".pagination__el"));
    const next = els.find((el) => el.textContent?.includes("Следующая"));
    return !!next && !next.classList.contains("_disabled");
  });
}

/** Click the "Next" button and wait for cards to reload */
async function clickNext(page: Page): Promise<void> {
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll(".pagination__el"));
    const next = els.find((el) => el.textContent?.includes("Следующая")) as HTMLElement | undefined;
    next?.click();
  });
  await new Promise((r) => setTimeout(r, PAGE_WAIT_MS));
  await page.waitForSelector(".item-card", { timeout: 15000 }).catch(() => {});
}

/** Scrape all pages of any kaspi category URL, yielding batches of products. */
async function* scrapeUrl(url: string, label = url): AsyncGenerator<KaspiProduct[]> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "ru-RU,ru;q=0.9" });

    console.log(`[${label}] Loading ${url} …`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, PAGE_WAIT_MS));
    await page.waitForSelector(".item-card", { timeout: 20000 });

    let collected = 0;
    let pageNum = 1;

    while (true) {
      if (collected >= MAX_PRODUCTS) break;

      const cards = await extractCards(page);
      if (cards.length === 0) {
        console.warn(`[${label}] Page ${pageNum} returned 0 cards, stopping.`);
        break;
      }

      const remaining = MAX_PRODUCTS - collected;
      const batch = cards.slice(0, remaining);
      collected += batch.length;
      console.log(`[${label}] Page ${pageNum}: ${batch.length} products (total: ${collected})`);
      yield batch;

      if (!(await hasNextPage(page))) break;
      await clickNext(page);
      pageNum++;
    }
  } finally {
    await browser.close();
  }
}

/** Original single-scraper entry point — scrapes the whole food category sequentially. */
export async function* scrapeAllProducts(cityKaspiId: string): AsyncGenerator<KaspiProduct[]> {
  yield* scrapeUrl(`https://kaspi.kz/shop/c/food/?c=${cityKaspiId}`, "food");
}

/** Scrape a specific subcategory URL (used by the parallel script). */
export async function* scrapeCategory(categoryUrl: string, label: string): AsyncGenerator<KaspiProduct[]> {
  yield* scrapeUrl(categoryUrl, label);
}

export interface Subcategory {
  code: string;
  title: string;
  url: string;
}

/** Load the food page and extract all visible subcategory links from BACKEND config. */
export async function discoverSubcategories(cityKaspiId: string): Promise<Subcategory[]> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "ru-RU,ru;q=0.9" });
    await page.goto(`https://kaspi.kz/shop/c/food/?c=${cityKaspiId}`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    const nodes = await page.evaluate(() => {
      const catalog = (window as unknown as Record<string, unknown>)
        .BACKEND as { components?: { catalog?: { categoryInfo?: { subNodes?: unknown[] } } } } | undefined;
      return catalog?.components?.catalog?.categoryInfo?.subNodes ?? [];
    });

    return (nodes as Array<Record<string, unknown>>)
      .filter((n) => n.visible === true && n.allGoods !== true && typeof n.link === "string")
      .map((n) => ({
        code: String(n.code),
        title: String(n.title),
        url: `https://kaspi.kz/shop/${n.link}?c=${cityKaspiId}`,
      }));
  } finally {
    await browser.close();
  }
}
