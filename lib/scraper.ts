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

/** Returns the total number of pages from pagination */
async function getTotalPages(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll(".pagination__el"))
      .map((el) => parseInt(el.textContent?.trim() ?? "0", 10))
      .filter((n) => !isNaN(n) && n > 0);
    return pages.length ? Math.max(...pages) : 1;
  });
}

/** Navigate to a specific page number by clicking the pagination element */
async function goToPage(page: Page, pageNum: number): Promise<boolean> {
  const clicked = await page.evaluate((target) => {
    const els = Array.from(document.querySelectorAll(".pagination__el"));
    const el = els.find((e) => e.textContent?.trim() === String(target));
    if (el) {
      (el as HTMLElement).click();
      return true;
    }
    return false;
  }, pageNum);

  if (!clicked) return false;

  // Wait for new cards to load
  await new Promise((r) => setTimeout(r, PAGE_WAIT_MS));
  await page.waitForSelector(".item-card", { timeout: 15000 }).catch(() => {});
  return true;
}

export async function* scrapeAllProducts(cityKaspiId: string): AsyncGenerator<KaspiProduct[]> {
  const url = `https://kaspi.kz/shop/c/food/?c=${cityKaspiId}`;
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "ru-RU,ru;q=0.9" });

    console.log(`Loading ${url} …`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, PAGE_WAIT_MS));
    await page.waitForSelector(".item-card", { timeout: 20000 });

    const totalPages = await getTotalPages(page);
    console.log(`Total pages: ${totalPages}`);

    let collected = 0;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (collected >= MAX_PRODUCTS) break;

      if (pageNum > 1) {
        const ok = await goToPage(page, pageNum);
        if (!ok) {
          console.warn(`Could not navigate to page ${pageNum}, stopping.`);
          break;
        }
      }

      const cards = await extractCards(page);
      if (cards.length === 0) {
        console.warn(`Page ${pageNum} returned 0 cards, stopping.`);
        break;
      }

      const remaining = MAX_PRODUCTS - collected;
      const batch = cards.slice(0, remaining);
      collected += batch.length;

      console.log(`Page ${pageNum}/${totalPages}: ${batch.length} products (total: ${collected})`);
      yield batch;
    }
  } finally {
    await browser.close();
  }
}
