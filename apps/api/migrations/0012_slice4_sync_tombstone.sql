CREATE TABLE "sync_tombstone" (
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_tombstone_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "sync_tombstone_table_name_check" CHECK ("sync_tombstone"."table_name" IN ('workout', 'workout_exercise', 'set'))
);
--> statement-breakpoint
ALTER TABLE "sync_tombstone" ADD CONSTRAINT "sync_tombstone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_tombstone_created_at_idx" ON "sync_tombstone" USING btree ("created_at");