import { randomUUID } from "node:crypto";

import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError, z } from "zod";

import { HttpError, registerAuthentication, requireRole } from "./auth.js";
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

const chatRequestSchema = z.object({
  tenantId: z.string().min(1).optional(),
  channel: z.string().min(1).max(50),
  externalUserId: z.string().min(1).max(200),
  conversationId: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(20_000),
  context: z
    .object({
      jurisdiction: z.string().min(2).max(20).optional(),
      asOf: z.iso.date().optional(),
    })
    .optional(),
});

const documentParamsSchema = z.object({ id: z.uuid() });

export interface AppDependencies {
  config: AppConfig;
  chatProvider: ChatProvider;
  conversationStore: ConversationStore;
  documentRepository: DocumentRepository;
  rawDocumentStorage: RawDocumentStorage;
  documentProcessor: DocumentProcessor;
  readinessCheck?: () => Promise<void>;
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
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 10,
      fileSize: config.maxDocumentBytes,
    },
  });
  await registerAuthentication(app, config.apiClients);

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

    const conversationId = body.conversationId ?? randomUUID();
    const context = body.context
      ? {
          ...(body.context.jurisdiction === undefined
            ? {}
            : { jurisdiction: body.context.jurisdiction }),
          ...(body.context.asOf === undefined ? {} : { asOf: body.context.asOf }),
        }
      : undefined;
    const result = await dependencies.chatProvider.generate({
      tenantId: auth.tenantId,
      message: body.message,
      ...(context ? { context } : {}),
    });

    await dependencies.conversationStore.saveExchange({
      tenantId: auth.tenantId,
      externalUserId: body.externalUserId,
      conversationId,
      channel: body.channel,
      userMessage: body.message,
      assistantMessage: result.answer,
      status: result.status,
      requestId: request.id,
      createdAt: new Date(),
    });

    return reply.send({
      ...result,
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
    if (metadata.tenantId && metadata.tenantId !== auth.tenantId) {
      throw new HttpError(403, "TENANT_MISMATCH", "tenantId не съответства на API клиента.");
    }
    if (metadata.accessLevel === "global" && !auth.roles.has("documents:global")) {
      throw new HttpError(403, "GLOBAL_DOCUMENT_FORBIDDEN", "Клиентът няма право да качва глобални източници.");
    }

    let document;
    try {
      document = await ingestion.ingest({
        tenantId: auth.tenantId,
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

  app.addHook("onClose", async () => {
    await dependencies.documentRepository.close();
    await dependencies.conversationStore.close();
  });

  return app;
}
