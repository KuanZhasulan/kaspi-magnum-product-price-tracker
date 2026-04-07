-- CreateTable
CREATE TABLE "cities" (
    "id" SERIAL NOT NULL,
    "kaspi_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cities_kaspi_id_key" ON "cities"("kaspi_id");

-- Seed known cities
INSERT INTO "cities" ("kaspi_id", "name") VALUES
    ('750000000', 'Almaty'),
    ('710000000', 'Astana'),
    ('720000000', 'Shymkent');

-- Add city_id as nullable first so existing rows don't violate the constraint
ALTER TABLE "price_snapshots" ADD COLUMN "city_id" INTEGER;

-- Backfill existing snapshots to Almaty (id = 1)
UPDATE "price_snapshots" SET "city_id" = 1;

-- Now enforce NOT NULL
ALTER TABLE "price_snapshots" ALTER COLUMN "city_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "price_snapshots_city_id_idx" ON "price_snapshots"("city_id");

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_city_id_fkey"
    FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
