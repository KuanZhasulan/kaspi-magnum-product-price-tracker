import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

interface ProductRow {
  id: number;
  kaspi_id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  product_url: string;
  unit: string | null;
  price: number;
  true_discount: number;
  scraped_at: Date;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = 12;
  const offset = (page - 1) * limit;

  const where = search
    ? { name: { contains: search, mode: "insensitive" as const } }
    : {};

  const [rawRows, totalCount] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        p.id,
        p.kaspi_id,
        p.name,
        p.brand,
        p.image_url,
        p.product_url,
        p.unit,
        ps.price,
        COALESCE(ps.true_discount, 0) AS true_discount,
        ps.scraped_at
      FROM products p
      INNER JOIN LATERAL (
        SELECT price, true_discount, scraped_at
        FROM price_snapshots
        WHERE product_id = p.id
        ORDER BY scraped_at DESC
        LIMIT 1
      ) ps ON TRUE
      WHERE (${search} = '' OR p.name ILIKE ${"%" + search + "%"})
      ORDER BY true_discount DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    prisma.product.count({ where }),
  ]);

  const rows = rawRows as ProductRow[];

  const products = rows.map((r) => ({
    id: r.id,
    kaspiId: r.kaspi_id,
    name: r.name,
    brand: r.brand,
    imageUrl: r.image_url,
    productUrl: r.product_url,
    unit: r.unit,
    price: Number(r.price),
    trueDiscount: Number(r.true_discount),
    scrapedAt: r.scraped_at,
  }));

  return Response.json({
    products,
    total: totalCount,
    page,
    totalPages: Math.ceil(totalCount / limit),
  });
}
