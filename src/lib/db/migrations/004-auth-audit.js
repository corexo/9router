import bcrypt from "bcryptjs";

const migration = {
  version: 4,
  name: "auth-audit-and-password-rotation",
  up(db) {
    db.exec("ALTER TABLE users ADD COLUMN mustChangePassword INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE apiKeys ADD COLUMN lastUsedIp TEXT");
    db.exec("ALTER TABLE apiKeys ADD COLUMN lastUsedAt TEXT");
    db.exec(`CREATE TABLE IF NOT EXISTS authLoginAudit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      sourceIp TEXT NOT NULL,
      success INTEGER NOT NULL,
      userAgent TEXT,
      createdAt TEXT NOT NULL
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_authLoginAudit_createdAt ON authLoginAudit(createdAt)");

    const users = db.all("SELECT id, passwordHash FROM users");
    for (const user of users) {
      if (bcrypt.compareSync("123456", user.passwordHash)) {
        db.run("UPDATE users SET mustChangePassword = 1 WHERE id = ?", [user.id]);
      }
    }
  },
};

export default migration;
