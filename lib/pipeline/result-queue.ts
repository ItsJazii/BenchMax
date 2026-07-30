export async function enqueueEvaluation(runId: string) {
  const { env } = await import("cloudflare:workers");
  await env.EVALUATE_QUEUE.send({
    runId,
    stage: "evaluate",
    stageVersion: "1",
  });
}

export async function enqueueJudge(runId: string) {
  const { env } = await import("cloudflare:workers");
  await env.JUDGE_QUEUE.send({
    runId,
    stage: "judge",
    stageVersion: "1",
  });
}

export async function enqueuePublish(runId: string) {
  const { env } = await import("cloudflare:workers");
  await env.JUDGE_QUEUE.send({
    runId,
    stage: "publish",
    stageVersion: "1",
  });
}
