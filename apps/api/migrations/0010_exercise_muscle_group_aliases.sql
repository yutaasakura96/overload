ALTER TABLE "exercise" ADD COLUMN "muscle_group" text;--> statement-breakpoint
ALTER TABLE "exercise" ADD COLUMN "aliases" text[];--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_muscle_group_check" CHECK ("exercise"."muscle_group" IN ('chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core'));