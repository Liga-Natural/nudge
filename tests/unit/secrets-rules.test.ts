import { describe, expect, it } from "vitest";
import { dangerousJwtRoles, publicKeyProblem } from "../../scripts/secrets-rules.mjs";

const jwt = (role: string) => {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ iss: "supabase", role })}.signature-abcdefgh`;
};

describe("the public key rules (build check)", () => {
  it("allows only publishable and anon keys", () => {
    expect(publicKeyProblem("sb_publishable_abc123")).toBeNull();
    expect(publicKeyProblem(jwt("anon"))).toBeNull();
    expect(publicKeyProblem(undefined)).toBeNull();
  });
  it("refuses secret keys and service_role keys", () => {
    expect(publicKeyProblem("sb_secret_abcdefghijk")).toMatch(/secret key/);
    expect(publicKeyProblem(jwt("service_role"))).toMatch(/service_role/);
    expect(publicKeyProblem("whatever")).toMatch(/does not look like/);
  });
  it("spots a powerful key hiding inside a browser file", () => {
    expect(dangerousJwtRoles(`var a="${jwt("service_role")}";`)).toEqual(["service_role"]);
    expect(dangerousJwtRoles(`var a="${jwt("anon")}";`)).toEqual([]);
    expect(dangerousJwtRoles("nothing here")).toEqual([]);
  });
});
