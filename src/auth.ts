import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { ApiClient, ApiRole } from "./config.js";

export interface AuthContext {
  tenantId: string;
  roles: ReadonlySet<ApiRole>;
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

function keysMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function authenticate(request: FastifyRequest, clients: readonly ApiClient[]): AuthContext {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new HttpError(401, "UNAUTHORIZED", "Липсва Bearer API ключ.");
  }

  const token = match[1];
  const client = clients.find((candidate) => keysMatch(candidate.key, token));
  if (!client) {
    throw new HttpError(401, "UNAUTHORIZED", "Невалиден API ключ.");
  }

  return { tenantId: client.tenantId, roles: new Set(client.roles) };
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

export async function registerAuthentication(app: FastifyInstance, clients: readonly ApiClient[]): Promise<void> {
  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/v1/")) {
      request.auth = authenticate(request, clients);
    }
  });
}
