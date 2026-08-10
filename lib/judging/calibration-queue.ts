export type JudgeCalibrationMessage = {
  actorUserId: string;
  kind: "judge-calibration";
  version: 1;
};

export async function enqueueJudgeCalibration(actorUserId: string) {
  const { env } = await import("cloudflare:workers");
  await env.JUDGE_QUEUE.send({
    actorUserId,
    kind: "judge-calibration",
    version: 1,
  } satisfies JudgeCalibrationMessage);
}

export function isJudgeCalibrationMessage(
  value: unknown,
): value is JudgeCalibrationMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<JudgeCalibrationMessage>;
  return (
    message.kind === "judge-calibration" &&
    message.version === 1 &&
    typeof message.actorUserId === "string" &&
    /^[a-z0-9_-]{1,128}$/i.test(message.actorUserId)
  );
}
