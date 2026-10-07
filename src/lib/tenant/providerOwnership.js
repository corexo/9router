import { createProviderConnection } from "@/models";
import { hasUsers } from "@/lib/localDb";
import { getRequestUsername } from "@/lib/auth/requestUser";

export async function createOwnedProviderConnection(data) {
  const ownerUsername = await getRequestUsername();
  if (await hasUsers() && !ownerUsername) throw new Error("Authenticated user required to create a provider account");
  return createProviderConnection({ ...data, ownerUsername: ownerUsername || null, isShared: false });
}
