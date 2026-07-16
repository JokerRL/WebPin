import { timingSafeEqual } from "node:crypto";

export class AccessKeyError extends Error {
  readonly code = "invalid_access_key";
  readonly status = 401;

  constructor() {
    super("Enter the current bridge access key in the extension.");
  }
}

export function assertAccessKey(submittedKey: string | undefined, expectedKey: string): void {
  if (!submittedKey) throw new AccessKeyError();
  const submitted = Buffer.from(submittedKey);
  const expected = Buffer.from(expectedKey);
  if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) {
    throw new AccessKeyError();
  }
}
