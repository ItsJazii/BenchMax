export const DECLARED_RESULT_PROVENANCE_LABEL = "Declared, unverified";

export const declaredResultProvenance = {
  label: DECLARED_RESULT_PROVENANCE_LABEL,
  status: "unverified",
  fields: ["model", "modelVersion", "harness", "reasoning", "settings"],
  note:
    "These configuration details were supplied by the contributor. Benchmax has not independently verified them.",
} as const;
