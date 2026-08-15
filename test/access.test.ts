import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PostgresAccessRepository } from "../src/access.js";

describe("environment administrator", () => {
  it("creates a session only for the configured credentials without storing the password", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresAccessRepository(
      { query } as unknown as Pool,
      { email: "admin@leon.bg", password: "a-long-admin-password" },
    );

    await expect(repository.createSession("admin@leon.bg", "wrong-password")).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();

    const result = await repository.createSession("ADMIN@LEON.BG", "a-long-admin-password");
    expect(result?.session.user).toMatchObject({ email: "admin@leon.bg", isAdmin: true });
    expect(result?.token).toBeTruthy();
    expect(query).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(query.mock.calls)).not.toContain("a-long-admin-password");
  });
});
