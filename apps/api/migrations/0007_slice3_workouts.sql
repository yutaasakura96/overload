CREATE TABLE "set" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workout_exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"weight_kg" numeric(6, 2) NOT NULL,
	"reps" smallint NOT NULL,
	"rir" smallint,
	"rpe" numeric(3, 1),
	"is_warmup" boolean DEFAULT false NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "set_reps_check" CHECK ("set"."reps" > 0),
	CONSTRAINT "set_weight_kg_check" CHECK ("set"."weight_kg" >= 0),
	CONSTRAINT "set_rir_check" CHECK ("set"."rir" IS NULL OR "set"."rir" BETWEEN 0 AND 10),
	CONSTRAINT "set_rpe_check" CHECK ("set"."rpe" IS NULL OR "set"."rpe" BETWEEN 1 AND 10),
	CONSTRAINT "set_effort_check" CHECK ("set"."rir" IS NULL OR "set"."rpe" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "workout" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"routine_id" uuid,
	"name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"note" text,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_exercise" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workout_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"target_sets" smallint,
	"rep_low" smallint NOT NULL,
	"rep_high" smallint NOT NULL,
	"increment_kg" numeric(5, 2) NOT NULL,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_exercise_target_sets_check" CHECK ("workout_exercise"."target_sets" IS NULL OR "workout_exercise"."target_sets" > 0),
	CONSTRAINT "workout_exercise_rep_range_check" CHECK ("workout_exercise"."rep_low" <= "workout_exercise"."rep_high")
);
--> statement-breakpoint
ALTER TABLE "set" ADD CONSTRAINT "set_workout_exercise_id_workout_exercise_id_fk" FOREIGN KEY ("workout_exercise_id") REFERENCES "public"."workout_exercise"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout" ADD CONSTRAINT "workout_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout" ADD CONSTRAINT "workout_routine_id_routine_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routine"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercise" ADD CONSTRAINT "workout_exercise_workout_id_workout_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "set_workout_exercise_id_position_idx" ON "set" USING btree ("workout_exercise_id","position");--> statement-breakpoint
CREATE INDEX "workout_user_id_started_at_idx" ON "workout" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workout_exercise_workout_id_position_idx" ON "workout_exercise" USING btree ("workout_id","position");--> statement-breakpoint
CREATE INDEX "workout_exercise_exercise_id_idx" ON "workout_exercise" USING btree ("exercise_id");