#!/bin/sh
# Crea el rol con el que corre la app. No es superusuario ni dueño de las tablas,
# así las políticas de Row Level Security siempre se le aplican.
set -eu
: "${APP_DB_PASSWORD:?Falta APP_DB_PASSWORD}"
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_pw="$APP_DB_PASSWORD" -v db="$POSTGRES_DB" -v owner="$POSTGRES_USER" <<'SQL'
CREATE ROLE chatea_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE :"db" TO chatea_app;
GRANT USAGE ON SCHEMA public TO chatea_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chatea_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO chatea_app;
CREATE EXTENSION IF NOT EXISTS vector;
SQL
