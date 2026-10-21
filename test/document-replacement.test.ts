import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import type { DocumentRecord } from "../src/domain.js";
import { InMemoryDocumentRepository, PostgresDocumentRepository } from "../src/documents.js";
import { OpenAIDocumentIndexer } from "../src/openai-indexer.js";
import type { Pool } from "pg";

function record(id: string, overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {id,tenantId:"knowledge-admin",title:"A",category:"kik-info",sourceType:"professional",accessLevel:"global",
    jurisdiction:"BG",publisher:"КиК.БГ",sourceUrl:"https://kik-info.com/a",originalFilename:"a.md",mimeType:"text/markdown",
    sizeBytes:3,sha256:id.repeat(64),storageKey:id,status:"ready",attemptCount:1,nextAttemptAt:null,leaseUntil:null,
    indexedAt:new Date(),createdAt:new Date(),updatedAt:new Date(),openAiFileId:`file_${id}`,vectorStoreId:"vs_1",...overrides};
}
const input = (detach = vi.fn().mockResolvedValue(undefined)) => ({oldId:"a",newId:"b",oldSha256:"a".repeat(64),newSha256:"b".repeat(64),detach});
async function setup(overrides: Partial<DocumentRecord> = {}) {
  const repo = new InMemoryDocumentRepository();
  await repo.save(record("a")); await repo.save(record("b",overrides));
  return repo;
}
describe("safe document replacement",()=>{
  it("archives after detach, retains originals and is idempotent",async()=>{
    const repo=await setup(); const args=input();
    args.detach.mockImplementation(async()=>{expect(repo.documents.get("a")?.status).toBe("ready");});
    await repo.replaceReady(args); await repo.replaceReady(args);
    expect(args.detach).toHaveBeenCalledTimes(1);
    expect(repo.documents.get("a")).toMatchObject({status:"archived",supersededBy:"b",storageKey:"a"});
  });
  for(const overrides of [{status:"processing" as const},{tenantId:"other"},{sourceUrl:"https://other.invalid/a"},
    {publiclyAccessible:true},{category:"other"},{organizationId:"other"},{publisher:"other"},{openAiFileId:"file_a"}]) {
    it(`rejects unsafe replacement ${JSON.stringify(overrides)}`,async()=>{
      const repo=await setup(overrides); const args=input();
      await expect(repo.replaceReady(args)).rejects.toThrow();
      expect(args.detach).not.toHaveBeenCalled();
      expect(repo.documents.get("a")?.status).toBe("ready");
    });
  }
  it("retains old ready state on detach failure and rejects stale hashes",async()=>{
    const repo=await setup(); const args=input(vi.fn().mockRejectedValue(new Error("network")));
    await expect(repo.replaceReady(args)).rejects.toThrow("network");
    expect(repo.documents.get("a")?.status).toBe("ready");
    await expect(repo.replaceReady({...input(),oldSha256:"wrong"})).rejects.toThrow();
  });
  it("serializes competing replacements",async()=>{
    const repo=await setup(); await repo.save(record("c"));
    const results=await Promise.allSettled([repo.replaceReady(input()),repo.replaceReady({...input(),newId:"c",newSha256:"c".repeat(64)})]);
    expect(results.map(r=>r.status)).toEqual(["fulfilled","rejected"]);
  });
  it("Postgres locks both records, rolls back failure and releases connection",async()=>{
    const query=vi.fn().mockResolvedValue({rows:[]}); const release=vi.fn();
    const repo=new PostgresDocumentRepository({connect:async()=>({query,release})} as unknown as Pool);
    await expect(repo.replaceReady(input())).rejects.toThrow();
    expect(query.mock.calls.map(call=>call[0])).toEqual(["BEGIN",expect.stringContaining("ORDER BY id FOR UPDATE"),"ROLLBACK"]);
    expect(release).toHaveBeenCalled();
  });
  it("detaches only the index association; 404 is idempotent but server errors fail",async()=>{
    const del=vi.fn().mockResolvedValue({deleted:true});
    const client={vectorStores:{files:{delete:del}}} as unknown as OpenAI;
    const indexer=new OpenAIDocumentIndexer({apiKey:"fixture",vectorStoreId:"vs_1",pollIntervalMs:1,pollTimeoutMs:1,client});
    await indexer.detach(record("a"));
    expect(del).toHaveBeenCalledWith("file_a",{vector_store_id:"vs_1"});
    del.mockRejectedValueOnce({status:404}); await indexer.detach(record("a"));
    del.mockRejectedValueOnce({status:500}); await expect(indexer.detach(record("a"))).rejects.toEqual({status:500});
  });
});
