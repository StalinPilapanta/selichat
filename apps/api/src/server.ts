import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const app = await buildApp(env);

// Un error en segundo plano (agente, recordatorios, correo) se registra; no tumba el API.
process.on("unhandledRejection", (err) => {
  app.log.error({ err }, "promesa rechazada sin manejar");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: env.PORT, host: "0.0.0.0" });
