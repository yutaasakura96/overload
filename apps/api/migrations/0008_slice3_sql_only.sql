-- Slice 3's object that Drizzle's schema cannot express (docs/12 §3).
-- Custom migration: drizzle-kit does not track it, so a later change is another
-- custom migration.

-- A workout exercise's exercise. Deferred for the same reason as routine_exercise's
-- (0006): deleting a user cascades to exercise and to workout as separate steps, so
-- the check runs once at commit, after every cascade (docs/04 `workout_exercise`).
-- The API refuses deleting an exercise that has history first (exercise_has_history).
ALTER TABLE workout_exercise
  ADD CONSTRAINT workout_exercise_exercise_id_exercise_id_fk
  FOREIGN KEY (exercise_id) REFERENCES exercise (id)
  ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
