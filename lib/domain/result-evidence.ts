export type ResultEvidenceVisibility = {
  kind: "source" | "video" | "image" | "log";
  quarantineStatus: string;
};

export function isPublicResultEvidence(
  artifact: Pick<ResultEvidenceVisibility, "kind">,
  sourceVisibility: "public" | "private",
) {
  return artifact.kind !== "source" || sourceVisibility === "public";
}

export function hasApprovedPublicResultEvidence(
  artifacts: ResultEvidenceVisibility[],
  sourceVisibility: "public" | "private",
) {
  return artifacts.some(
    (artifact) =>
      artifact.quarantineStatus === "approved" &&
      isPublicResultEvidence(artifact, sourceVisibility),
  );
}
