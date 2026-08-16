import { createHash } from "node:crypto";
import { basename, extname, join, resolve } from "node:path";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

interface UploadRecord {
  file: string;
  sha256: string;
  documentId: string;
  status: string;
  createdAt: string;
  indexedAt?: string;
}

const { values } = parseArgs({
  options: {
    directory: { type: "string" },
    state: { type: "string" },
    label: { type: "string" },
    "timeout-ms": { type: "string", default: "1200000" },
  },
});

if (!values.directory || !values.state || !values.label) {
  throw new Error("Usage: --directory <path> --state <json-path> --label <month label>");
}

const apiUrl = process.env.CHATBOT_URL?.replace(/\/$/, "");
const apiKey = process.env.CHATBOT_INGESTION_KEY;
if (!apiUrl || !apiKey) throw new Error("CHATBOT_URL and CHATBOT_INGESTION_KEY are required");

const directory = resolve(values.directory);
const statePath = resolve(values.state);
const timeoutMs = Number(values["timeout-ms"]);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid timeout");

async function listDocx(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listDocx(path);
    return extname(entry.name).toLowerCase() === ".docx" ? [path] : [];
  }));
  return files.flat().sort((a, b) => a.localeCompare(b, "bg"));
}

async function readState(): Promise<UploadRecord[]> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as UploadRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function saveState(records: UploadRecord[]): Promise<void> {
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  await rename(temporary, statePath);
}

const files = await listDocx(directory);
if (!files.length) throw new Error("No DOCX files found");
const records = await readState();
const byHash = new Map(records.map((record) => [record.sha256, record]));

for (const file of files) {
  const content = await readFile(file);
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (byHash.has(sha256)) continue;

  const filename = basename(file);
  const titleStem = filename.slice(0, -extname(filename).length).replaceAll("_", " ").trim();
  const metadata = {
    tenantId: "knowledge-admin",
    title: `НАП — ${titleStem} (${values.label})`,
    category: "nra-questions-and-answers",
    sourceType: "institutional",
    accessLevel: "global",
    jurisdiction: "BG",
    publisher: "Национална агенция за приходите",
    sourceUrl: "https://portal.nra.bg/questions-and-answers",
  };
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append(
    "file",
    new Blob([new Uint8Array(content)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    filename,
  );
  const response = await fetch(`${apiUrl}/v1/admin/documents`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Upload failed for ${filename} (${response.status}): ${JSON.stringify(body)}`);
  const record: UploadRecord = {
    file: file.slice(directory.length + 1).replaceAll("\\", "/"),
    sha256,
    documentId: String(body.documentId),
    status: String(body.status),
    createdAt: String(body.createdAt),
  };
  records.push(record);
  byHash.set(sha256, record);
  await saveState(records);
  console.log(`accepted ${records.length}/${files.length}: ${filename}`);
}

const deadline = Date.now() + timeoutMs;
while (records.some((record) => !["ready", "failed", "archived"].includes(record.status))) {
  if (Date.now() >= deadline) throw new Error("Timed out waiting for batch indexing");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 10_000));
  for (const record of records) {
    if (["ready", "failed", "archived"].includes(record.status)) continue;
    const response = await fetch(`${apiUrl}/v1/admin/documents/${record.documentId}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`Status failed for ${record.documentId}: ${response.status}`);
    record.status = String(body.status);
    if (typeof body.indexedAt === "string") record.indexedAt = body.indexedAt;
  }
  await saveState(records);
  const counts = records.reduce<Record<string, number>>((summary, record) => {
    summary[record.status] = (summary[record.status] ?? 0) + 1;
    return summary;
  }, {});
  console.log(counts);
}

const failed = records.filter((record) => record.status !== "ready");
if (failed.length) throw new Error(`Batch ended with ${failed.length} non-ready documents`);
console.log(`ready ${records.length}/${files.length}`);
