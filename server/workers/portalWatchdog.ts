import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";
import { sendAlertEmail } from "../_core/email";

const execAsync = promisify(exec);

interface ServiceConfig {
  name: string;
  url: string;
  buildCmd: string;
  id: "admin" | "portal";
}

const SERVICES: ServiceConfig[] = [
  {
    name: "Admin Portal",
    url: "http://localhost:3000/",
    buildCmd: "npm run build",
    id: "admin",
  },
  {
    name: "Guest Portal",
    url: "http://localhost:3001/",
    buildCmd: "npm run build:portal",
    id: "portal",
  },
];

export async function checkPortalHealth() {
  console.log("[Watchdog] Starting health check for all services...");
  
  for (const service of SERVICES) {
    await checkServiceHealth(service);
  }
}

async function checkServiceHealth(service: ServiceConfig) {
  console.log(`[Watchdog] Checking ${service.name} health at ${service.url}...`);

  try {
    const response = await axios.get(service.url, { timeout: 10000 });
    
    const isHtml = response.headers["content-type"]?.includes("text/html");
    const containsRoot = typeof response.data === "string" && response.data.includes('id="root"');
    
    if (response.status === 200 && isHtml && containsRoot) {
      console.log(`[Watchdog] ${service.name} is healthy.`);
      return;
    }

    console.warn(`[Watchdog] ${service.name} returned unexpected response. Status: ${response.status}, IsHTML: ${isHtml}, ContainsRoot: ${containsRoot}`);
    await attemptRecovery(service);
  } catch (err) {
    console.error(`[Watchdog] ${service.name} is unreachable: ${err instanceof Error ? err.message : String(err)}`);
    await attemptRecovery(service);
  }
}

async function attemptRecovery(service: ServiceConfig) {
  console.log(`[Watchdog] Attempting recovery for ${service.name} by running: ${service.buildCmd}...`);
  
  try {
    const { stdout, stderr } = await execAsync(service.buildCmd);
    console.log(`[Watchdog] ${service.name} build stdout:`, stdout);
    if (stderr) console.warn(`[Watchdog] ${service.name} build stderr:`, stderr);

    // Verify again after build
    console.log(`[Watchdog] Verifying ${service.name} health after rebuild...`);
    const response = await axios.get(service.url, { timeout: 10000 });
    const containsRoot = typeof response.data === "string" && response.data.includes('id="root"');

    if (response.status === 200 && containsRoot) {
      console.log(`[Watchdog] ${service.name} recovered successfully after rebuild.`);
      await sendAlertEmail(
        `[Watchdog] ${service.name} Recovered`,
        `The ${service.name} was detected as down or unhealthy. The watchdog process automatically ran "${service.buildCmd}" and it is now back online.`
      );
    } else {
      throw new Error(`${service.name} still unhealthy after rebuild.`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Watchdog] ${service.name} recovery failed: ${errorMsg}`);
    
    await sendAlertEmail(
      `[Watchdog] ${service.name.toUpperCase()} CRITICAL FAILURE`,
      `The ${service.name} is DOWN and automatic recovery failed.\n\nError: ${errorMsg}\n\nPlease check the server immediately.`
    );
  }
}
