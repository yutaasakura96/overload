CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"detail" jsonb,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "audit_event_action_check" CHECK ("audit_event"."action" IN ('sign_in', 'sign_out', 'invite_created', 'access_revoked', 'access_restored', 'ingest_token_created', 'ingest_token_revoked', 'account_deleted', 'admin_action'))
);
--> statement-breakpoint
CREATE TABLE "exercise" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"equipment" text NOT NULL,
	"default_increment_kg" numeric(5, 2) DEFAULT 2.5 NOT NULL,
	"default_rest_seconds" integer DEFAULT 120 NOT NULL,
	"default_rep_low" smallint DEFAULT 6 NOT NULL,
	"default_rep_high" smallint DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_equipment_check" CHECK ("exercise"."equipment" IN ('barbell', 'dumbbell', 'machine_plate', 'machine_stack', 'cable', 'bodyweight', 'other')),
	CONSTRAINT "exercise_rep_range_check" CHECK ("exercise"."default_rep_low" <= "exercise"."default_rep_high")
);
--> statement-breakpoint
CREATE TABLE "exercise_setting" (
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"increment_kg" numeric(5, 2),
	"rest_seconds" integer,
	"rep_low" smallint,
	"rep_high" smallint,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_setting_pkey" PRIMARY KEY("user_id","exercise_id"),
	CONSTRAINT "exercise_setting_rep_range_check" CHECK ("exercise_setting"."rep_low" IS NULL OR "exercise_setting"."rep_high" IS NULL OR "exercise_setting"."rep_low" <= "exercise_setting"."rep_high")
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"invited_by_user_id" uuid,
	"note" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_email_key" UNIQUE("email"),
	CONSTRAINT "invite_email_check" CHECK ("invite"."email" = lower("invite"."email"))
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"height_cm" numeric(5, 1),
	"sex" text,
	"birth_date" date,
	"training_weekdays" smallint[] DEFAULT '{}' NOT NULL,
	"weight_unit" text DEFAULT 'kg' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_sex_check" CHECK ("user_profile"."sex" IN ('male', 'female')),
	CONSTRAINT "user_profile_weight_unit_check" CHECK ("user_profile"."weight_unit" IN ('kg', 'lb'))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_setting" ADD CONSTRAINT "exercise_setting_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_setting" ADD CONSTRAINT "exercise_setting_exercise_id_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercise"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_actor_user_id_occurred_at_idx" ON "audit_event" USING btree ("actor_user_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_event_occurred_at_idx" ON "audit_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "exercise_owner_user_id_idx" ON "exercise" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");