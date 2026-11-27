import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import { discoverOidc, registerAuthRoutes } from "./auth/routes.js";
import { registerDevLoginRoute } from "./auth/dev-routes.js";
import { sessionCookieName, verifySession } from "./auth/session.js";
import { type AppConfig } from "./config.js";
import { dbHealth, openDb, runMigrations } from "./db/index.js";
import { buildPinoOptions } from "./observability/logger.js";
import { registerSecurity } from "./security.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
function packageVersion(): string {
  try {
    return (require("../package.json") as any)?.version ?? "0.0.0";
  } catch {
    try {
      return (require("../../package.json") as any)?.version ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
}

const PUBLIC_PATHS = new Set([
  "/",
  "/api/health",
  "/api/auth/login",
  "/api/auth/callback",
  "/api/auth/dev-login", // only registered when DEV_LOGIN=true + non-production; 404 otherwise
  "/api/v1/openapi.json",
]);

export interface BuildOptions {
  config: AppConfig;
  skipOidcDiscovery?: boolean;
}

export async function buildApp(
  opts: BuildOptions,
): Promise<{ app: FastifyInstance; oidcFailed?: Error }> {
  const { config } = opts;
  const app = Fastify({ logger: buildPinoOptions(), trustProxy: config.trustProxy });

  const { sqlite, db } = openDb(config.databasePath);
  runMigrations(sqlite);
  app.decorate("db", db);
  app.decorate("sqlite", sqlite);
  app.addHook("onClose", async () => {
    try {
      sqlite.close();
    } catch {
      /* ignore */
    }
  });

  await app.register(cookie);
  await registerSecurity(app, config);
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: { title: "Secret Santa API", version: packageVersion() },
    },
  });

  // Session guard: /api/v1/* requires session; /api/auth/* requires session
  // except the public allowlist (login/callback/logout/me handled below).
  // (No M2M Bearer yet — wire verifyPlacesBearer here when the first
  // service-to-service /api/v1/* resource lands; see src/auth/places-bearer.ts.)
  app.addHook("onRequest", async (req, reply) => {
    const urlPath = req.url.split("?")[0];
    if (!urlPath.startsWith("/api/")) return;
    if (PUBLIC_PATHS.has(urlPath)) return;
    if (!urlPath.startsWith("/api/auth/") && !urlPath.startsWith("/api/v1/")) return;
    const token = req.cookies?.[sessionCookieName()];
    const userId = token ? await verifySession(config.sessionSecret, token) : null;
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    (req as any).userId = userId;
  });

  app.get("/", async () => ({
    hello: "world",
    service: "secret-santa",
    version: packageVersion(),
    origin: config.appOrigin,
  }));

  app.get("/api/health", async () => ({
    status: "ok",
    db: dbHealth(sqlite),
    service: "secret-santa",
    version: packageVersion(),
    uptime: Math.round(process.uptime()),
  }));

  app.get("/api/v1/openapi.json", async () => app.swagger());

  // OIDC discovery (fail fast on bad issuer unless skipped for tests).
  let oidcConfig: any = null;
  let oidcFailed: Error | undefined;
  if (!opts.skipOidcDiscovery) {
    try {
      oidcConfig = await discoverOidc(config);
      if (oidcConfig) app.log.info(`OIDC discovery ok for issuer ${config.oidcIssuer}`);
      else
        app.log.warn(
          "OIDC not configured; /api/auth/login will return 503 until OIDC_ISSUER/OIDC_CLIENT_ID are set.",
        );
    } catch (err: any) {
      app.log.error(`Invalid OIDC config: ${err.message}`);
      oidcFailed = err;
    }
  }
  const getOidc = () => oidcConfig;

  registerAuthRoutes(app, { config, db, sqlite, log: app.log }, getOidc);
  if (config.devLoginEnabled) {
    app.log.warn(
      "DEV_LOGIN enabled — POST /api/auth/dev-login mints test sessions. Never enable in production.",
    );
    registerDevLoginRoute(app, { config, db });
  }

  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
    return reply.code(404).send({ error: "not_found" });
  });

  return { app, oidcFailed };
}
