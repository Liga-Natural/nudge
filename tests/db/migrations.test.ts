import { describe, expect, it } from "vitest";
import { newDb, addVaultSecrets, runMigrations, rlsCheckSql, migrationFiles } from "./harness";

describe("migrations", () => {
  it("run in order, then run a second time without errors", async () => {
    const db = await newDb();
    await addVaultSecrets(db);
    await runMigrations(db);
    await runMigrations(db); // safe to run twice
    expect(migrationFiles().length).toBeGreaterThanOrEqual(5);
  });

  it("leaves the security check returning 0 rows", async () => {
    const db = await newDb();
    await addVaultSecrets(db);
    await runMigrations(db);
    const rows = await db.query(rlsCheckSql().replace(/;\s*$/, ""));
    expect(rows.rows).toEqual([]);
  });

  it("the clock file makes exactly two jobs even when run twice", async () => {
    const db = await newDb();
    await addVaultSecrets(db);
    await runMigrations(db);
    await runMigrations(db);
    const jobs = await db.query("select jobname from cron.job order by jobname");
    expect(jobs.rows.map((r) => (r as { jobname: string }).jobname)).toEqual(["nudge-cleanup", "nudge-dispatch"]);
  });

  it("the clock file refuses to run before the Vault secrets exist", async () => {
    const db = await newDb();
    await expect(runMigrations(db)).rejects.toThrow(/Vault secrets/);
  });
});
