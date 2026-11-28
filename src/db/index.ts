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
  {
    version: 2,
    name: "santa events",
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        signup_deadline TEXT,
        draw_date TEXT,
        gift_date TEXT,
        budget_amount REAL NOT NULL,
        budget_currency TEXT NOT NULL,
        organiser_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','drawn')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_organiser ON events(organiser_id);
      CREATE TABLE IF NOT EXISTS event_participants (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_participants_user ON event_participants(user_id);
      CREATE TABLE IF NOT EXISTS event_exclusions (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        giver_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, giver_id, recipient_id),
        CHECK (giver_id != recipient_id),
        FOREIGN KEY (event_id, giver_id) REFERENCES event_participants(event_id, user_id) ON DELETE CASCADE,
        FOREIGN KEY (event_id, recipient_id) REFERENCES event_participants(event_id, user_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS event_assignments (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        giver_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, giver_id),
        UNIQUE (event_id, recipient_id),
        CHECK (giver_id != recipient_id),
        FOREIGN KEY (event_id, giver_id) REFERENCES event_participants(event_id, user_id) ON DELETE CASCADE,
        FOREIGN KEY (event_id, recipient_id) REFERENCES event_participants(event_id, user_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS participant_profiles (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        recipient_name TEXT,
        address_line1 TEXT,
        address_line2 TEXT,
        city TEXT,
        postal_code TEXT,
        country TEXT,
        phone TEXT,
        notes TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, user_id),
        FOREIGN KEY (event_id, user_id) REFERENCES event_participants(event_id, user_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS wishlist_items (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        label TEXT NOT NULL,
        url TEXT,
        price_hint TEXT,
        priority INTEGER,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (event_id, user_id) REFERENCES event_participants(event_id, user_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_wishlist_owner ON wishlist_items(event_id, user_id, position);
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
