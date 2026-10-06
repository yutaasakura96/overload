-- Slice 2's object that Drizzle's schema cannot express (docs/12 §3).
-- Custom migration: drizzle-kit does not track it, so a later change is another
-- custom migration.

-- A slot's exercise. Deferred, so deleting a user, which cascades to exercise and
-- routine as separate steps, is checked once at commit after every cascade, not
-- refused midway (docs/04 `routine_exercise`, tested on Postgres 18 2026-09-22).
-- The API checks first when an exercise is deleted, so it can name the routines.
ALTER TABLE routine_exercise
  ADD CONSTRAINT routine_exercise_exercise_id_exercise_id_fk
  FOREIGN KEY (exercise_id) REFERENCES exercise (id)
  ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
