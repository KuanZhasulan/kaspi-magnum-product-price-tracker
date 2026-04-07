-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "kaspi_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "image_url" TEXT,
    "product_url" TEXT NOT NULL,
    "unit" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "true_discount" DOUBLE PRECISION,
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_kaspi_id_key" ON "products"("kaspi_id");

-- CreateIndex
CREATE INDEX "price_snapshots_product_id_idx" ON "price_snapshots"("product_id");

-- CreateIndex
CREATE INDEX "price_snapshots_scraped_at_idx" ON "price_snapshots"("scraped_at");

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
