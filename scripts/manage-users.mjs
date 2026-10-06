#!/usr/bin/env node
// Run from the repository root with DATA_DIR pointing to the desired installation.
import { createUser, getUserByUsername, listUsers, setUserActive, deleteUser, setPasswordHash } from "../src/lib/db/repos/usersRepo.js";
import bcrypt from "bcryptjs";

const [action, name, password, role] = process.argv.slice(2);
const usage = "Usage: node scripts/manage-users.mjs add <name> <pw> <admin|moderator> | list | deactivate <name> | activate <name> | delete <name> | set-password <name> <pw>";

try {
  if (action === "add" && name && password && ["admin", "moderator"].includes(role)) {
    const user = await createUser(name, password, role);
    console.log(`Created ${user.username} (${user.role})`);
  } else if (action === "list" && !name) {
    console.table((await listUsers()).map(({ username, role, isActive }) => ({ username, role, active: !!isActive })));
  } else if (["activate", "deactivate", "delete", "set-password"].includes(action) && name &&
    (action !== "set-password" || password) && (action === "set-password" || !password)) {
    const user = await getUserByUsername(name);
    if (!user) throw new Error("User not found");
    if (action === "delete") await deleteUser(user.id);
    else if (action === "set-password") await setPasswordHash(user.id, await bcrypt.hash(password, 10));
    else await setUserActive(user.id, action === "activate");
    console.log(`${action}: ${user.username}`);
  } else {
    console.error(usage);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
