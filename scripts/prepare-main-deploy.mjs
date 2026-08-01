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

// Symmetric guard: every key someone writes into an env block must be one we
// actually copy, otherwise their explicit per-environment setting would be
// silently dropped and the production-shaped default deployed instead.
for (const key of Object.keys(environment)) {
  if (!overrideKeys.includes(key)) {
    throw new Error(
      `main Worker ${environmentName} environment sets an unsupported key (${key}); add it to prepare-main-deploy.mjs overrideKeys so it is copied into the deploy config`,
    );
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
  // Benign scalar/operational keys the Cloudflare plugin may emit; none carry
  // environment-scoped resource references.
  "account_id",
  "send_metrics",
  "minify",
  "observability",
  "workers_dev",
  "preview_urls",
  "keep_vars",
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

// The generated config lives in dist/server/, so a relative migrations_dir
// would resolve to a non-existent dist/server/drizzle. Deploys never apply
// migrations; strip the key so nobody can run
// `d1 migrations apply --config dist/server/wrangler.<env>.json` by mistake —
// migrations always go through `wrangler.jsonc --env <environment>`.
deployConfig.d1_databases = deployConfig.d1_databases.map(
  ({ migrations_dir, ...database }) => database,
);

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
