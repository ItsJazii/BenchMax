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

// The built config inherits top-level (= production) values. Any binding-type
// key we do not explicitly override must be empty, otherwise a future binding
// (KV, DO, service, ...) would silently ship production resources to staging.
const bindingKeysThatMustBeEmpty = [
  "durable_objects",
  "kv_namespaces",
  "services",
  "workflows",
  "send_email",
  "vectorize",
  "hyperdrive",
  "pipelines",
  "secrets_store_secrets",
  "analytics_engine_datasets",
  "dispatch_namespaces",
  "mtls_certificates",
  "ai_search_namespaces",
  "agent_memory",
  "worker_loaders",
  "ratelimits",
  "vpc_services",
  "vpc_networks",
  "logfwdr",
  "dispatch_namespaces",
];
for (const key of bindingKeysThatMustBeEmpty) {
  if (!isEmptyBinding(builtConfig[key])) {
    throw new Error(
      `built Worker config carries an unmanaged binding (${key}); teach prepare-main-deploy.mjs how to override it per environment before deploying`,
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
