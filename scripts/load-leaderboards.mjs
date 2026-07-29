const baseUrl = process.env.BENCHMAX_LOAD_TARGET;
if (!baseUrl || !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(baseUrl)) {
  throw new Error(
    "BENCHMAX_LOAD_TARGET must be an explicit localhost origin. Remote load testing is disabled by default.",
  );
}
const concurrency = 20;
const requestsPerWorker = 50;
const paths = [
  "/leaderboards?scope=frontend",
  "/leaderboards?scope=overall",
  "/api/runs/catalog",
];
const timings = [];
let failures = 0;
await Promise.all(
  Array.from({ length: concurrency }, async (_, worker) => {
    for (let index = 0; index < requestsPerWorker; index += 1) {
      const path = paths[(worker + index) % paths.length];
      const started = performance.now();
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { Accept: path.startsWith("/api/") ? "application/json" : "text/html" },
      });
      timings.push(performance.now() - started);
      if (!response.ok) failures += 1;
      await response.arrayBuffer();
    }
  }),
);
timings.sort((a, b) => a - b);
const percentile = (fraction) =>
  timings[Math.min(timings.length - 1, Math.floor(timings.length * fraction))];
console.log(
  JSON.stringify({
    requests: timings.length,
    failures,
    p50Ms: Math.round(percentile(0.5)),
    p95Ms: Math.round(percentile(0.95)),
    p99Ms: Math.round(percentile(0.99)),
  }),
);
if (failures > 0) process.exitCode = 1;
