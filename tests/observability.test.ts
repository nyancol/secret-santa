import { describe, expect, it } from "vitest";
import { isRedactedKey, sanitizeAttributes } from "../src/observability/sanitize.js";
import { parseOtelEnv } from "../src/observability/env.js";
import { withSpan } from "../src/observability/trace.js";

describe("sanitize", () => {
  it("redacts secret-valued keys and passes the rest through", () => {
    const out = sanitizeAttributes({
      authorization: "Bearer abc",
      cookie: "sess=1",
      clientSecret: "shh",
      apiKey: "k",
      "url.path": "/api/health",
    });
    expect(out).toMatchObject({
      authorization: "[Redacted]",
      cookie: "[Redacted]",
      clientSecret: "[Redacted]",
      apiKey: "[Redacted]",
      "url.path": "/api/health",
    });
  });

  it("isRedactedKey matches secret patterns case-insensitively", () => {
    expect(isRedactedKey("Authorization")).toBe(true);
    expect(isRedactedKey("x-token")).toBe(true);
    expect(isRedactedKey("service.name")).toBe(false);
  });
});

describe("withSpan", () => {
  it("returns the fn result", async () => {
    await expect(withSpan("test.ok", { "url.path": "/" }, async () => 42)).resolves.toBe(42);
  });

  it("records the error and rethrows", async () => {
    await expect(
      withSpan("test.err", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("parseOtelEnv", () => {
  it("disables telemetry on an invalid endpoint URL", () => {
    const otel = parseOtelEnv({ ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: "::bad" });
    expect(otel.enabled).toBe(false);
    expect(otel.endpoint).toBe("");
  });

  it("treats OTEL_SERVICE_VERSION=unknown as unset (falls back to package.json)", () => {
    const otel = parseOtelEnv({
      ...process.env,
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://lgtm:4318",
      OTEL_SERVICE_NAME: "secret-santa",
      OTEL_SERVICE_VERSION: "unknown",
    });
    expect(otel.enabled).toBe(true);
    expect(otel.serviceVersion).not.toBe("unknown");
  });
});
