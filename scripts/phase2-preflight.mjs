import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonc } from "./phase2-config.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(rootDirectory, relativePath), "utf8");

const mainConfig = readJsonc(rootDirectory, "wrangler.jsonc");
const usercontentConfig = readJsonc(rootDirectory, "wrangler.usercontent.jsonc");
const environments = {
  staging: {
    main: mainConfig.env?.staging,
    usercontent: usercontentConfig.env?.staging,
    mainName: "benchmax-staging",
    usercontentName: "benchmax-usercontent-staging",
    databaseName: "benchmax-staging-d1",
    // Provisioned resource IDs are pinned (non-secret; see docs/phase-2-provisioning.md)
    // so a staging<->production ID swap cannot pass on matching names alone.
    databaseId: "5d44e60d-bff8-4036-9c4d-383464230670",
    bucketName: "benchmax-uploads-staging",
    queuePrefix: "benchmax-staging-",
  },
  production: {
    main: mainConfig.env?.production,
    usercontent: usercontentConfig.env?.production,
    mainName: "benchmax",
    usercontentName: "benchmax-usercontent",
    databaseName: "benchmax-d1",
    databaseId: "1b90635c-2906-472f-a0d1-242cbceee802",
    bucketName: "benchmax-uploads",
    queuePrefix: "benchmax-",
  },
};
const requiredCrons = ["*/2 * * * *", "0 3 * * 1"];

const databaseIds = {};
const queueNamesByEnvironment = {};
for (const [environmentName, expected] of Object.entries(environments)) {
  assert(expected.main, `main Worker ${environmentName} environment is missing`);
  assert(expected.usercontent, `user-content Worker ${environmentName} environment is missing`);
  assert.equal(expected.main.name, expected.mainName, `main Worker ${environmentName} name is wrong`);
  assert.equal(expected.usercontent.name, expected.usercontentName, `user-content Worker ${environmentName} name is wrong`);

  const mainDatabase = expected.main.d1_databases?.[0];
  const usercontentDatabase = expected.usercontent.d1_databases?.[0];
  assert.equal(mainDatabase?.binding, "DB", `main Worker ${environmentName} must bind DB`);
  assert.equal(usercontentDatabase?.binding, "DB", `user-content Worker ${environmentName} must bind DB`);
  assert.equal(mainDatabase?.database_name, expected.databaseName, `main Worker ${environmentName} D1 name is wrong`);
  assert.equal(usercontentDatabase?.database_name, expected.databaseName, `user-content Worker ${environmentName} D1 name is wrong`);
  assert.match(mainDatabase?.database_id ?? "", /^[0-9a-f-]{36}$/i, `main Worker ${environmentName} D1 ID is missing or invalid`);
  assert.equal(mainDatabase?.database_id, expected.databaseId, `main Worker ${environmentName} D1 ID does not match the provisioned ${expected.databaseName} database`);
  assert.equal(mainDatabase?.database_id, usercontentDatabase?.database_id, `${environmentName} Workers must share one D1 database`);
  databaseIds[environmentName] = mainDatabase.database_id;

  const crons = expected.main.triggers?.crons ?? [];
  for (const cron of requiredCrons) {
    assert(crons.includes(cron), `main Worker ${environmentName} is missing cron trigger: ${cron}`);
  }

  assert.equal(expected.main.r2_buckets?.[0]?.binding, "UPLOADS", `main Worker ${environmentName} must bind UPLOADS`);
  assert.equal(expected.usercontent.r2_buckets?.[0]?.binding, "UPLOADS", `user-content Worker ${environmentName} must bind UPLOADS`);
  assert.equal(expected.main.r2_buckets?.[0]?.bucket_name, expected.bucketName, `main Worker ${environmentName} bucket is wrong`);
  assert.equal(expected.usercontent.r2_buckets?.[0]?.bucket_name, expected.bucketName, `user-content Worker ${environmentName} bucket is wrong`);

  const queues = queueNames(expected.main.queues);
  assertRequiredQueues(queues, expected.queuePrefix, `main Worker ${environmentName}`);
  queueNamesByEnvironment[environmentName] = queues;
}

assert.notEqual(databaseIds.staging, databaseIds.production, "staging and production must use separate D1 databases");
assertDisjoint(queueNamesByEnvironment.staging, queueNamesByEnvironment.production, "staging and production queues");
// Top-level (no --env) blocks are local-only: placeholder D1, local queue and
// bucket names. A stray deploy without --env can then never attach consumers,
// crons, or storage to live production resources.
assertRequiredQueues(queueNames(mainConfig.queues), "benchmax-local-", "top-level main Worker");
assert.equal(mainConfig.r2_buckets?.[0]?.bucket_name, "benchmax-local-uploads", "top-level main Worker bucket must be the local-only bucket");
assert.equal(usercontentConfig.r2_buckets?.[0]?.bucket_name, "benchmax-local-uploads", "top-level user-content Worker bucket must be the local-only bucket");
assert.equal(mainConfig.name, "benchmax-local", "top-level main Worker name must be local-only");
assert.equal(usercontentConfig.name, "benchmax-usercontent-local", "top-level user-content Worker name must be local-only");
for (const expected of Object.values(environments)) {
  assert.notEqual(mainConfig.name, expected.mainName, "top-level main Worker name must differ from every deployed environment name");
  assert.notEqual(usercontentConfig.name, expected.usercontentName, "top-level user-content Worker name must differ from every deployed environment name");
}
for (const cron of requiredCrons) {
  assert((mainConfig.triggers?.crons ?? []).includes(cron), `top-level main Worker is missing cron trigger: ${cron}`);
}
// The top-level (no --env) blocks must stay on the fail-closed placeholder so
// a command that omits --env can never reach live data (an invalid D1 ID also
// aborts a whole stray deploy before queue consumers or crons attach).
const LOCAL_PLACEHOLDER_D1_ID = "00000000-0000-4000-8000-000000000000";
assert.equal(mainConfig.d1_databases?.[0]?.database_id, LOCAL_PLACEHOLDER_D1_ID, "top-level main Worker must keep the fail-closed local placeholder D1 ID");
assert.equal(usercontentConfig.d1_databases?.[0]?.database_id, LOCAL_PLACEHOLDER_D1_ID, "top-level user-content Worker must keep the fail-closed local placeholder D1 ID");
for (const environmentDatabaseId of Object.values(databaseIds)) {
  assert.notEqual(environmentDatabaseId, LOCAL_PLACEHOLDER_D1_ID, "environment blocks must carry real provisioned D1 IDs");
}

const envNames = parseEnvNames(read(".env.example"));
const requiredEnvNames = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_USERCONTENT_ORIGIN",
  "CLERK_SECRET_KEY",
  "CLERK_JWT_KEY",
  "CLERK_AUTHORIZED_PARTIES",
  "BENCHMAX_OWNER_SUBJECTS",
  "PROVENANCE_ENCRYPTION_KEY",
  "JUDGE_PROVIDER",
  "JUDGE_MODEL",
  "JUDGE_MODEL_VERSION",
  "JUDGE_API_ORIGIN",
  "JUDGE_API_KEY",
  "JUDGE_CALIBRATION_SET_HASH",
  "JUDGE_CALIBRATION_SET_OBJECT_KEY",
  "BENCHMAX_JUDGE_DAILY_SAMPLE_BUDGET",
  "BENCHMAX_JUDGE_INPUT_MICROUSD_PER_MILLION_TOKENS",
  "BENCHMAX_JUDGE_OUTPUT_MICROUSD_PER_MILLION_TOKENS",
  "BENCHMAX_SANDBOX_MICROUSD_PER_HOUR",
  "BENCHMAX_APP_ORIGIN",
];
for (const name of requiredEnvNames) assert(envNames.has(name), `missing .env.example key: ${name}`);

const forbiddenBindingPattern = /\bIMAGES\b/;
for (const filePath of sourceFiles(rootDirectory)) {
  if (filePath === path.join(rootDirectory, "scripts", "phase2-preflight.mjs")) continue;
  const relativePath = path.relative(rootDirectory, filePath);
  assert(!forbiddenBindingPattern.test(fs.readFileSync(filePath, "utf8")), `unconfigured IMAGES binding remains in ${relativePath}`);
}

console.log("Phase 2 preflight: isolated environments, config parsing, secret contract, and bindings verified.");

function queueNames(config) {
  return new Set([
    ...(config?.producers ?? []).map((queue) => queue.queue),
    ...(config?.consumers ?? []).map((queue) => queue.queue),
  ]);
}

function assertRequiredQueues(queues, prefix, label) {
  const required = ["evaluate", "judge", "pipeline-dlq"].map((suffix) => `${prefix}${suffix}`);
  // Exact set membership: a prefix check alone would let staging queue names
  // (benchmax-staging-*) pass inside the production block, since they also
  // start with "benchmax-".
  const allowed = new Set(required);
  for (const queue of required) assert(queues.has(queue), `${label} is missing configured queue: ${queue}`);
  for (const queue of queues) assert(allowed.has(queue), `${label} queue crosses environment boundary: ${queue}`);
}

function assertDisjoint(left, right, label) {
  for (const value of left) assert(!right.has(value), `${label} overlap: ${value}`);
}

function parseEnvNames(text) {
  const names = new Set();
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    assert(match, `malformed .env.example line ${index + 1}`);
    names.add(match[1]);
  }
  return names;
}

function sourceFiles(root) {
  const files = [];
  const roots = ["app", "lib", "scripts", "usercontent", "worker"];
  for (const relativeRoot of roots) collect(path.join(root, relativeRoot), files);
  files.push(path.join(root, "cloudflare-env.d.ts"));
  files.push(path.join(root, "wrangler.jsonc"));
  files.push(path.join(root, "wrangler.usercontent.jsonc"));
  return files.filter((filePath) => /\.(?:[cm]?[jt]sx?|jsonc)$/i.test(filePath) || filePath.endsWith(".d.ts"));
}

function collect(directory, files) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".wrangler", ".wrangler-dry-run", ".git"].includes(entry.name)) continue;
      collect(entryPath, files);
    } else {
      files.push(entryPath);
    }
  }
}
