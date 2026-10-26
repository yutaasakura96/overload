CREATE TABLE "batch" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"raw_weight_g" numeric(8, 2) NOT NULL,
	"cooked_weight_g" numeric(8, 2) NOT NULL,
	"cooked_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_weights_check" CHECK ("batch"."raw_weight_g" > 0 AND "batch"."cooked_weight_g" > 0)
);
--> statement-breakpoint
ALTER TABLE "plan_meal_item" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_food_id_food_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."food"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_user_id_food_id_cooked_on_idx" ON "batch" USING btree ("user_id","food_id","cooked_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "batch_food_id_idx" ON "batch" USING btree ("food_id");--> statement-breakpoint
ALTER TABLE "plan_meal_item" ADD CONSTRAINT "plan_meal_item_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_meal_item_batch_id_idx" ON "plan_meal_item" USING btree ("batch_id");