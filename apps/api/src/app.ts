import { createDb } from "@chatea/db";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { runFollowUps } from "./agent/followups.js";
import { runSalesAgent } from "./agent/sales-agent.js";
import { AgentScheduler } from "./agent/scheduler.js";
import {
  createModelResolver,
  createTranscriberResolver,
  type ModelResolver,
  type TranscriberResolver,
} from "./ai/models.js";
import { createAuth } from "./auth.js";
import { Geocoder } from "./carriers/agencias-geo.js";
import type { Env } from "./env.js";
import { createMailer } from "./mailer.js";
import { notifyStage, runPickupReminders } from "./orders/notify.js";
import { type OnStage, syncDropiStatuses } from "./orders/service.js";
import { RealtimeBus } from "./realtime.js";
import { aiRoutes } from "./routes/ai.js";
import { authRoutes } from "./routes/auth.js";
import { type ImportDeps, importRoutes } from "./routes/import.js";
import { inboxRoutes } from "./routes/inbox.js";
import { orderRoutes } from "./routes/orders.js";
import { productRoutes } from "./routes/products.js";
import { promptRoutes } from "./routes/prompts.js";
import { tenantRoutes } from "./routes/tenant.js";
import { uploadRoutes } from "./routes/uploads.js";
import { whatsappRoutes } from "./routes/whatsapp.js";

export interface AppDeps extends ImportDeps {
  resolveModel?: ModelResolver;
  resolveTranscriber?: TranscriberResolver;
  /** fetch hacia proveedores de IA (inyectable en pruebas). */
  providerFetch?: typeof fetch;
  /** fetch hacia la Graph API de Meta (inyectable en pruebas). */
  metaFetch?: typeof fetch;
  /** fetch hacia la API de Dropi (inyectable en pruebas). */
  dropiFetch?: typeof fetch;
  /** fetch hacia el buscador de agencias Servientrega (inyectable en pruebas). */
  agencyFetch?: typeof fetch;
  /** fetch hacia el geocodificador (OpenStreetMap); en pruebas sin esto no se geocodifica. */
  geoFetch?: typeof fetch;
  bus?: RealtimeBus;
  /** Para pruebas: acceso al scheduler del agente. */
  onScheduler?: (s: AgentScheduler) => void;
  /** Para pruebas: corre la consulta de estados de Dropi (conexiones MCP) a demanda. */
  onDropiSync?: (run: () => Promise<{ updated: number; reminders: number }>) => void;
}

export async function buildApp(env: Env, deps: AppDeps = {}) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie", "*.apiKey", "*.password"],
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    },
    trustProxy: true,
  });

  const { db, client } = createDb(env.DATABASE_URL);
  const mail = createMailer({ smtpUrl: env.SMTP_URL, from: env.EMAIL_FROM, log: app.log });
  const auth = createAuth({ env, db, mail });

  await app.register(cors, { origin: [env.WEB_URL], credentials: true });

  const health = async () => {
    await client`select 1`;
    return { ok: true, mail: mail.status() };
  };
  app.get("/health", health);
  // Visible desde el dominio público (la web solo reenvía /api/*).
  app.get("/api/health", health);

  await app.register(authRoutes, { auth });
  await app.register(tenantRoutes, {
    auth,
    db,
    encryptionKey: env.ENCRYPTION_KEY,
    fetchImpl: deps.providerFetch,
  });
  await app.register(productRoutes, { auth, db });
  await app.register(promptRoutes, { auth, db });
  await app.register(importRoutes, { auth, db, loadWorkspace: deps.loadWorkspace });
  const bus = deps.bus ?? new RealtimeBus();
  const wa = {
    encryptionKey: env.ENCRYPTION_KEY,
    graphVersion: env.WHATSAPP_GRAPH_VERSION,
    fetchImpl: deps.metaFetch,
  };
  const dropi = { encryptionKey: env.ENCRYPTION_KEY, fetchImpl: deps.dropiFetch };
  // Referencias del cliente → agencia más cercana (OpenStreetMap, 1 petición por segundo).
  const geocoder = env.NODE_ENV === "test" && !deps.geoFetch ? null : new Geocoder(deps.geoFetch);
  const agencies = env.SERVIENTREGA_URL
    ? {
        url: env.SERVIENTREGA_URL,
        encryptionKey: env.ENCRYPTION_KEY,
        fetchImpl: deps.agencyFetch,
        geocoder,
      }
    : undefined;
  // Avisos al cliente cuando el pedido llega a la agencia o tiene novedad.
  const onStage: OnStage = (tenantId, orderId, stage) =>
    notifyStage({ db, ...dropi, wa, bus }, tenantId, orderId, stage).catch((err) =>
      app.log.error({ err, orderId }, "falló el aviso del pedido"),
    );
  const dropiPass = async () => {
    const { updated } = await syncDropiStatuses({ db, ...dropi }, 40, onStage);
    const { sent } = await runPickupReminders({ db, ...dropi, wa, bus });
    return { updated, reminders: sent };
  };
  const resolveModel = deps.resolveModel ?? createModelResolver(db, env.ENCRYPTION_KEY);
  const resolveTranscriber =
    deps.resolveTranscriber ?? createTranscriberResolver(db, env.ENCRYPTION_KEY);
  const scheduler = new AgentScheduler(
    (tenantId, conversationId) =>
      runSalesAgent(
        {
          db,
          wa,
          bus,
          resolveModel,
          resolveTranscriber,
          dropi,
          agencies,
          log: app.log,
          typingPaceMs: env.NODE_ENV === "test" ? 0 : 25,
        },
        tenantId,
        conversationId,
      ),
    env.AGENT_DEBOUNCE_MS,
    (e, conversationId) =>
      app.log.error({ err: e, conversationId }, "error en el turno del agente"),
  );
  deps.onScheduler?.(scheduler);
  deps.onDropiSync?.(dropiPass);
  // Recordatorios automáticos (Catálogo → Seguimiento). Una pasada a la vez.
  let followUpsBusy = false;
  const followUpsTimer =
    env.FOLLOWUPS_INTERVAL_MS > 0 && env.NODE_ENV !== "test"
      ? setInterval(async () => {
          if (followUpsBusy) return;
          followUpsBusy = true;
          try {
            await runFollowUps({ db, wa, bus, resolveModel, log: app.log });
          } catch (err) {
            app.log.error({ err }, "falló la pasada de recordatorios");
          } finally {
            followUpsBusy = false;
          }
        }, env.FOLLOWUPS_INTERVAL_MS)
      : null;
  followUpsTimer?.unref();
  // Estados de Dropi (conexiones por cuenta/MCP, sin webhook) y recordatorios de retiro.
  let dropiSyncBusy = false;
  const dropiSyncTimer =
    env.DROPI_SYNC_INTERVAL_MS > 0 && env.NODE_ENV !== "test"
      ? setInterval(async () => {
          if (dropiSyncBusy) return;
          dropiSyncBusy = true;
          try {
            await dropiPass();
          } catch (err) {
            app.log.error({ err }, "falló la consulta de estados en Dropi");
          } finally {
            dropiSyncBusy = false;
          }
        }, env.DROPI_SYNC_INTERVAL_MS)
      : null;
  dropiSyncTimer?.unref();
  await app.register(whatsappRoutes, {
    auth,
    db,
    bus,
    wa,
    publicBaseUrl: env.WEB_URL,
    onInbound: (t, c) => scheduler.schedule(t, c),
  });
  await app.register(orderRoutes, {
    auth,
    db,
    dropi,
    publicBaseUrl: env.WEB_URL,
    agencyUrl: env.SERVIENTREGA_URL,
    onStage,
  });
  await app.register(inboxRoutes, { auth, db, bus, wa, uploadDir: env.UPLOAD_DIR });
  await app.register(uploadRoutes, {
    auth,
    db,
    uploadDir: env.UPLOAD_DIR,
    publicBaseUrl: env.WEB_URL,
  });
  await app.register(aiRoutes, {
    auth,
    db,
    resolveModel,
    sim: { dropi, agencies },
  });

  app.addHook("onClose", async () => {
    scheduler.stop();
    if (followUpsTimer) clearInterval(followUpsTimer);
    if (dropiSyncTimer) clearInterval(dropiSyncTimer);
    await client.end();
  });
  return app;
}
