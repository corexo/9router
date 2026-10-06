// Roles removed: both dashboard users are equal owners of isolated setups.
// 1. Seed each user's prefs with the current global user-scoped settings so
//    nobody loses their pool / token-saver config when scoping switches from
//    role-based to per-user. Global values stay in place as fallback for
//    ownerless (local / legacy-key) requests.
// 2. Flip every user to 'admin' — the role column remains for the session
//    claim schema but no longer gates anything.
const USER_SCOPED_KEYS = [
  "jevPoolModels", "jevFreePoolModels", "jevTierPreference", "jevTierDistributionEnabled", "jevModelTiers", "jevExcludeLocalModels", "jev1mMinContext",
  "rtkEnabled", "headroomEnabled", "headroomUrl", "headroomCompressUserMessages", "headroomTimeoutMs",
  "cavemanEnabled", "cavemanLevel", "ponytailEnabled", "ponytailLevel",
  "pxpipeEnabled", "pxpipeMinChars", "pxpipeTimeoutMs",
];

const migration = {
  version: 5,
  name: "roles-to-equal-users",
  up(db) {
    let settings = {};
    try {
      const row = db.get("SELECT data FROM settings LIMIT 1");
      settings = row ? JSON.parse(row.data || "{}") : {};
    } catch {
      settings = {};
    }

    const now = new Date().toISOString();
    const users = db.all("SELECT username FROM users");
    for (const user of users) {
      const row = db.get("SELECT data FROM userPrefs WHERE username = ?", [user.username]);
      const prefs = row ? JSON.parse(row.data || "{}") : {};
      let changed = false;
      for (const key of USER_SCOPED_KEYS) {
        if (settings[key] !== undefined && prefs[key] === undefined) {
          prefs[key] = settings[key];
          changed = true;
        }
      }
      if (changed) {
        db.run(
          "INSERT INTO userPrefs(username, data, updatedAt) VALUES(?, ?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt",
          [user.username, JSON.stringify(prefs), now]
        );
      }
    }

    db.run("UPDATE users SET role = 'admin' WHERE role != 'admin'");
  },
};

export default migration;
