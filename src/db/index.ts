import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const MIGRATIONS = [
  {
    version: 1,
    name: "init users",
    sql: `
      CREATE TABLE IF NOT EXISTS __migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        sub TEXT NOT NULL UNIQUE,
        display_name TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

export interface DbHandle {
  sqlite: Database.Database;
  db: BetterSQLite3Database;
}

export function openDb(databasePath: string): DbHandle {
  const dir = path.dirname(databasePath);
  if (dir && dir !== "." && dir !== "/") fs.mkdirSync(dir, { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, db: drizzle(sqlite) };
}

export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS __migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);`,
  );
  const applied = new Set(
    sqlite
      .prepare(`SELECT version FROM __migrations`)
      .all()
      .map((r: any) => r.version as number),
  );
  const insert = sqlite.prepare(`INSERT INTO __migrations (version, applied_at) VALUES (?, ?)`);
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const txn = sqlite.transaction(() => {
      sqlite.exec(m.sql);
      insert.run(m.version, Date.now());
    });
    txn();
  }
}

export function dbHealth(sqlite: Database.Database): "ok" | "error" {
  try {
    sqlite.prepare(`SELECT 1`).get();
    return "ok";
  } catch {
    return "error";
  }
}
