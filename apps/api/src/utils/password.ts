import argon2 from "argon2";

/**
 * Password hashing with Argon2id (the `argon2` package, OWASP-recommended
 * parameters). Plaintext passwords are never stored or logged.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// A real Argon2id hash of a random throwaway password, generated once at process
// start. Login runs a verify against it when the email is unknown so the response
// time does not reveal whether an account exists.
let dummyHashPromise: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(`dummy-${Math.random().toString(36)}-${Date.now()}`);
  return dummyHashPromise;
}
