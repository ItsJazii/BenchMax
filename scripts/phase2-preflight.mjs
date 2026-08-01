import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

const mainConfig = JSON.parse(read("wrangler.jsonc"));
const usercontentConfig = JSON.parse(read("wrangler.usercontent.jsonc"));
const databaseIds = [
  mainConfig.d1_databases?.[0]?.database_id,
  usercontentConfig.d1_databases?.[0]?.database_id,
];
assert.equal(databaseIds[0], databaseIds[1], "Workers must share one D1 database");
assert.match(databaseIds[0] ?? "", /^[0-9a-f-]{36}$/i, "D1 database ID is missing or invalid");
assert.notEqual(databaseIds[0], "00000000-0000-4000-8000-000000000000", "placeholder D1 ID remains");

const requiredQueues = new Set([
  "benchmax-evaluate",
  "benchmax-judge",
  "benchmax-pipeline-dlq",
]);

function queueNames(config) {
  return new Set([
    ...(config.queues?.producers ?? []).map((queue) => queue.queue),
    ...(config.queues?.consumers ?? []).map((queue) => queue.queue),
  ]);
}

function assertRequiredQueues(config, label) {
  for (const queue of requiredQueues) {
    assert(queueNames(config).has(queue), `${label} is missing configured queue: ${queue}`);
  }
}

function assertNamedBindings(config, label, { queues }) {
  for (const [environmentName, environment] of Object.entries(config.env ?? {})) {
    assert.equal(environment.d1_databases?.[0]?.binding, "DB", `${label} ${environmentName} must explicitly bind DB`);
    assert.equal(environment.d1_databases?.[0]?.database_id, databaseIds[0], `${label} ${environmentName} must use the shared D1 database`);
    assert.equal(environment.r2_buckets?.[0]?.binding, "UPLOADS", `${label} ${environmentName} must explicitly bind UPLOADS`);
    assert.equal(environment.r2_buckets?.[0]?.bucket_name, "benchmax-uploads", `${label} ${environmentName} must use private uploads`);
    if (queues) assertRequiredQueues(environment, `${label} ${environmentName}`);
  }
}

assertRequiredQueues(mainConfig, "main Worker");

for (const [label, config] of [
  ["main Worker", mainConfig],
  ["user-content Worker", usercontentConfig],
]) {
  assert.equal(config.r2_buckets?.[0]?.bucket_name, "benchmax-uploads", `${label} must bind private uploads`);
  assert(config.env?.staging?.name, `${label} staging name is missing`);
  assert(config.env?.production?.name, `${label} production name is missing`);
  assert.notEqual(config.env.staging.name, config.env.production.name, `${label} environments must be distinct`);
}
assertNamedBindings(mainConfig, "main Worker", { queues: true });
assertNamedBindings(usercontentConfig, "user-content Worker", { queues: false });

const envLines = read(".env.example").split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
const envNames = new Set(envLines.map((line) => line.slice(0, line.indexOf("="))));
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

const workerSource = read("worker/index.ts");
assert(!workerSource.includes("env.IMAGES"), "unconfigured IMAGES binding is still used");
assert(!read("cloudflare-env.d.ts").includes("IMAGES"), "unconfigured IMAGES binding remains typed");

console.log("Phase 2 preflight: config, queue names, environment separation, secret contract, and bindings verified.");
