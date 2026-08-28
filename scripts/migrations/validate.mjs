import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationDirectory = resolve("supabase/migrations");
const migrationNames = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql"));
const forbidden =
  /\b(drop\s+(table|schema|database|type|extension|function|view|materialized\s+view)|truncate(?:\s+table)?|alter\s+table[\s\S]{0,300}?\bdrop\s+column)\b/i;

for (const name of migrationNames) {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) {
    throw new Error("Invalid migration name: " + name);
  }
  const source = readFileSync(resolve(migrationDirectory, name), "utf8");
  if (forbidden.test(source)) {
    throw new Error("Destructive-first migration is forbidden: " + name);
  }
}

console.log("MIGRATION_STATIC_VALIDATION=PASS");
