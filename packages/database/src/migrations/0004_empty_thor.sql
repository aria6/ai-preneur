ALTER TABLE "sm_batches" ADD COLUMN "description" varchar(2000);--> statement-breakpoint
-- IDEA_ID becomes unique. Existing duplicates keep the number on their oldest batch; the
-- newer ones get the next free numbers (max + 1, + 2, …) so the index can be created.
WITH "dupes" AS (
  SELECT "id", "created_at", row_number() OVER (PARTITION BY "idea_number" ORDER BY "created_at", "id") AS "rn"
  FROM "sm_batches"
), "renumbered" AS (
  SELECT "id", (SELECT coalesce(max("idea_number"), 0) FROM "sm_batches")
    + row_number() OVER (ORDER BY "created_at", "id") AS "next_number"
  FROM "dupes"
  WHERE "rn" > 1
)
UPDATE "sm_batches" SET "idea_number" = "renumbered"."next_number"
FROM "renumbered"
WHERE "sm_batches"."id" = "renumbered"."id";--> statement-breakpoint
CREATE UNIQUE INDEX "sm_batches_idea_number_unique" ON "sm_batches" USING btree ("idea_number");
