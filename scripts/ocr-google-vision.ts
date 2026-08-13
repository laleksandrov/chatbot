import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import vision from "@google-cloud/vision";

const execFileAsync = promisify(execFile);

interface Options {
  input: string;
  outputDir: string;
  title: string;
  sourceUrl?: string;
  documentDate?: string;
  validFrom?: string;
  expectedPages?: number;
}

interface PageResult {
  page: number;
  text: string;
  characters: number;
  words: number;
  blocks: number;
  averageBlockConfidence: number | null;
  imageSha256: string;
  response: unknown;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function requireArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`Missing required argument --${name}`);
  return value;
}

function parseOptions(): Options {
  const expectedPages = argument("expected-pages");
  const sourceUrl = argument("source-url");
  const documentDate = argument("document-date");
  const validFrom = argument("valid-from");
  return {
    input: resolve(requireArgument("input")),
    outputDir: resolve(requireArgument("output-dir")),
    title: requireArgument("title"),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(documentDate ? { documentDate } : {}),
    ...(validFrom ? { validFrom } : {}),
    ...(expectedPages ? { expectedPages: Number(expectedPages) } : {}),
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function markdown(options: Options, inputSha256: string, pages: PageResult[]): string {
  const lines = [
    "---",
    `title: ${yamlString(options.title)}`,
    'publisher: "Национална агенция за приходите"',
    'source_type: "institutional"',
    'jurisdiction: "BG"',
    `source_file_sha256: "${inputSha256}"`,
    'ocr_provider: "Google Cloud Vision DOCUMENT_TEXT_DETECTION"',
    `ocr_created_at: "${new Date().toISOString()}"`,
    ...(options.sourceUrl ? [`source_url: ${yamlString(options.sourceUrl)}`] : []),
    ...(options.documentDate ? [`document_date: "${options.documentDate}"`] : []),
    ...(options.validFrom ? [`valid_from: "${options.validFrom}"`] : []),
    "---",
    "",
    `# ${options.title}`,
    "",
    "> OCR производен текст. При спор или неяснота се проверява оригиналният PDF от НАП.",
    "",
  ];
  for (const page of pages) lines.push(`## Страница ${page.page}`, "", page.text.trim(), "");
  return `${lines.join("\n").trim()}\n`;
}

async function main(): Promise<void> {
  const options = parseOptions();
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS must point to a Google service-account JSON file");
  }
  if (options.expectedPages !== undefined && (!Number.isInteger(options.expectedPages) || options.expectedPages < 1)) {
    throw new Error("--expected-pages must be a positive integer");
  }

  const input = await readFile(options.input);
  const inputSha256 = createHash("sha256").update(input).digest("hex");
  const workDir = join(options.outputDir, "page-images");
  const rawDir = join(options.outputDir, "raw");
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  await mkdir(rawDir, { recursive: true });

  const prefix = join(workDir, "page");
  await execFileAsync("pdftoppm", ["-jpeg", "-r", "300", "-jpegopt", "quality=92", options.input, prefix], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const pageCount = options.expectedPages ?? Number(
    (await execFileAsync("pdfinfo", [options.input])).stdout.match(/^Pages:\s+(\d+)/m)?.[1],
  );
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("Could not determine PDF page count");

  const client = new vision.ImageAnnotatorClient();
  const pages: PageResult[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const imagePath = join(workDir, `page-${String(page).padStart(2, "0")}.jpg`);
    const image = await readFile(imagePath);
    const [response] = await client.documentTextDetection({
      image: { content: image },
      imageContext: { languageHints: ["bg", "en"] },
    });
    if (response.error?.message) throw new Error(`Vision page ${page}: ${response.error.message}`);
    const text = response.fullTextAnnotation?.text ?? "";
    const blocks = response.fullTextAnnotation?.pages?.flatMap((item) => item.blocks ?? []) ?? [];
    const confidences = blocks
      .map((block) => block.confidence)
      .filter((confidence): confidence is number => typeof confidence === "number");
    const result: PageResult = {
      page,
      text,
      characters: text.length,
      words: text.trim() ? text.trim().split(/\s+/u).length : 0,
      blocks: blocks.length,
      averageBlockConfidence: confidences.length
        ? confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length
        : null,
      imageSha256: createHash("sha256").update(image).digest("hex"),
      response,
    };
    pages.push(result);
    await writeFile(join(rawDir, `page-${String(page).padStart(3, "0")}.json`), JSON.stringify(response, null, 2));
    process.stdout.write(`OCR page ${page}/${pageCount}: ${result.characters} characters\n`);
  }

  const emptyPages = pages.filter((page) => page.characters < 20).map((page) => page.page);
  const qa = {
    input: options.input,
    inputSha256,
    pageCount,
    expectedPages: options.expectedPages ?? null,
    totalCharacters: pages.reduce((sum, page) => sum + page.characters, 0),
    totalWords: pages.reduce((sum, page) => sum + page.words, 0),
    emptyPages,
    passed: emptyPages.length === 0 && (options.expectedPages === undefined || pageCount === options.expectedPages),
    pages: pages.map((page) => ({
      page: page.page,
      characters: page.characters,
      words: page.words,
      blocks: page.blocks,
      averageBlockConfidence: page.averageBlockConfidence,
      imageSha256: page.imageSha256,
    })),
  };
  const stem = basename(options.input).replace(/\.pdf$/i, "");
  await writeFile(join(options.outputDir, `${stem}.ocr.md`), markdown(options, inputSha256, pages));
  await writeFile(join(options.outputDir, `${stem}.qa.json`), JSON.stringify(qa, null, 2));
  if (!qa.passed) throw new Error(`OCR QA failed; empty pages: ${emptyPages.join(", ") || "none"}`);
}

await main();
