CREATE TABLE "day_routine" (
	"user_id" uuid NOT NULL,
	"day_type" text NOT NULL,
	"wake_time" time NOT NULL,
	"work_start" time,
	"work_end" time,
	"training_time" time,
	"bed_time" time NOT NULL,
	"meal_count" smallint DEFAULT 4 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_routine_pkey" PRIMARY KEY("user_id","day_type"),
	CONSTRAINT "day_routine_day_type_check" CHECK ("day_routine"."day_type" IN ('training', 'rest')),
	CONSTRAINT "day_routine_meal_count_check" CHECK ("day_routine"."meal_count" BETWEEN 1 AND 8),
	CONSTRAINT "day_routine_training_time_check" CHECK ("day_routine"."day_type" = 'training' OR "day_routine"."training_time" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "goal_phase" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"target_rate_pct_per_week" numeric(4, 2),
	"protein_g_per_kg" numeric(4, 2) NOT NULL,
	"fat_pct_calories" numeric(4, 1) NOT NULL,
	"calorie_target_kcal" integer NOT NULL,
	"calorie_basis" text NOT NULL,
	"calorie_target_set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_phase_type_check" CHECK ("goal_phase"."type" IN ('cut', 'bulk', 'maintain')),
	CONSTRAINT "goal_phase_calorie_basis_check" CHECK ("goal_phase"."calorie_basis" IN ('provisional_formula', 'measured', 'manual')),
	CONSTRAINT "goal_phase_dates_check" CHECK ("goal_phase"."ended_on" IS NULL OR "goal_phase"."ended_on" >= "goal_phase"."started_on")
);
--> statement-breakpoint
CREATE TABLE "meal_slot" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"day_type" text NOT NULL,
	"position" smallint NOT NULL,
	"target_time" time NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_slot_day_type_check" CHECK ("meal_slot"."day_type" IN ('training', 'rest'))
);
--> statement-breakpoint
CREATE TABLE "plan_day" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"day_type" text NOT NULL,
	"goal_phase_id" uuid,
	"target_kcal" integer NOT NULL,
	"target_protein_g" numeric(6, 1) NOT NULL,
	"target_carb_g" numeric(6, 1) NOT NULL,
	"target_fat_g" numeric(6, 1) NOT NULL,
	"shortfalls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_day_user_id_plan_date_key" UNIQUE("user_id","plan_date"),
	CONSTRAINT "plan_day_day_type_check" CHECK ("plan_day"."day_type" IN ('training', 'rest'))
);
--> statement-breakpoint
CREATE TABLE "plan_meal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plan_day_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"planned_time" time NOT NULL,
	"label" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"is_pre_training" boolean DEFAULT false NOT NULL,
	"is_post_training" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_meal_status_check" CHECK ("plan_meal"."status" IN ('planned', 'as_planned', 'adjusted', 'replaced', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "plan_meal_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plan_meal_id" uuid NOT NULL,
	"food_id" uuid,
	"name" text NOT NULL,
	"planned_grams" numeric(7, 2),
	"actual_grams" numeric(7, 2),
	"piece_count" numeric(5, 2),
	"cooked" boolean DEFAULT false NOT NULL,
	"approximate" boolean DEFAULT false NOT NULL,
	"no_cooked_match" boolean DEFAULT false NOT NULL,
	"energy_kcal_per_100g" numeric(7, 2) NOT NULL,
	"protein_g_per_100g" numeric(6, 2) NOT NULL,
	"carb_g_per_100g" numeric(6, 2) NOT NULL,
	"fat_g_per_100g" numeric(6, 2) NOT NULL,
	"fiber_g_per_100g" numeric(6, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "day_routine" ADD CONSTRAINT "day_routine_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_phase" ADD CONSTRAINT "goal_phase_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_slot" ADD CONSTRAINT "meal_slot_day_routine_fkey" FOREIGN KEY ("user_id","day_type") REFERENCES "public"."day_routine"("user_id","day_type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_day" ADD CONSTRAINT "plan_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_day" ADD CONSTRAINT "plan_day_goal_phase_id_goal_phase_id_fk" FOREIGN KEY ("goal_phase_id") REFERENCES "public"."goal_phase"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meal" ADD CONSTRAINT "plan_meal_plan_day_id_plan_day_id_fk" FOREIGN KEY ("plan_day_id") REFERENCES "public"."plan_day"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meal_item" ADD CONSTRAINT "plan_meal_item_plan_meal_id_plan_meal_id_fk" FOREIGN KEY ("plan_meal_id") REFERENCES "public"."plan_meal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meal_item" ADD CONSTRAINT "plan_meal_item_food_id_food_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."food"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_phase_user_id_open_key" ON "goal_phase" USING btree ("user_id") WHERE "goal_phase"."ended_on" IS NULL;--> statement-breakpoint
CREATE INDEX "goal_phase_user_id_started_on_idx" ON "goal_phase" USING btree ("user_id","started_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "meal_slot_user_id_day_type_position_idx" ON "meal_slot" USING btree ("user_id","day_type","position");--> statement-breakpoint
CREATE INDEX "plan_day_goal_phase_id_idx" ON "plan_day" USING btree ("goal_phase_id");--> statement-breakpoint
CREATE INDEX "plan_meal_plan_day_id_position_idx" ON "plan_meal" USING btree ("plan_day_id","position");--> statement-breakpoint
CREATE INDEX "plan_meal_item_plan_meal_id_idx" ON "plan_meal_item" USING btree ("plan_meal_id");--> statement-breakpoint
CREATE INDEX "plan_meal_item_food_id_idx" ON "plan_meal_item" USING btree ("food_id");