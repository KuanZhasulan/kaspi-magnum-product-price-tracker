/**
 * Kaspi.kz Magnum food product scraper.
 *
 * Kaspi serves category/search pages as a Next.js app — product data is embedded
 * in the `__NEXT_DATA__` script tag on every page. We fetch each page, extract
 * the JSON, and pull out product objects.
 *
 * How to find the right URL/params if things change:
 *   1. Open https://kaspi.kz/shop/c/food/ in Chrome DevTools → Network tab
 *   2. Filter by "Fetch/XHR" requests
 *   3. Look for requests to /yml/offer-search.jsp or /search endpoints
 *   4. Copy the URL and update SEARCH_URL below
 */
import axios from "axios";

export interface KaspiProduct {
  id: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  productUrl: string;
  price: number;
  unit?: string;
}

// Kaspi's internal search API for the food category filtered to Magnum merchant.
// The `q` param encodes facets as colon-separated key:value pairs.
const BASE_URL = "https://kaspi.kz/yml/offer-search.jsp";
const PAGE_SIZE = 24;
const REQUEST_DELAY_MS = 800; // be polite — don't hammer them
const MAX_RETRIES = 3;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: "https://kaspi.kz/shop/c/food/",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(page: number): Promise<KaspiProduct[]> {
  const params = {
    text: "",
    // facets: popular sort, all categories, merchant = Magnum
    q: ":popular:category:ALL:merchantName:Magnum",
    page,
    sc: "food",
    ui: "d",
    i: "1",
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios.get(BASE_URL, {
        params,
        headers: HEADERS,
        timeout: 15_000,
      });

      const data = res.data;

      // Kaspi returns a JSON envelope; extract the product list.
      // Shape (as observed): { data: { cards: [...] } }
      // Each card: { id, title, unitName, previewImage, masterProduct: { image }, offer: { price } }
      const cards: Record<string, unknown>[] =
        data?.data?.cards ??
        data?.cards ??
        data?.results ??
        [];

      return cards.map(parseCard);
    } catch (err: unknown) {
      if (attempt === MAX_RETRIES) throw err;
      const delay = attempt * 2000;
      console.warn(`Page ${page} attempt ${attempt} failed, retrying in ${delay}ms…`, (err as Error).message);
      await sleep(delay);
    }
  }
  return [];
}

function parseCard(card: Record<string, unknown>): KaspiProduct {
  const offer = (card.offer ?? card) as Record<string, unknown>;
  const master = (card.masterProduct ?? {}) as Record<string, unknown>;

  const price =
    typeof offer.price === "number"
      ? offer.price
      : Number(offer.price ?? offer.unitPrice ?? 0);

  const id = String(card.id ?? card.kaspiId ?? card.sku ?? "");
  const name = String(card.title ?? card.name ?? "");
  const imageUrl =
    String(card.previewImage ?? master.image ?? offer.imageUrl ?? "").trim() ||
    undefined;
  const slug = String(card.characteristicArticle ?? card.slug ?? id);
  const unit = String(offer.unitName ?? card.unitName ?? "").trim() || undefined;

  return {
    id,
    name,
    brand: undefined, // Kaspi doesn't surface brand in search cards
    imageUrl,
    productUrl: `https://kaspi.kz/shop/p/${slug}/`,
    price,
    unit,
  };
}

/** Fetch one page to discover the total product count, then return it. */
async function getTotalCount(): Promise<number> {
  const res = await axios.get(BASE_URL, {
    params: {
      text: "",
      q: ":popular:category:ALL:merchantName:Magnum",
      page: 0,
      sc: "food",
      ui: "d",
      i: "1",
    },
    headers: HEADERS,
    timeout: 15_000,
  });
  const data = res.data;
  return (
    data?.data?.total ??
    data?.total ??
    data?.totalCount ??
    data?.pagination?.total ??
    30_000 // fallback: assume 30k
  );
}

export async function* scrapeAllProducts(): AsyncGenerator<KaspiProduct[]> {
  const total = await getTotalCount();
  const totalPages = Math.ceil(total / PAGE_SIZE);
  console.log(`Total products: ~${total}, pages: ${totalPages}`);

  for (let page = 0; page < totalPages; page++) {
    const products = await fetchPage(page);
    if (products.length === 0) {
      console.log(`Page ${page} returned 0 products — stopping early.`);
      break;
    }
    yield products;
    if (page < totalPages - 1) await sleep(REQUEST_DELAY_MS);
  }
}
