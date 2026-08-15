import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ApiClientAuthenticator } from "./access.js";
import type { ApiRole } from "./config.js";
import type { AssistantProfile } from "./profiles.js";

export interface AuthContext {
  tenantId: string;
  roles: ReadonlySet<ApiRole>;
  allowedProfiles: ReadonlySet<AssistantProfile>;
  defaultProfile: AssistantProfile;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function authenticate(request: FastifyRequest, authenticator: ApiClientAuthenticator): Promise<AuthContext> {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new HttpError(401, "UNAUTHORIZED", "Липсва Bearer API ключ.");
  }

  const client = await authenticator.authenticateApiKey(match[1]);
  if (!client) {
    throw new HttpError(401, "UNAUTHORIZED", "Невалиден API ключ.");
  }

  return {
    tenantId: client.tenantId,
    roles: new Set(client.roles),
    allowedProfiles: new Set(client.allowedProfiles),
    defaultProfile: client.defaultProfile,
  };
}

export function requireRole(request: FastifyRequest, role: ApiRole): AuthContext {
  if (!request.auth) {
    throw new HttpError(401, "UNAUTHORIZED", "Неудостоверена заявка.");
  }
  if (!request.auth.roles.has(role)) {
    throw new HttpError(403, "FORBIDDEN", "Клиентът няма необходимото право.");
  }
  return request.auth;
}

export async function registerAuthentication(app: FastifyInstance, authenticator: ApiClientAuthenticator): Promise<void> {
  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/v1/")) {
      request.auth = await authenticate(request, authenticator);
    }
  });
}
