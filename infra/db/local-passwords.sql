-- infra/db/local-passwords.sql
--
-- Development passwords for the local Docker Postgres ONLY. Runs after
-- bootstrap.sql from docker-entrypoint-initdb.d. Never run against Neon:
-- staging and production passwords are generated per environment and live in
-- Vercel (docs/13 §5).

ALTER ROLE overload_owner  PASSWORD 'overload_owner_dev';
ALTER ROLE overload_app    PASSWORD 'overload_app_dev';
ALTER ROLE overload_backup PASSWORD 'overload_backup_dev';
