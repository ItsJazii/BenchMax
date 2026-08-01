import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonc } from "./phase2-config.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentName = process.argv[2];
if (environmentName !== "staging" && environmentName !== "production") {
  throw new Error("Usage: node scripts/prepare-main-deploy.mjs <staging|production>");
}

const builtConfigPath = path.join(rootDirectory, "dist", "server", "wrangler.json");
const builtConfig = JSON.parse(fs.readFileSync(builtConfigPath, "utf8"));
const sourceConfig = readJsonc(rootDirectory, "wrangler.jsonc");
const environment = sourceConfig.env?.[environmentName];
if (!environment) throw new Error(`Missing main Worker environment: ${environmentName}`);

// Every key the environment block must override. An absent key would previously
// serialize as undefined and silently DELETE the section from the deploy config
// (e.g. no triggers -> every cron sweep dead but preflight green).
const overrideKeys = ["name", "d1_databases", "r2_buckets", "queues", "triggers"];
for (const key of overrideKeys) {
  if (environment[key] === undefined) {
    throw new Error(`main Worker ${environmentName} environment is missing required key: ${key}`);
  }
}

// The built config inherits top-level (= production) values. Inverted
// allowlist: every key that is neither overridden per environment nor a
// known-safe non-binding key must be EMPTY, so any future binding type (KV,
// DO, service, tail consumer, vars, ...) fails loudly instead of silently
// shipping production resources to staging.
const knownSafeKeys = new Set([
  "configPath",
  "userConfigPath",
  "topLevelName",
  "definedEnvironments",
  "compatibility_date",
  "compatibility_flags",
  "jsx_factory",
  "jsx_fragment",
  "rules",
  "main",
  "assets",
  "exports",
  "migrations",
  "dev",
  "no_bundle",
  // Bundler file-selection defaults, not resource bindings.
  "python_modules",
  ...overrideKeys,
]);
for (const [key, value] of Object.entries(builtConfig)) {
  if (knownSafeKeys.has(key)) continue;
  if (!isEmptyBinding(value)) {
    throw new Error(
      `built Worker config carries an unmanaged key (${key}); teach prepare-main-deploy.mjs how to override it per environment before deploying`,
    );
  }
}

const deployConfig = { ...builtConfig };
for (const key of overrideKeys) deployConfig[key] = environment[key];

const outputPath = path.join(
  rootDirectory,
  "dist",
  "server",
  `wrangler.${environmentName}.json`,
);
fs.writeFileSync(outputPath, `${JSON.stringify(deployConfig, null, 2)}\n`);
console.log(`Prepared ${path.relative(rootDirectory, outputPath)} for ${environmentName}.`);

function isEmptyBinding(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    if (Array.isArray(value.bindings)) return value.bindings.length === 0;
    return Object.keys(value).length === 0;
  }
  return false;
}
