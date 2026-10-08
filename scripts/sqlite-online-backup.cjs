// Create and verify an online SQLite backup while the application keeps serving.
const Database = require("better-sqlite3");
const fs = require("node:fs");
const sourcePath = process.env.SOURCE_DB_PATH || "/app/data/db/data.sqlite";
const backupPath = process.env.BACKUP_PATH;
if (!backupPath || (!backupPath.startsWith("/backup/") && process.env.ALLOW_TEST_BACKUP_PATH !== "1") || fs.existsSync(backupPath)) {
  console.error("BACKUP_PATH must be a new file under /backup");
  process.exit(1);
}
const source = new Database(sourcePath, { fileMustExist: true });
(async () => {
  try {
    await source.backup(backupPath);
  } finally {
    source.close();
  }
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    if (backup.pragma("quick_check", { simple: true }) !== "ok") throw new Error("backup quick_check failed");
  } finally {
    backup.close();
  }
  console.log(`backup_verified bytes=${fs.statSync(backupPath).size}`);
})().catch((error) => {
  console.error(`backup_failed: ${error.message}`);
  process.exitCode = 1;
});
