const migration = {
  version: 2,
  name: "users",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'moderator' CHECK(role IN ('admin', 'moderator')),
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    )`);
    // Ownership of API keys by dashboard user (nullable = unassigned/legacy).
    db.exec(`ALTER TABLE apiKeys ADD COLUMN ownerUsername TEXT`);
  },
};

export default migration;
