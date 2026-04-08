
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Database not available");
    process.exit(1);
  }

  const usersToCreate = [
    { 
      username: "Ala", 
      password: process.env.USER_ALA_PASSWORD || "HacjendaKiekrz12345", 
      propertyAccess: "Hacjenda", 
      viewAccess: "cleaning" 
    },
    { 
      username: "Marcin", 
      password: process.env.USER_MARCIN_PASSWORD || "HacjendaKiekrz12345", 
      propertyAccess: "Hacjenda", 
      viewAccess: "cleaning" 
    },
    { 
      username: "Iwona", 
      password: process.env.USER_IWONA_PASSWORD || "Sadoles1234567", 
      propertyAccess: "Sadoles", 
      viewAccess: "cleaning" 
    },
  ];

  for (const userData of usersToCreate) {
    // Check if user exists
    const existing = await db.select().from(users).where(eq(users.username, userData.username)).limit(1);
    
    const payload = {
      username: userData.username,
      passwordHash: hashPassword(userData.password),
      propertyAccess: userData.propertyAccess,
      viewAccess: userData.viewAccess,
      role: 'user' as const,
    };

    if (existing.length > 0) {
      console.log(`Updating user ${userData.username}...`);
      await db.update(users).set(payload).where(eq(users.username, userData.username));
    } else {
      console.log(`Creating user ${userData.username}...`);
      await db.insert(users).values(payload);
    }
  }

  console.log("All users created/updated successfully.");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
