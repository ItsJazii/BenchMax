import assert from "node:assert/strict";
import test from "node:test";
import { GET as redirectLegacyArtifact } from "../app/api/public/runs/[slug]/artifacts/[artifactId]/route";
import { GET as redirectResultArtifact } from "../app/api/public/results/[slug]/artifacts/[artifactId]/route";
import { publicSecurityHeaders } from "../lib/security/http";
import {
  buildLegacyRunArtifactUrl,
  buildResultArtifactUrl,
  configuredUsercontentOrigin,
} from "../lib/security/usercontent";
import {
  usercontentWorker,
  type UsercontentEnv,
} from "../usercontent/worker";

const artifactId = "01234567-89ab-cdef-0123-456789abcdef";
const sha256 = "a".repeat(64);

type ArtifactRow = {
  object_key: string;
  kind: string;
  content_type: string;
  byte_size: number;
  sha256: string;
};

function testEnv(
  row: ArtifactRow | null,
  options: { objectContentType?: string; objectSize?: number } = {},
) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const body = new TextEncoder().encode("safe evidence");
  const env = {
    BENCHMAX_APP_ORIGIN: "https://benchmax.test",
    DB: {
      prepare(sql: string) {
        const query = { sql, values: [] as unknown[] };
        queries.push(query);
        return {
          bind(...values: unknown[]) {
            query.values = values;
            return this;
          },
          async first<T>() {
            return row as T | null;
          },
        };
      },
    } as unknown as D1Database,
    UPLOADS: {
      async get(key: string) {
        if (!row || key !== row.object_key) return null;
        return {
          arrayBuffer: async () => body.buffer,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(body);
              controller.close();
            },
          }),
          httpMetadata: {
            contentType: options.objectContentType ?? row.content_type,
          },
          size: options.objectSize ?? row.byte_size,
        } as unknown as R2ObjectBody;
      },
    } as unknown as R2Bucket,
  } satisfies UsercontentEnv;
  return { env, queries };
}

test("isolated result evidence requires every publication and visibility gate", async () => {
  const row: ArtifactRow = {
    object_key: "evidence/user/session/proof.png",
    kind: "image",
    content_type: "image/png",
    byte_size: 13,
    sha256,
  };
  const { env, queries } = testEnv(row);
  const response = await usercontentWorker.fetch(
    new Request(
      `https://evidence.benchmaxusercontent.test/results/example-result/artifacts/${artifactId}`,
    ),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "safe evidence");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("content-length"), "13");
  assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "cross-origin",
  );
  assert.match(response.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.equal(response.headers.get("set-cookie"), null);

  const sql = queries[0].sql.replace(/\s+/g, " ");
  assert.match(sql, /s\.status = 'published'/);
  assert.match(sql, /s\.safety_status = 'approved'/);
  assert.match(sql, /a\.quarantine_status = 'approved'/);
  assert.match(sql, /a\.sha256 IS NOT NULL/);
  assert.match(sql, /a\.kind != 'source' OR s\.source_visibility = 'public'/);
  assert.deepEqual(queries[0].values, ["example-result", artifactId]);
});

test("isolated evidence HEAD returns metadata without a response body", async () => {
  const row: ArtifactRow = {
    object_key: "evidence/user/session/proof.webm",
    kind: "video",
    content_type: "video/webm",
    byte_size: 13,
    sha256,
  };
  const { env } = testEnv(row);
  const response = await usercontentWorker.fetch(
    new Request(
      `https://evidence.benchmaxusercontent.test/results/example-result/artifacts/${artifactId}`,
      { method: "HEAD" },
    ),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("content-length"), "13");
  assert.equal(response.headers.get("content-type"), "video/webm");
});

test("private, quarantined, blocked, removed, or unknown result evidence fails closed", async () => {
  const { env } = testEnv(null);
  const response = await usercontentWorker.fetch(
    new Request(
      `https://evidence.benchmaxusercontent.test/results/example-result/artifacts/${artifactId}`,
    ),
    env,
  );
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "Not found.");
});

test("D1 and R2 size or content-type disagreement fails closed", async () => {
  const row: ArtifactRow = {
    object_key: "evidence/user/session/proof.png",
    kind: "image",
    content_type: "image/png",
    byte_size: 13,
    sha256,
  };
  for (const options of [
    { objectSize: 12 },
    { objectContentType: "text/html" },
  ]) {
    const { env } = testEnv(row, options);
    const response = await usercontentWorker.fetch(
      new Request(
        `https://evidence.benchmaxusercontent.test/results/example-result/artifacts/${artifactId}`,
      ),
      env,
    );
    assert.equal(response.status, 404);
  }
});

test("legacy artifact route preserves published archives after account suspension", async () => {
  const row: ArtifactRow = {
    object_key: "runs/archive/evaluation.json",
    kind: "evaluation-report",
    content_type: "application/json",
    byte_size: 13,
    sha256,
  };
  const { env, queries } = testEnv(row);
  const response = await usercontentWorker.fetch(
    new Request(
      `https://evidence.benchmaxusercontent.test/runs/run-abcdef123456/artifacts/${artifactId}`,
    ),
    env,
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /^attachment;/,
  );
  const sql = queries[0].sql.replace(/\s+/g, " ");
  assert.match(sql, /r\.status = 'published'/);
  assert.match(sql, /r\.credential_mode != 'community-submission'/);
  assert.match(sql, /ra\.public = 1/);
  assert.doesNotMatch(sql, /JOIN users|u\.status/);
  assert.deepEqual(queries[0].values, ["run-abcdef123456", artifactId]);
});

test("isolated Worker accepts GET and HEAD only and rejects noncanonical paths", async () => {
  const { env } = testEnv(null);
  const post = await usercontentWorker.fetch(
    new Request("https://evidence.benchmaxusercontent.test/results/x", {
      method: "POST",
    }),
    env,
  );
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");

  for (const path of [
    `/results/example%2fresult/artifacts/${artifactId}`,
    `/results/Example/artifacts/${artifactId}`,
    "/results/example/artifacts/not-a-uuid",
    `/runs/run-nothexvalue/artifacts/${artifactId}`,
    `/results/example/artifacts/${artifactId}/extra`,
  ]) {
    const response = await usercontentWorker.fetch(
      new Request(`https://evidence.benchmaxusercontent.test${path}`),
      env,
    );
    assert.equal(response.status, 404, path);
  }
});

test("public artifact URL builders require a distinct exact HTTPS origin", () => {
  const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://benchmax.test";
  try {
    assert.equal(
      buildResultArtifactUrl(
        "example-result",
        artifactId,
        "https://evidence.benchmaxusercontent.test",
      ),
      `https://evidence.benchmaxusercontent.test/results/example-result/artifacts/${artifactId}`,
    );
    assert.equal(
      buildLegacyRunArtifactUrl(
        "run-abcdef123456",
        artifactId,
        "https://evidence.benchmaxusercontent.test",
      ),
      `https://evidence.benchmaxusercontent.test/runs/run-abcdef123456/artifacts/${artifactId}`,
    );
    assert.equal(configuredUsercontentOrigin("http://evidence.test"), null);
    assert.equal(configuredUsercontentOrigin("https://benchmax.test"), null);
    assert.throws(() =>
      buildResultArtifactUrl("../private", artifactId, "https://evidence.test"),
    );
  } finally {
    if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
  }
});

test("main-app compatibility routes redirect and never stream artifact bytes", async () => {
  const previous = {
    app: process.env.NEXT_PUBLIC_APP_URL,
    usercontent: process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN,
  };
  process.env.NEXT_PUBLIC_APP_URL = "https://benchmax.test";
  process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN =
    "https://evidence.benchmaxusercontent.test";
  try {
    const result = await redirectResultArtifact(
      new Request(
        `https://benchmax.test/api/public/results/example-result/artifacts/${artifactId}`,
      ),
    );
    assert.equal(result.status, 307);
    assert.equal(
      result.headers.get("location"),
      `https://evidence.benchmaxusercontent.test/results/example-result/artifacts/${artifactId}`,
    );
    assert.equal(result.body, null);

    const legacy = await redirectLegacyArtifact(
      new Request(
        `https://benchmax.test/api/public/runs/run-abcdef123456/artifacts/${artifactId}`,
      ),
    );
    assert.equal(legacy.status, 307);
    assert.equal(
      legacy.headers.get("location"),
      `https://evidence.benchmaxusercontent.test/runs/run-abcdef123456/artifacts/${artifactId}`,
    );
    assert.equal(legacy.body, null);
    assert.match(
      publicSecurityHeaders().get("content-security-policy") ?? "",
      /img-src[^;]+https:\/\/evidence\.benchmaxusercontent\.test/,
    );
  } finally {
    for (const [name, value] of [
      ["NEXT_PUBLIC_APP_URL", previous.app],
      ["NEXT_PUBLIC_USERCONTENT_ORIGIN", previous.usercontent],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
