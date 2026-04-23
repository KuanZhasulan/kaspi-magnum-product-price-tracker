import { prisma } from "@/lib/db";

export async function GET() {
  const rows = await prisma.product.findMany({
    where: { category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });

  const categories = rows.map((r) => r.category as string);
  return Response.json({ categories });
}
