import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from "node:crypto";
import { verifyPassword as verifyLegacyPassword } from "better-auth/crypto";

/**
 * Password hashing (M7-02, ASVS V11.4.2). scrypt with an OWASP Password Storage Cheat Sheet
 * parameter set: N=2^14, r=8, p=5. It needs 16 MiB per hash (gentle on a small server) and
 * took about 160 ms on the 2-core sandbox. Better Auth's built-in hash uses N=2^14, r=16, p=1,
 * which is below the cheat sheet's table, and compares with ===.
 *
 * Stored format: $scrypt$n=16384,r=8,p=5$<salt>$<key> (base64url). The settings live in the
 * hash, so they can be raised later: older hashes still verify and are upgraded at sign-in.
 * Hashes from before M7 ("<salt hex>:<key hex>") are checked with the library's function.
 */
export const PASSWORD_HASH_PARAMS = { N: 2 ** 14, r: 8, p: 5 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const PREFIX = "$scrypt$";
const CURRENT = `${PREFIX}n=${PASSWORD_HASH_PARAMS.N},r=${PASSWORD_HASH_PARAMS.r},p=${PASSWORD_HASH_PARAMS.p}$`;
// Upper bounds for settings read back from a stored hash, so a bad row can't exhaust memory.
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;

function derive(password: string, salt: Buffer, params: { N: number; r: number; p: number }) {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r };
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, PASSWORD_HASH_PARAMS);
  return `${CURRENT}${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function parse(hash: string) {
  const match = /^\$scrypt\$n=(\d+),r=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/.exec(hash);
  if (!match) return null;
  const [N, r, p] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const powerOfTwo = N > 1 && (N & (N - 1)) === 0;
  if (!powerOfTwo || N > MAX_N || r < 1 || r > MAX_R || p < 1 || p > MAX_P) return null;
  const key = Buffer.from(match[5]!, "base64url");
  if (key.length !== KEY_LENGTH) return null;
  return { N, r, p, salt: Buffer.from(match[4]!, "base64url"), key };
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (!hash.startsWith(PREFIX)) return verifyLegacyPassword({ hash, password });
  const parsed = parse(hash);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed);
  return timingSafeEqual(key, parsed.key);
}

/** True when a stored hash uses older settings (or the pre-M7 format) and should be redone. */
export function needsRehash(hash: string): boolean {
  return !hash.startsWith(CURRENT);
}
