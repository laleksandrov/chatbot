import { randomUUID } from "node:crypto";

import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError, z } from "zod";

import { HttpError, registerAuthentication, requireRole } from "./auth.js";
import { StaticApiClientAuthenticator, type AccessAdminRepository, type ApiClientAuthenticator } from "./access.js";
import { registerAdminRoutes } from "./admin.js";
import type { AppConfig } from "./config.js";
import {
  ChatProviderUnavailableError,
  type ChatProvider,
  type ConversationStore,
  type DocumentProcessor,
  type DocumentRepository,
  type RawDocumentStorage,
} from "./domain.js";
import { DocumentIngestionService, documentMetadataSchema } from "./documents.js";
import { landingPageHtml } from "./landing.js";
import { assistantProfiles, profilePolicy } from "./profiles.js";
import type { ChatQuotaStore } from "./quotas.js";

const registrationProgressSchema = z.object({
  currentStep: z.number().int().min(1).max(20),
  completedSteps: z.array(z.number().int().min(1).max(20)).max(20),
  commercialRegister: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  companyCopy: z
    .object({
      has_source_company: z.boolean().optional(),
      source_company_uic: z.string().regex(/^(?:\d{9}|\d{13})$/).nullable().optional(),
    })
    .optional(),
  copiedCompanyDetails: z.record(z.string(), z.string().max(5_000)).optional(),
  activityDescription: z.string().max(5_000).nullable().optional(),
});

const chatRequestSchema = z.object({
  tenantId: z.string().min(1).optional(),
  assistantProfile: z.enum(assistantProfiles).optional(),
  channel: z.string().min(1).max(50),
  externalUserId: z.string().min(1).max(200),
  externalOrganizationId: z.string().min(1).max(200).optional(),
  conversationId: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(20_000),
  context: z
    .object({
      jurisdiction: z.string().min(2).max(20).optional(),
      asOf: z.iso.date().optional(),
      registrationProgress: registrationProgressSchema.optional(),
    })
    .optional(),
});

const documentParamsSchema = z.object({ id: z.uuid() });

export interface AppDependencies {
  config: AppConfig;
  chatProvider: ChatProvider;
  conversationStore: ConversationStore;
  chatQuotaStore: ChatQuotaStore;
  documentRepository: DocumentRepository;
  rawDocumentStorage: RawDocumentStorage;
  documentProcessor: DocumentProcessor;
  readinessCheck?: () => Promise<void>;
  apiClientAuthenticator?: ApiClientAuthenticator;
  adminRepository?: AccessAdminRepository;
}

export async function createApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config } = dependencies;
  const app = Fastify({
    trustProxy: config.trustProxy,
    logger: config.nodeEnv === "test" ? false : { level: config.logLevel },
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Bulgarian Business Chatbot API",
        version: "0.1.0",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 10,
      fileSize: config.maxDocumentBytes,
    },
  });
  await registerAuthentication(
    app,
    dependencies.apiClientAuthenticator ?? new StaticApiClientAuthenticator(config.apiClients),
  );
  if (dependencies.adminRepository) {
    await registerAdminRoutes(app, dependencies.adminRepository, config.nodeEnv === "production");
  }

  const ingestion = new DocumentIngestionService(
    dependencies.rawDocumentStorage,
    dependencies.documentRepository,
    dependencies.documentProcessor,
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id },
      });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Невалидна заявка.",
          requestId: request.id,
          details: error.issues,
        },
      });
    }
    if (error instanceof ChatProviderUnavailableError) {
      request.log.error({ err: error, requestId: request.id }, "Chat provider unavailable");
      return reply.status(503).send({
        error: {
          code: "AI_PROVIDER_UNAVAILABLE",
          message: "AI услугата временно не е достъпна.",
          requestId: request.id,
        },
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "FST_REQ_FILE_TOO_LARGE"
    ) {
      return reply.status(413).send({
        error: {
          code: "CONTENT_TOO_LARGE",
          message: "Документът надвишава разрешения размер.",
          requestId: request.id,
        },
      });
    }

    request.log.error({ err: error, requestId: request.id }, "Unhandled request error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Възникна неочаквана грешка.",
        requestId: request.id,
      },
    });
  });

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(landingPageHtml));
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await dependencies.readinessCheck?.();
      return reply.send({ status: "ready" });
    } catch (error) {
      app.log.error({ err: error }, "Readiness check failed");
      return reply.status(503).send({ status: "not_ready" });
    }
  });

  app.post("/v1/chat", async (request, reply) => {
    const auth = requireRole(request, "chat");
    const body = chatRequestSchema.parse(request.body);
    if (body.tenantId && body.tenantId !== auth.tenantId) {
      throw new HttpError(403, "TENANT_MISMATCH", "tenantId не съответства на API клиента.");
    }

    const assistantProfile = body.assistantProfile ?? auth.defaultProfile;
    if (!auth.allowedProfiles.has(assistantProfile)) {
      throw new HttpError(403, "ASSISTANT_PROFILE_FORBIDDEN", "API клиентът няма право да използва този режим.");
    }
    const policy = profilePolicy(assistantProfile);
    if (body.message.length > policy.maxMessageCharacters) {
      throw new HttpError(
        413,
        "MESSAGE_TOO_LONG_FOR_PROFILE",
        `Съобщението надвишава лимита от ${policy.maxMessageCharacters} знака за този режим.`,
      );
    }
    if (policy.requiresOrganization && !body.externalOrganizationId) {
      throw new HttpError(
        400,
        "ORGANIZATION_REQUIRED",
        "Този режим изисква удостоверен идентификатор на организация.",
      );
    }

    const quota = await dependencies.chatQuotaStore.consume({
      tenantId: auth.tenantId,
      assistantProfile,
      externalUserId: body.externalUserId,
      limit: policy.messagesPerWindow,
      windowSeconds: policy.quotaWindowSeconds,
      now: new Date(),
    });
    if (!quota.allowed) {
      reply.header("retry-after", Math.max(1, Math.ceil((quota.resetAt.getTime() - Date.now()) / 1_000)));
      throw new HttpError(429, "CHAT_QUOTA_EXCEEDED", "Достигнат е лимитът за този режим.");
    }

    const conversationId = body.conversationId ?? randomUUID();
    const context = body.context
      ? {
          ...(body.context.jurisdiction === undefined
            ? {}
            : { jurisdiction: body.context.jurisdiction }),
          ...(body.context.asOf === undefined ? {} : { asOf: body.context.asOf }),
          ...(body.context.registrationProgress === undefined
            ? {}
            : { registrationProgress: body.context.registrationProgress }),
        }
      : undefined;
    const result = await dependencies.chatProvider.generate({
      tenantId: auth.tenantId,
      assistantProfile,
      ...(body.externalOrganizationId
        ? { externalOrganizationId: body.externalOrganizationId }
        : {}),
      message: body.message,
      ...(context ? { context } : {}),
    });

    await dependencies.conversationStore.saveExchange({
      tenantId: auth.tenantId,
      assistantProfile,
      externalUserId: body.externalUserId,
      ...(body.externalOrganizationId
        ? { externalOrganizationId: body.externalOrganizationId }
        : {}),
      conversationId,
      channel: body.channel,
      userMessage: body.message,
      assistantMessage: result.answer,
      status: result.status,
      requestId: request.id,
      retentionDays: policy.retentionDays,
      createdAt: new Date(),
    });

    return reply.send({
      ...result,
      assistantProfile,
      capabilities: {
        humanEscalation: policy.allowsHumanEscalation,
        organizationDocuments: policy.allowsOrganizationDocuments,
      },
      quota: {
        limit: quota.limit,
        remaining: quota.remaining,
        resetAt: quota.resetAt.toISOString(),
      },
      conversationId,
      requestId: request.id,
    });
  });

  app.post("/v1/admin/documents", async (request, reply) => {
    const auth = requireRole(request, "documents:write");
    let file: Buffer | undefined;
    let filename: string | undefined;
    let mimeType: string | undefined;
    let rawMetadata: string | undefined;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (file) throw new HttpError(400, "TOO_MANY_FILES", "Позволен е само един файл.");
        file = await part.toBuffer();
        filename = part.filename;
        mimeType = part.mimetype;
      } else if (part.fieldname === "metadata") {
        rawMetadata = String(part.value);
      }
    }

    if (!file || !filename || !mimeType) {
      throw new HttpError(400, "FILE_REQUIRED", "Липсва поле file.");
    }
    if (!rawMetadata) {
      throw new HttpError(400, "METADATA_REQUIRED", "Липсва JSON поле metadata.");
    }

    let metadataValue: unknown;
    try {
      metadataValue = JSON.parse(rawMetadata);
    } catch {
      throw new HttpError(400, "INVALID_METADATA_JSON", "Полето metadata не е валиден JSON.");
    }
    const metadata = documentMetadataSchema.parse(metadataValue);
    const targetTenantId = metadata.tenantId ?? auth.tenantId;
    if (targetTenantId !== auth.tenantId && !auth.roles.has("documents:tenants")) {
      throw new HttpError(403, "TENANT_MISMATCH", "tenantId не съответства на API клиента.");
    }
    if (metadata.accessLevel === "global" && !auth.roles.has("documents:global")) {
      throw new HttpError(403, "GLOBAL_DOCUMENT_FORBIDDEN", "Клиентът няма право да качва глобални източници.");
    }

    let document;
    try {
      document = await ingestion.ingest({
        tenantId: targetTenantId,
        metadata,
        filename,
        mimeType,
        content: file,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unsupported document MIME type")) {
        throw new HttpError(415, "UNSUPPORTED_DOCUMENT_TYPE", "Неподдържан формат на документа.");
      }
      throw error;
    }

    return reply.status(202).send({
      documentId: document.id,
      status: document.status,
      sha256: document.sha256,
      createdAt: document.createdAt.toISOString(),
    });
  });

  app.get("/v1/admin/documents/:id", async (request, reply) => {
    const auth = requireRole(request, "documents:read");
    const { id } = documentParamsSchema.parse(request.params);
    const document = await dependencies.documentRepository.findById(
      auth.tenantId,
      id,
      auth.roles.has("documents:global"),
      auth.roles.has("documents:tenants"),
    );
    if (!document) {
      throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Документът не е намерен.");
    }
    return reply.send({
      id: document.id,
      tenantId: document.tenantId,
      title: document.title,
      category: document.category,
      sourceType: document.sourceType,
      accessLevel: document.accessLevel,
      publiclyAccessible: document.publiclyAccessible ?? false,
      organizationId: document.organizationId,
      jurisdiction: document.jurisdiction,
      publisher: document.publisher,
      sourceUrl: document.sourceUrl,
      publishedAt: document.publishedAt,
      validFrom: document.validFrom,
      validTo: document.validTo,
      originalFilename: document.originalFilename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      sha256: document.sha256,
      status: document.status,
      error: document.error,
      attemptCount: document.attemptCount,
      nextAttemptAt: document.nextAttemptAt?.toISOString() ?? null,
      indexedAt: document.indexedAt?.toISOString() ?? null,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    });
  });

  app.post("/v1/admin/documents/:id/retry", async (request, reply) => {
    const auth = requireRole(request, "documents:write");
    const { id } = documentParamsSchema.parse(request.params);
    const document = await dependencies.documentRepository.findById(
      auth.tenantId,
      id,
      auth.roles.has("documents:global"),
      auth.roles.has("documents:tenants"),
    );
    if (!document) {
      throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Документът не е намерен.");
    }
    if (document.status !== "failed") {
      throw new HttpError(409, "DOCUMENT_NOT_FAILED", "Само документ със статус failed може да бъде пуснат повторно.");
    }

    const retried = await dependencies.documentRepository.retryFailed(id);
    if (!retried) {
      throw new HttpError(409, "DOCUMENT_RETRY_CONFLICT", "Статусът на документа е променен. Проверете го отново.");
    }
    return reply.status(202).send({
      documentId: retried.id,
      status: retried.status,
      attemptCount: retried.attemptCount,
      nextAttemptAt: retried.nextAttemptAt?.toISOString() ?? null,
    });
  });

  app.addHook("onClose", async () => {
    await dependencies.chatQuotaStore.close();
    await dependencies.documentRepository.close();
    await dependencies.conversationStore.close();
  });

  return app;
}
