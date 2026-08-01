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

const deployConfig = {
  ...builtConfig,
  name: environment.name,
  d1_databases: environment.d1_databases,
  r2_buckets: environment.r2_buckets,
  queues: environment.queues,
  triggers: environment.triggers,
};

const outputPath = path.join(
  rootDirectory,
  "dist",
  "server",
  `wrangler.${environmentName}.json`,
);
fs.writeFileSync(outputPath, `${JSON.stringify(deployConfig, null, 2)}\n`);
console.log(`Prepared ${path.relative(rootDirectory, outputPath)} for ${environmentName}.`);
