CREATE TABLE "food" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"state" text DEFAULT 'raw' NOT NULL,
	"energy_kcal" numeric(7, 2) NOT NULL,
	"protein_g" numeric(6, 2) NOT NULL,
	"carb_g" numeric(6, 2) NOT NULL,
	"fat_g" numeric(6, 2) NOT NULL,
	"fiber_g" numeric(6, 2) DEFAULT 0 NOT NULL,
	"piece_weight_g" numeric(6, 2),
	"keeps_days" smallint,
	"source" text NOT NULL,
	"source_ref" text,
	"rotation_group_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_state_check" CHECK ("food"."state" IN ('raw', 'cooked')),
	CONSTRAINT "food_source_check" CHECK ("food"."source" IN ('mext', 'open_food_facts', 'label_photo', 'manual')),
	CONSTRAINT "food_piece_weight_g_check" CHECK ("food"."piece_weight_g" > 0),
	CONSTRAINT "food_keeps_days_check" CHECK ("food"."keeps_days" BETWEEN 1 AND 30)
);
--> statement-breakpoint
CREATE TABLE "model_call_count" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"calls" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_call_count_pkey" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "reference_food" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"food_group" smallint NOT NULL,
	"state" text NOT NULL,
	"energy_kcal" numeric(7, 2) NOT NULL,
	"protein_g" numeric(6, 2) NOT NULL,
	"carb_g" numeric(6, 2) NOT NULL,
	"fat_g" numeric(6, 2) NOT NULL,
	"fiber_g" numeric(6, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_food_state_check" CHECK ("reference_food"."state" IN ('raw', 'cooked')),
	CONSTRAINT "reference_food_food_group_check" CHECK ("reference_food"."food_group" BETWEEN 1 AND 18)
);
--> statement-breakpoint
CREATE TABLE "rotation_group" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food" ADD CONSTRAINT "food_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food" ADD CONSTRAINT "food_rotation_group_id_rotation_group_id_fk" FOREIGN KEY ("rotation_group_id") REFERENCES "public"."rotation_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_call_count" ADD CONSTRAINT "model_call_count_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_group" ADD CONSTRAINT "rotation_group_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_user_id_idx" ON "food" USING btree ("user_id") WHERE "food"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "food_user_id_source_ref_idx" ON "food" USING btree ("user_id","source_ref");--> statement-breakpoint
CREATE INDEX "food_rotation_group_id_idx" ON "food" USING btree ("rotation_group_id");--> statement-breakpoint
CREATE INDEX "rotation_group_user_id_idx" ON "rotation_group" USING btree ("user_id");