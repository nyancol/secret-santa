import { diag } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchLogRecordProcessor, type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import {
  PeriodicExportingMetricReader,
  createAllowListAttributesProcessor,
} from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  type SpanProcessor,
  type ReadableSpan,
  type Span,
} from "@opentelemetry/sdk-trace";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import type { OtelConfig } from "./env.js";

export interface Observability {
  enabled: boolean;
  shutdown: () => Promise<void>;
}

const noop: Observability = { enabled: false, shutdown: async () => {} };

/** Path portion of a URL-ish value (drops query string / fragment). */
function pathOf(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const noQuery = value.split("?")[0].split("#")[0];
  try {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(noQuery)) return new URL(noQuery).pathname;
  } catch {
    return noQuery;
  }
  return noQuery;
}

function isHealthSpan(span: ReadableSpan | Span): boolean {
  const attrs = (span as ReadableSpan).attributes ?? {};
  const candidates = [
    attrs["http.route"],
    attrs["http.target"],
    attrs["url.path"],
    attrs["http.url"],
    attrs["url.full"],
  ];
  if (candidates.some((c) => pathOf(c) === "/api/health")) return true;
  const name = (span as ReadableSpan).name ?? "";
  return name.includes("/api/health");
}

/** Drops GET /api/health spans. */
export class HealthFilterProcessor implements SpanProcessor {
  constructor(private readonly next: SpanProcessor) {}

  onStart(span: Span, parentContext: unknown): void {
    this.next.onStart(span, parentContext as never);
  }

  onEnd(span: ReadableSpan): void {
    if (isHealthSpan(span)) return;
    this.next.onEnd(span);
  }

  async shutdown(): Promise<void> {
    await this.next.shutdown();
  }

  async forceFlush(): Promise<void> {
    await this.next.forceFlush();
  }
}

/**
 * Low-cardinality HTTP attributes kept on metric streams. Deliberately
 * EXCLUDES high-cardinality paths/queries.
 */
export const HTTP_ALLOWLIST = [
  "http.request.method",
  "http.method",
  "http.route",
  "http.response.status_code",
  "http.status_code",
  "url.scheme",
  "http.scheme",
  "server.address",
  "http.host",
];

export function buildMetricViews(): unknown[] {
  return [
    {
      instrumentName: "http.server.*",
      attributesProcessors: [createAllowListAttributesProcessor(HTTP_ALLOWLIST)],
    },
    {
      instrumentName: "http.client.*",
      attributesProcessors: [
        createAllowListAttributesProcessor([...HTTP_ALLOWLIST, "peer.service"]),
      ],
    },
  ];
}

export function initObservability(config: OtelConfig): Observability {
  const endpoint = (config.otelEndpoint ?? "").trim();
  if (!config.otelEnabled || !endpoint) {
    return noop;
  }

  const base = endpoint.replace(/\/+$/, "");
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.otelServiceName || "secret-santa",
    [ATTR_SERVICE_VERSION]: config.otelServiceVersion || "unknown",
    "deployment.environment": config.otelEnvironment || config.nodeEnv,
  });

  try {
    const traceExporter = new OTLPTraceExporter({
      url: `${base}/v1/traces`,
      timeoutMillis: 10_000,
      concurrencyLimit: 1,
    });
    const metricExporter = new OTLPMetricExporter({
      url: `${base}/v1/metrics`,
      timeoutMillis: 10_000,
      concurrencyLimit: 1,
    });
    const logExporter = new OTLPLogExporter({
      url: `${base}/v1/logs`,
      timeoutMillis: 10_000,
      concurrencyLimit: 1,
    });

    const spanProcessor = new HealthFilterProcessor(
      new BatchSpanProcessor({
        exporter: traceExporter,
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 10_000,
      }),
    );

    const sdk = new NodeSDK({
      resource,
      traceExporter,
      spanProcessors: [spanProcessor as never],
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 60_000,
      }) as never,
      logRecordProcessors: [
        new BatchLogRecordProcessor({ exporter: logExporter }) as never,
      ] as never,
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
        }),
        new FastifyInstrumentation(),
      ],
    } as never);

    try {
      sdk.start();
    } catch (err) {
      diag.error("OTEL SDK start failed, telemetry disabled", err);
      return noop;
    }

    let shut = false;
    return {
      enabled: true,
      shutdown: async () => {
        if (shut) return;
        shut = true;
        try {
          await sdk.shutdown();
        } catch (err) {
          diag.error("OTEL SDK shutdown failed", err);
        }
      },
    };
  } catch (err) {
    diag.error("OTEL init failed, telemetry disabled", err);
    return noop;
  }
}
