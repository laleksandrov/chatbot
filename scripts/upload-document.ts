import { parseArgs } from "node:util";
import { basename, extname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { documentMetadataSchema } from "../src/documents.js";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    metadata: { type: "string" },
    wait: { type: "boolean", default: true },
    "timeout-ms": { type: "string", default: "300000" },
  },
});

if (!values.file || !values.metadata) {
  throw new Error("Usage: npm run documents:upload -- --file <path> --metadata <json-path>");
}

const apiUrl = process.env.CHATBOT_URL?.replace(/\/$/, "");
const apiKey = process.env.CHATBOT_INGESTION_KEY;
if (!apiUrl || !apiKey) {
  throw new Error("CHATBOT_URL and CHATBOT_INGESTION_KEY are required in .env.ingestion");
}

const timeoutMs = Number(values["timeout-ms"]);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeout-ms must be a positive number");
}

const filePath = resolve(values.file);
const metadataPath = resolve(values.metadata);
const [content, rawMetadata] = await Promise.all([readFile(filePath), readFile(metadataPath, "utf8")]);
const metadata = documentMetadataSchema.parse(JSON.parse(rawMetadata));

const mimeTypes: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".html": "text/html",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
};
const mimeType = mimeTypes[extname(filePath).toLowerCase()];
if (!mimeType) throw new Error(`Unsupported file extension: ${extname(filePath)}`);

const form = new FormData();
form.append("metadata", JSON.stringify(metadata));
form.append("file", new Blob([new Uint8Array(content)], { type: mimeType }), basename(filePath));

const uploadResponse = await fetch(`${apiUrl}/v1/admin/documents`, {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}` },
  body: form,
  signal: AbortSignal.timeout(60_000),
});
const uploadBody = (await uploadResponse.json()) as Record<string, unknown>;
if (!uploadResponse.ok) {
  throw new Error(`Upload failed (${uploadResponse.status}): ${JSON.stringify(uploadBody)}`);
}

const documentId = uploadBody.documentId;
if (typeof documentId !== "string") throw new Error("Upload response does not contain documentId");
console.log(JSON.stringify(uploadBody, null, 2));

if (values.wait) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    const statusResponse = await fetch(`${apiUrl}/v1/admin/documents/${documentId}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    const statusBody = (await statusResponse.json()) as Record<string, unknown>;
    if (!statusResponse.ok) {
      throw new Error(`Status check failed (${statusResponse.status}): ${JSON.stringify(statusBody)}`);
    }
    if (statusBody.status === "ready") {
      console.log(JSON.stringify(statusBody, null, 2));
      break;
    }
    if (statusBody.status === "failed" || statusBody.status === "archived") {
      throw new Error(`Document processing ended with status ${String(statusBody.status)}`);
    }
    if (Date.now() + 2_000 >= deadline) {
      throw new Error(`Timed out waiting for document ${documentId}`);
    }
  }
}
