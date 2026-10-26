ALTER TABLE "plan_meal_item" ADD COLUMN "yield_ratio" numeric(15, 12);
--> statement-breakpoint
UPDATE "plan_meal_item" AS item
SET "yield_ratio" = b."cooked_weight_g" / b."raw_weight_g"
FROM "batch" AS b
WHERE item."batch_id" = b."id";
