// Run after `npm run build`. Fails if anything private could reach a visitor's browser,
// or if the pretend-data test mode got into a real build.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dangerousJwtRoles, publicKeyProblem } from "./secrets-rules.mjs";

const secretNames = [
  "VAPID_PRIVATE_KEY",
  "OWNER_EMAIL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "ENCRYPTION_KEY",
  "SMTP_PASS",
];
const allowedPublic = [
  /^NEXT_PUBLIC_SUPABASE_URL$/,
  /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY$/,
  /^NEXT_PUBLIC_VAPID_PUBLIC_KEY$/,
  /^NEXT_PUBLIC_VERCEL_/,
];

const env = { ...readEnvFile(".env.local"), ...process.env };
function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

let bad = 0;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  bad++;
};

// 1. Only approved NEXT_PUBLIC_ names, and the Supabase key must be a publishable one.
for (const name of Object.keys(env)) {
  if (name.startsWith("NEXT_PUBLIC_") && !allowedPublic.some((re) => re.test(name))) {
    fail(`${name} is public (NEXT_PUBLIC_) but is not on the approved list.`);
  }
}
const pub = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const pubProblem = publicKeyProblem(pub);
if (pubProblem) fail(pubProblem);

// 2. Scan the files sent to the browser.
const dir = existsSync(".next/static") ? ".next/static" : null;
if (!dir) {
  fail("No build found. Run `npm run build` first.");
} else {
  const secretValues = secretNames.map((n) => env[n]).filter((v) => v && v.length >= 8);
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const file of walk(dir)) {
    if (!/\.(js|css|html|json|map)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const v of secretValues) if (text.includes(v)) fail(`A secret value is inside ${file}`);
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) fail(`A Supabase secret key is inside ${file}`);
    if (/service_role/.test(text)) fail(`"service_role" appears in ${file}`);
    for (const role of dangerousJwtRoles(text)) fail(`A Supabase key with role "${role}" is inside ${file}`);
  }
}

// 3. The pretend-data test mode must not be in a real build (server or browser).
function scanForFake(root) {
  if (!existsSync(root)) return;
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const file of walk(root)) {
    if (!/\.(js|mjs|json|html)$/.test(file) || file.includes(`${join(root, "cache")}`)) continue;
    if (readFileSync(file, "utf8").includes("__NUDGE_FAKE_STORE__")) fail(`Test-mode code is inside ${file}`);
  }
}
scanForFake(".next/static");
scanForFake(".next/server");

if (bad) process.exit(1);
console.log("Secrets check passed: nothing private in the browser files, no test-mode code.");
