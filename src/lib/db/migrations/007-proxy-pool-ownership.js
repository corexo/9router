const migration = {
  version: 7,
  name: "proxy-pool-ownership",
  up(db) {
    const columns = new Set(db.all("PRAGMA table_info(proxyPools)").map((column) => column.name));
    if (!columns.has("ownerUsername")) db.exec("ALTER TABLE proxyPools ADD COLUMN ownerUsername TEXT");
    db.exec("UPDATE proxyPools SET ownerUsername = 'Oguz' WHERE ownerUsername IS NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_proxyPools_ownerUsername ON proxyPools(ownerUsername)");
  },
};

export default migration;
