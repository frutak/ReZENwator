/**
 * Teaches drizzle which migrations this database already has.
 *
 * `drizzle-kit migrate` has never worked here: the `__drizzle_migrations` table
 * exists but is empty, so the migrator believes nothing has ever been applied
 * and starts again from 0000 — which dies on `Table 'users' already exists`.
 * Every schema change since has been applied by hand, and each one made the gap
 * wider.
 *
 * The database itself is fine. What is missing is drizzle's record of what it
 * holds, and that record is just a list of hashes: the migrator stores the
 * sha256 of each migration file it runs, then on the next run applies only the
 * files whose timestamp is newer than the last one recorded. Writing those
 * hashes in — for migrations whose effects are demonstrably already present —
 * puts the two back in step.
 *
 * Nothing is created, altered or dropped. No table is touched but
 * `__drizzle_migrations`, and no SQL from any migration is executed. This is the
 * safe half of a repair whose other half — `drizzle-kit push` — would rewrite
 * columns to match the schema and is exactly what must not happen to live data.
 *
 * Before writing, every table the migrations create is checked to be present.
 * If one is missing, the migrations are not in fact applied and the script
 * refuses: recording them would then hide a real, pending change.
 *
 * Usage:
 *   npx tsx scripts/repair_migration_journal.ts          # dry run
 *   npx tsx scripts/repair_migration_journal.ts --apply  # write
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const APPLY = process.argv.includes("--apply");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

type JournalEntry = { idx: number; when: number; tag: string; breakpoints: boolean };

/** The hash drizzle stores is the sha256 of the migration file, verbatim. */
function migrationHash(tag: string): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");
  return crypto.createHash("sha256").update(sql).digest("hex");
}

/** Every table the schema expects — all of them must already exist. */
function tablesInSchema(): string[] {
  const schema = fs.readFileSync(path.join(MIGRATIONS_DIR, "schema.ts"), "utf8");
  return [...schema.matchAll(/mysqlTable\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

async function main() {
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL!, timezone: "Z" });
  console.log(APPLY ? "MODE: APPLY (writing changes)\n" : "MODE: DRY RUN (no changes — pass --apply to write)\n");

  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")
  ) as { entries: JournalEntry[] };

  // 1. Is the database actually at the state these migrations describe?
  const expected = tablesInSchema();
  const [present]: any = await conn.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"
  );
  const have = new Set(present.map((r: any) => r.t));
  const missing = expected.filter((t) => !have.has(t));

  console.log(`Tabel w schemacie: ${expected.length}, w bazie: ${have.size}`);
  if (missing.length > 0) {
    console.error(
      `\nBrakuje tabel: ${missing.join(", ")}\n` +
        "Migracje NIE są zastosowane — zapisanie ich jako wykonanych ukryłoby prawdziwą zmianę do wykonania.\n" +
        "Przerywam."
    );
    await conn.end();
    process.exitCode = 1;
    return;
  }
  console.log("Wszystkie tabele ze schematu istnieją — migracje faktycznie są zastosowane.\n");

  // 2. What does drizzle already know about?
  const [applied]: any = await conn.query("SELECT hash FROM __drizzle_migrations");
  const known = new Set(applied.map((r: any) => r.hash));
  console.log(`__drizzle_migrations: ${applied.length} wpisów, dziennik: ${journal.entries.length} migracji`);

  const toRecord = journal.entries
    .map((e) => ({ ...e, hash: migrationHash(e.tag) }))
    .filter((e) => !known.has(e.hash));

  if (toRecord.length === 0) {
    console.log("\nNic do zrobienia — dziennik i baza są zgodne.");
    await conn.end();
    return;
  }

  console.table(
    toRecord.map((e) => ({
      idx: e.idx,
      migracja: e.tag,
      hash: e.hash.slice(0, 12) + "…",
      data: new Date(e.when).toISOString().slice(0, 10),
    }))
  );

  if (!APPLY) {
    console.log(`\n${toRecord.length} migracji do odnotowania (dry run — nic nie zapisano)`);
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    for (const e of toRecord) {
      await conn.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [e.hash, e.when]);
    }
    await conn.commit();
    console.log(`\n${toRecord.length} migracji odnotowanych`);
  } catch (err) {
    await conn.rollback();
    console.error(`NIEUDANE, wycofano: ${String(err)}`);
    throw err;
  }

  const [after]: any = await conn.query(
    "SELECT COUNT(*) n, FROM_UNIXTIME(MAX(created_at)/1000) ostatnia FROM __drizzle_migrations"
  );
  console.table(after);

  await conn.end();
}

main();
