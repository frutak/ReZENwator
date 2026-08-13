/**
 * Runs the nightly database backup on demand.
 *
 * The same function the daily maintenance calls — dump, prune to ten local
 * copies, and, when BACKUP_REMOTE is set, copy off the machine. Useful before a
 * risky migration and as the only honest way to check that the off-site copy
 * still works, short of waiting for 08:00.
 *
 * Usage: npx tsx scripts/run_backup_now.ts
 */
import "dotenv/config";
import { performDatabaseBackup } from "../server/workers/dailyAlerts";

const ok = await performDatabaseBackup();
console.log(ok ? "\nBackup zakończony powodzeniem" : "\nBackup NIE powiódł się — sprawdź log powyżej");
process.exit(ok ? 0 : 1);
