import {
  accessKeyStorageKey,
  storageKeysToRemoveAfterAuthFailure
} from "./panel/connection";

export type CredentialStorageAdapter = {
  get: (key: string) => Promise<Record<string, unknown>>;
  remove: (keys: string[]) => Promise<void>;
};

export async function clearCredentialsIfCurrent(
  storage: CredentialStorageAdapter,
  attemptedKey: string
): Promise<boolean> {
  const stored = await storage.get(accessKeyStorageKey);
  const currentKey = String(stored[accessKeyStorageKey] ?? "").trim();
  if (!currentKey || currentKey !== attemptedKey) return false;
  await storage.remove(storageKeysToRemoveAfterAuthFailure());
  return true;
}
