import { createCipheriv, createHmac, randomBytes } from "node:crypto";

import { Pool } from "pg";

import type { ConversationExchange, ConversationStore } from "./domain.js";

export class InMemoryConversationStore implements ConversationStore {
  readonly exchanges: ConversationExchange[] = [];

  async saveExchange(exchange: ConversationExchange): Promise<void> {
    this.exchanges.push(exchange);
  }

  async close(): Promise<void> {}
}

interface EncryptedValue {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

function encrypt(value: string, key: Buffer): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function pseudonymize(value: string, key: Buffer): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export class PostgresConversationStore implements ConversationStore {
  constructor(
    private readonly pool: Pool,
    private readonly encryptionKey: Buffer,
    private readonly retentionDays: number,
  ) {}

  async saveExchange(exchange: ConversationExchange): Promise<void> {
    const client = await this.pool.connect();
    const userMessage = encrypt(exchange.userMessage, this.encryptionKey);
    const assistantMessage = encrypt(exchange.assistantMessage, this.encryptionKey);
    const retentionDays = exchange.retentionDays || this.retentionDays;
    const expiresAt = new Date(exchange.createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1_000);
    const externalOrganizationHash = exchange.externalOrganizationId
      ? pseudonymize(exchange.externalOrganizationId, this.encryptionKey)
      : null;

    try {
      await client.query("BEGIN");
      await client.query(
         `INSERT INTO conversations (
           id, tenant_id, external_user_hash, external_organization_hash,
           assistant_profile, channel, created_at, updated_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
         ON CONFLICT (id) DO UPDATE
           SET updated_at = EXCLUDED.updated_at,
               expires_at = EXCLUDED.expires_at
         WHERE conversations.tenant_id = EXCLUDED.tenant_id
           AND conversations.assistant_profile = EXCLUDED.assistant_profile
           AND conversations.external_organization_hash IS NOT DISTINCT FROM EXCLUDED.external_organization_hash`,
        [
          exchange.conversationId,
          exchange.tenantId,
          pseudonymize(exchange.externalUserId, this.encryptionKey),
          externalOrganizationHash,
          exchange.assistantProfile,
          exchange.channel,
          exchange.createdAt,
          expiresAt,
        ],
      );

      const ownership = await client.query<{
        tenant_id: string;
        assistant_profile: string;
        external_organization_hash: string | null;
      }>(
        "SELECT tenant_id, assistant_profile, external_organization_hash FROM conversations WHERE id = $1",
        [exchange.conversationId],
      );
      const owner = ownership.rows[0];
      if (
        owner?.tenant_id !== exchange.tenantId ||
        owner.assistant_profile !== exchange.assistantProfile ||
        owner.external_organization_hash !== externalOrganizationHash
      ) {
        throw new Error("Conversation scope mismatch");
      }

      await client.query(
        `INSERT INTO messages (
           conversation_id, role, content_ciphertext, content_iv, content_auth_tag,
           metadata, created_at
         ) VALUES
           ($1, 'user', $2, $3, $4, '{}'::jsonb, $8),
           ($1, 'assistant', $5, $6, $7, $9::jsonb, $8)`,
        [
          exchange.conversationId,
          userMessage.ciphertext,
          userMessage.iv,
          userMessage.authTag,
          assistantMessage.ciphertext,
          assistantMessage.iv,
          assistantMessage.authTag,
          exchange.createdAt,
          JSON.stringify({
            status: exchange.status,
            requestId: exchange.requestId,
            assistantProfile: exchange.assistantProfile,
          }),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPostgresPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
