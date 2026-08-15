import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { Pool } from "pg";

import type { ApiClient, ApiRole } from "./config.js";
import type { AssistantProfile } from "./profiles.js";

const scrypt = promisify(scryptCallback);

export interface ApiClientIdentity {
  id?: string;
  tenantId: string;
  roles: ApiRole[];
  allowedProfiles: AssistantProfile[];
  defaultProfile: AssistantProfile;
}

export interface ApiClientAuthenticator {
  authenticateApiKey(key: string): Promise<ApiClientIdentity | null>;
}

export interface ApiClientView extends ApiClientIdentity {
  id: string;
  name: string;
  keyPrefix: string;
  active: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface AdminUserView {
  id: string;
  email: string;
  isAdmin: boolean;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AdminSession {
  user: AdminUserView;
  csrfToken: string;
}

export interface AccessAdminRepository extends ApiClientAuthenticator {
  listApiClients(): Promise<ApiClientView[]>;
  createApiClient(input: {
    name: string;
    tenantId: string;
    roles: ApiRole[];
    allowedProfiles: AssistantProfile[];
    defaultProfile: AssistantProfile;
  }): Promise<{ client: ApiClientView; key: string }>;
  setApiClientActive(id: string, active: boolean): Promise<boolean>;
  importApiClient(name: string, client: ApiClient): Promise<void>;
  listUsers(): Promise<AdminUserView[]>;
  createUser(input: { email: string; password: string; isAdmin: boolean }): Promise<AdminUserView>;
  setUserAccess(id: string, input: { active: boolean; isAdmin: boolean }): Promise<boolean>;
  createSession(email: string, password: string): Promise<{ token: string; session: AdminSession } | null>;
  findSession(token: string): Promise<AdminSession | null>;
  deleteSession(token: string): Promise<void>;
  close(): Promise<void>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("Password must be at least 12 characters");
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltText, hashText] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltText, "base64url"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class StaticApiClientAuthenticator implements ApiClientAuthenticator {
  constructor(private readonly clients: readonly ApiClient[]) {}

  async authenticateApiKey(key: string): Promise<ApiClientIdentity | null> {
    const client = this.clients.find((candidate) => safeEqual(candidate.key, key));
    return client
      ? {
          tenantId: client.tenantId,
          roles: client.roles,
          allowedProfiles: client.allowedProfiles,
          defaultProfile: client.defaultProfile,
        }
      : null;
  }
}

export class FallbackApiClientAuthenticator implements ApiClientAuthenticator {
  constructor(
    private readonly primary: ApiClientAuthenticator,
    private readonly fallback: ApiClientAuthenticator,
  ) {}

  async authenticateApiKey(key: string): Promise<ApiClientIdentity | null> {
    return (await this.primary.authenticateApiKey(key)) ?? this.fallback.authenticateApiKey(key);
  }
}

interface ApiClientRow {
  id: string;
  name: string;
  tenant_id: string;
  key_prefix: string;
  roles: ApiRole[];
  allowed_profiles: AssistantProfile[];
  default_profile: AssistantProfile;
  active: boolean;
  last_used_at: Date | null;
  created_at: Date;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  is_admin: boolean;
  active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

function mapClient(row: ApiClientRow): ApiClientView {
  return {
    id: row.id,
    name: row.name,
    tenantId: row.tenant_id,
    keyPrefix: row.key_prefix,
    roles: row.roles,
    allowedProfiles: row.allowed_profiles,
    defaultProfile: row.default_profile,
    active: row.active,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

function mapUser(row: UserRow): AdminUserView {
  return {
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin,
    active: row.active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export class PostgresAccessRepository implements AccessAdminRepository {
  constructor(private readonly pool: Pool) {}

  async authenticateApiKey(key: string): Promise<ApiClientIdentity | null> {
    const result = await this.pool.query<ApiClientRow>(
      `UPDATE api_clients SET last_used_at = now(), updated_at = now()
       WHERE key_hash = $1 AND active = true
       RETURNING *`,
      [sha256(key)],
    );
    const row = result.rows[0];
    return row ? mapClient(row) : null;
  }

  async listApiClients(): Promise<ApiClientView[]> {
    const result = await this.pool.query<ApiClientRow>("SELECT * FROM api_clients ORDER BY name, created_at");
    return result.rows.map(mapClient);
  }

  async createApiClient(input: {
    name: string;
    tenantId: string;
    roles: ApiRole[];
    allowedProfiles: AssistantProfile[];
    defaultProfile: AssistantProfile;
  }): Promise<{ client: ApiClientView; key: string }> {
    const key = `cb_${randomBytes(32).toString("base64url")}`;
    const result = await this.pool.query<ApiClientRow>(
      `INSERT INTO api_clients
         (id, name, tenant_id, key_hash, key_prefix, roles, allowed_profiles, default_profile, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, now(), now()) RETURNING *`,
      [
        randomUUID(),
        input.name,
        input.tenantId,
        sha256(key),
        key.slice(0, 10),
        input.roles,
        input.allowedProfiles,
        input.defaultProfile,
      ],
    );
    return { client: mapClient(result.rows[0]!), key };
  }

  async setApiClientActive(id: string, active: boolean): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE api_clients SET active = $2, updated_at = now() WHERE id = $1",
      [id, active],
    );
    return result.rowCount === 1;
  }

  async importApiClient(name: string, client: ApiClient): Promise<void> {
    await this.pool.query(
      `INSERT INTO api_clients
         (id, name, tenant_id, key_hash, key_prefix, roles, allowed_profiles, default_profile, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, now(), now())
       ON CONFLICT (key_hash) DO UPDATE SET
         name = EXCLUDED.name, tenant_id = EXCLUDED.tenant_id, roles = EXCLUDED.roles,
         allowed_profiles = EXCLUDED.allowed_profiles, default_profile = EXCLUDED.default_profile,
         active = true, updated_at = now()`,
      [
        randomUUID(),
        name,
        client.tenantId,
        sha256(client.key),
        client.key.slice(0, 10),
        client.roles,
        client.allowedProfiles,
        client.defaultProfile,
      ],
    );
  }

  async listUsers(): Promise<AdminUserView[]> {
    const result = await this.pool.query<UserRow>("SELECT * FROM users ORDER BY email");
    return result.rows.map(mapUser);
  }

  async createUser(input: { email: string; password: string; isAdmin: boolean }): Promise<AdminUserView> {
    const result = await this.pool.query<UserRow>(
      `INSERT INTO users (id, email, password_hash, is_admin, active, created_at, updated_at)
       VALUES ($1, lower($2), $3, $4, true, now(), now()) RETURNING *`,
      [randomUUID(), input.email.trim(), await hashPassword(input.password), input.isAdmin],
    );
    return mapUser(result.rows[0]!);
  }

  async setUserAccess(id: string, input: { active: boolean; isAdmin: boolean }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('chatbot_admin_access'))");
      const target = await client.query<UserRow>("SELECT * FROM users WHERE id = $1 FOR UPDATE", [id]);
      const row = target.rows[0];
      if (!row) { await client.query("ROLLBACK"); return false; }
      if (row.active && row.is_admin && (!input.active || !input.isAdmin)) {
        const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE active = true AND is_admin = true");
        if (Number(count.rows[0]?.count ?? 0) <= 1) throw new Error("Последният активен администратор не може да бъде спрян.");
      }
      await client.query("UPDATE users SET active = $2, is_admin = $3, updated_at = now() WHERE id = $1", [id, input.active, input.isAdmin]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(email: string, password: string): Promise<{ token: string; session: AdminSession } | null> {
    const result = await this.pool.query<UserRow>(
      "SELECT * FROM users WHERE email = lower($1) AND active = true AND is_admin = true",
      [email.trim()],
    );
    const row = result.rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) return null;
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(24).toString("base64url");
    await this.pool.query("DELETE FROM admin_sessions WHERE expires_at <= now()");
    await this.pool.query(
      `INSERT INTO admin_sessions (token_hash, user_id, csrf_token, expires_at, created_at)
       VALUES ($1, $2, $3, now() + interval '12 hours', now())`,
      [sha256(token), row.id, csrfToken],
    );
    await this.pool.query("UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1", [row.id]);
    return { token, session: { user: mapUser(row), csrfToken } };
  }

  async findSession(token: string): Promise<AdminSession | null> {
    const result = await this.pool.query<UserRow & { csrf_token: string }>(
      `SELECT u.*, s.csrf_token FROM admin_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true AND u.is_admin = true`,
      [sha256(token)],
    );
    const row = result.rows[0];
    return row ? { user: mapUser(row), csrfToken: row.csrf_token } : null;
  }

  async deleteSession(token: string): Promise<void> {
    await this.pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [sha256(token)]);
  }

  async close(): Promise<void> {}
}
