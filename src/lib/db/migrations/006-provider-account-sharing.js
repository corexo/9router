const migration = {
  version: 6,
  name: "provider-account-sharing",
  up(db) {
    const columns = new Set(db.all("PRAGMA table_info(providerConnections)").map((column) => column.name));
    if (!columns.has("isShared")) db.exec("ALTER TABLE providerConnections ADD COLUMN isShared INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE INDEX IF NOT EXISTS idx_providerConnections_owner_shared ON providerConnections(ownerUsername, isShared)");
  },
};

export default migration;
