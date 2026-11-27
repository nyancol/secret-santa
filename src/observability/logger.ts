import type { LoggerOptions } from "pino";

/** Pino options shared by app + tests (plain JSON; no pretty transport to keep deps minimal). */
export function buildPinoOptions(): LoggerOptions {
  const level = process.env.LOG_LEVEL?.trim() || "info";
  return { level };
}
