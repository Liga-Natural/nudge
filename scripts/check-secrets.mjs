// Fails if a secret value shows up in files sent to the browser.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const secretNames = ["VAPID_PRIVATE_KEY", "OWNER_EMAIL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "ENCRYPTION_KEY"];
const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
} catch {}
const values = secretNames.map((n) => process.env[n] || env[n]).filter((v) => v && v.length >= 8);

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
let bad = 0;
for (const file of walk(".next/static")) {
  const text = readFileSync(file, "utf8");
  for (const v of values) if (text.includes(v)) { console.error(`Secret value found in ${file}`); bad++; }
  if (/service_role|sb_secret_/.test(text)) { console.error(`Secret-looking key name in ${file}`); bad++; }
}
if (bad) process.exit(1);
console.log("Secrets check passed.");
