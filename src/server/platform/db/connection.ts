/**
 * Connection settings for node-postgres taken from a connection string.
 *
 * node-postgres reads `sslmode` from the string (and with `verify-full` checks the server's
 * certificate and host name), but it ignores `channel_binding`: channel binding (SCRAM-SHA-256-PLUS,
 * which ties the password exchange to this TLS connection) needs its own `enableChannelBinding`
 * option. Production addresses carry `channel_binding=require` (infra/bootstrap/neon_url.py), so
 * this turns the option on for them.
 *
 * With the option on, node-postgres uses channel binding whenever the server offers it (Neon does),
 * and otherwise tells the server it supports it, so a server that strips the offer is caught by
 * SCRAM itself. Unlike libpq it can't refuse a server that never offers it; `verify-full` already
 * refuses any server without the right certificate.
 */
export interface PgConnectionConfig {
  connectionString: string;
  enableChannelBinding?: true;
}

export function wantsChannelBinding(connectionString: string): boolean {
  try {
    return new URL(connectionString).searchParams.get("channel_binding") === "require";
  } catch {
    return false;
  }
}

export function pgConnectionConfig(connectionString: string): PgConnectionConfig {
  return wantsChannelBinding(connectionString)
    ? { connectionString, enableChannelBinding: true }
    : { connectionString };
}
