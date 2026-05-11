# Workspace Rules

1. **Safety First**: Never log, print, or commit secrets, API keys, or sensitive credentials.
2. **Context Efficiency**: Minimize turns and context usage while maintaining high quality.
3. **Source Control**: Do not stage or commit changes unless specifically requested.
4. **File Integrity**: **NEVER delete files or purge history without explicit confirmation from the user.** This applies to all file operations, including Git history rewrites that might affect the working directory.
5. **Testing**: Always add or update tests for any logic changes.
6. **Script Termination**: When writing one-off scripts or tests (e.g., using `tsx`), always ensure that database connections are closed to prevent the process from hanging. In this project, you must import `pool` from `./server/db` and call `await pool.end()` at the end of your script, or use `process.exit(0)` as a fallback. For example:
   ```typescript
   import { getDb, pool } from "./server/db";
   // ... code ...
   if (pool) await pool.end();
   ```

