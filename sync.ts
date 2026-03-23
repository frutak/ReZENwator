import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './drizzle/schema'; // Path to your schema

async function sync() {
  // 1. Connect to TiDB (Source)
  const tidbConn = await mysql.createConnection(`mysql://3XBZvXM4G6JtM76.root:2h0fDs6mvxMD822pfNsZ@gateway04.us-east-1.prod.aws.tidbcloud.com:4000/aAcY4FV4snu2KkCthGFbUA?ssl={"rejectUnauthorized":true}`);
  const tidbDb = drizzle(tidbConn, { schema , mode: 'default'});

  // 2. Connect to Local (Destination)
  const localConn = await mysql.createConnection("mysql://rental:kondon@localhost:3306/rental_manager");
  const localDb = drizzle(localConn, { schema, mode: 'default' });

  console.log("Pulling data from TiDB...");
  
// Get all table keys from your schema file
  const tables = Object.keys(schema).filter((key) => 
    // This filter ensures we only pick objects that look like Drizzle tables
    typeof (schema as any)[key] === 'object' && 'getSQL' in (schema as any)[key]
  );

  console.log(`Found ${tables.length} tables to sync.`);

  for (const tableName of tables) {
    const table = (schema as any)[tableName];
    
    console.log(`\n--- Syncing table: ${tableName} ---`);

    // 1. Pull from TiDB
    const data = await tidbDb.select().from(table);
    
    if (data.length === 0) {
      console.log(`Table ${tableName} is empty in TiDB. Skipping...`);
      continue;
    }

    console.log(`Found ${data.length} rows in TiDB. Transferring...`);

    // 2. Clear local table first (Optional, prevents duplicate errors)
    // await localDb.delete(table);

    // 3. Insert into Local
    await localDb.insert(table).values(data);
    
    console.log(`Successfully synced ${tableName}!`);
  }

  console.log("\nFull database sync complete!");
  process.exit(0);
}
  

sync();
