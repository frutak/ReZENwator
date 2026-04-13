import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { systemSettings } from "../../drizzle/schema";
import { ENV } from "../_core/env";

export class SettingRepository {
  static async getSystemSetting(key: string): Promise<string | null> {
    const db = await getDb();
    if (!db) return null;
    const result = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
    return result[0]?.value ?? null;
  }

  static async setSystemSetting(key: string, value: string): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.insert(systemSettings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } });
  }

  /**
   * Gets the admin email from system settings, falling back to a configured default.
   */
  static async getAdminEmail(): Promise<string> {
    const email = await this.getSystemSetting("ADMIN_EMAIL");
    return email || ENV.adminEmail;
  }
}
