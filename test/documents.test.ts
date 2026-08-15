import { describe, expect, it } from "vitest";

import { documentMetadataSchema } from "../src/documents.js";

describe("document metadata", () => {
  it("accepts a public platform document inside its tenant", () => {
    const metadata = documentMetadataSchema.parse({
      title: "EasyStart prices",
      category: "platform-pricing",
      sourceType: "professional",
      accessLevel: "tenant",
      publiclyAccessible: true,
    });

    expect(metadata.publiclyAccessible).toBe(true);
    expect(metadata.accessLevel).toBe("tenant");
  });

  it("does not allow internal or organization documents to become public", () => {
    expect(
      documentMetadataSchema.safeParse({
        title: "Internal prices",
        category: "internal",
        sourceType: "internal",
        accessLevel: "tenant",
        publiclyAccessible: true,
      }).success,
    ).toBe(false);

    expect(
      documentMetadataSchema.safeParse({
        title: "Client document",
        category: "client",
        sourceType: "professional",
        accessLevel: "tenant",
        organizationId: "company-42",
        publiclyAccessible: true,
      }).success,
    ).toBe(false);
  });
});
