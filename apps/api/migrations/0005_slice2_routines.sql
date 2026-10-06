CREATE TABLE "routine" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_exercise" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"routine_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"target_sets" smallint DEFAULT 3 NOT NULL,
	"rep_low" smallint,
	"rep_high" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routine_exercise_target_sets_check" CHECK ("routine_exercise"."target_sets" > 0),
	CONSTRAINT "routine_exercise_rep_range_check" CHECK ("routine_exercise"."rep_low" IS NULL OR "routine_exercise"."rep_high" IS NULL OR "routine_exercise"."rep_low" <= "routine_exercise"."rep_high")
);
--> statement-breakpoint
ALTER TABLE "routine" ADD CONSTRAINT "routine_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_exercise" ADD CONSTRAINT "routine_exercise_routine_id_routine_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routine_user_id_position_idx" ON "routine" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "routine_exercise_routine_id_position_idx" ON "routine_exercise" USING btree ("routine_id","position");--> statement-breakpoint
CREATE INDEX "routine_exercise_exercise_id_idx" ON "routine_exercise" USING btree ("exercise_id");