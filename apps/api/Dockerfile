# Construir desde la raíz del repo: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@chatea/api...
RUN pnpm --filter @chatea/api deploy --prod /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
ENV UPLOAD_DIR=/app/data/uploads
USER node
EXPOSE 4000
# Aplica migraciones (con el usuario dueño) y arranca el servidor (con el usuario de la app).
CMD ["sh", "-c", "node node_modules/@chatea/db/dist/migrate.js && node dist/server.js"]
