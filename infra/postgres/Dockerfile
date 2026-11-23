# Postgres + pgvector con el script que crea el rol de la app (chatea_app) ya incluido.
# Así no depende de montar archivos del repo en el servidor.
FROM pgvector/pgvector:pg17
COPY infra/postgres/init.sh /docker-entrypoint-initdb.d/01-init.sh
RUN chmod 0755 /docker-entrypoint-initdb.d/01-init.sh
