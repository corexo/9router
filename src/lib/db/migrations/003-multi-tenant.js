const migration = {
  version: 3,
  name: "multi-tenant",
  up(db) {
    for (const table of ["providerConnections", "providerNodes", "combos"]) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ownerUsername TEXT`);
      db.exec(`UPDATE ${table} SET ownerUsername = 'Oguz' WHERE ownerUsername IS NULL`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS userPrefs (username TEXT PRIMARY KEY, data TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
  },
};
export default migration;
