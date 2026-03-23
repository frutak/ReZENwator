import dotenv from "dotenv";
dotenv.config();
import { pollEmails } from "./server/workers/emailPoller";

async function test() {
  console.log("Starting email poll test...");
  console.log("DATABASE_URL present:", !!process.env.DATABASE_URL);
  console.log("GMAIL_APP_PASSWORD present:", !!process.env.GMAIL_APP_PASSWORD);
  
  try {
    const results = await pollEmails();
    console.log("Poll results:", JSON.stringify(results, null, 2));
  } catch (err) {
    console.error("Poll failed:", err);
  }
}

test().catch(console.error);
