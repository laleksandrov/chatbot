import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("admin environment configuration", () => {
  it("accepts an admin email and password together", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      ADMIN_EMAIL: "Admin@Leon.bg",
      ADMIN_PASSWORD: "a-long-admin-password",
    });
    expect(config.adminEmail).toBe("admin@leon.bg");
    expect(config.adminPassword).toBe("a-long-admin-password");
  });

  it("rejects incomplete admin credentials", () => {
    expect(() => loadConfig({ NODE_ENV: "test", ADMIN_EMAIL: "admin@leon.bg" })).toThrow(
      /ADMIN_EMAIL and ADMIN_PASSWORD/,
    );
  });
});
