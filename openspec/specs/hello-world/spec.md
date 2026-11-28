# Hello World API

This is the initial capability of the secret-santa service.

## Purpose

Provide a minimal, healthy, observable HTTP service that proves the full
DevOps loop (dev → CI → preprod → prod + telemetry) before any domain logic lands.

## Requirements

### Requirement: Root greeting
The system SHALL respond to `GET /` with HTTP 200 and a JSON body containing
`hello: "world"`, `service: "secret-santa"`, plus `version` and `origin`.

#### Scenario: Greeting
- **WHEN** a client calls `GET /`
- **THEN** the response is 200 with `{ hello: "world", service: "secret-santa", ... }`.

### Requirement: Health endpoint
The system SHALL expose `GET /api/health` returning HTTP 200 with
`{ status: "ok", service: "secret-santa", version, uptime }` without auth.

#### Scenario: Health check
- **WHEN** Docker/Caddy polls `GET /api/health`
- **THEN** the response is 200 and `status` is `"ok"`.

### Requirement: Telemetry is endpoint-gated
The system SHALL export OTEL signals only when `OTEL_EXPORTER_OTLP_ENDPOINT`
is a valid http(s) URL; otherwise it SHALL run dark (no-op) and log that
telemetry is disabled. Health spans SHALL be dropped.

#### Scenario: Dark by default
- **WHEN** the endpoint env is unset/empty in dev/preprod
- **THEN** the app boots normally with telemetry disabled.

### Requirement: Graceful shutdown
The system SHALL drain in-flight requests and flush OTEL on SIGTERM/SIGINT
within `SHUTDOWN_TIMEOUT_MS` (default 9s), inside the 20s Docker grace period.
