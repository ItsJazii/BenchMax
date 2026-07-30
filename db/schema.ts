import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
};

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    authSubject: text("auth_subject").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", {
      enum: ["owner", "moderator", "contributor"],
    })
      .notNull()
      .default("contributor"),
    status: text("status", { enum: ["active", "suspended", "deleted"] })
      .notNull()
      .default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_auth_subject_uidx").on(table.authSubject),
    uniqueIndex("users_handle_uidx").on(table.handle),
    check("users_handle_length", sql`length(${table.handle}) BETWEEN 3 AND 32`),
    check(
      "users_role_allowed",
      sql`${table.role} IN ('owner', 'moderator', 'contributor')`,
    ),
    check(
      "users_status_allowed",
      sql`${table.status} IN ('active', 'suspended', 'deleted')`,
    ),
  ],
);

export const providers = sqliteTable(
  "providers",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    apiStyle: text("api_style", {
      enum: ["openai-compatible", "anthropic-compatible"],
    }).notNull(),
    endpointOrigin: text("endpoint_origin").notNull(),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("providers_slug_uidx").on(table.slug),
    uniqueIndex("providers_origin_uidx").on(table.endpointOrigin),
    check(
      "providers_api_style_allowed",
      sql`${table.apiStyle} IN ('openai-compatible', 'anthropic-compatible')`,
    ),
    check(
      "providers_status_allowed",
      sql`${table.status} IN ('active', 'disabled')`,
    ),
  ],
);

export const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    providerLabel: text("provider").notNull(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("models_slug_uidx").on(table.slug),
    index("models_provider_idx").on(table.providerId),
    check("models_status_allowed", sql`${table.status} IN ('active', 'archived')`),
  ],
);

export const modelVersions = sqliteTable(
  "model_versions",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "restrict" }),
    versionLabel: text("version_label").notNull(),
    releaseDate: integer("release_date", { mode: "timestamp_ms" }),
    trainingCutoff: integer("training_cutoff", { mode: "timestamp_ms" }),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("model_versions_model_label_uidx").on(
      table.modelId,
      table.versionLabel,
    ),
    index("model_versions_model_idx").on(table.modelId),
  ],
);

export const harnesses = sqliteTable(
  "harnesses",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    loopVersion: text("loop_version").notNull(),
    toolsJson: text("tools_json").notNull(),
    filePolicyJson: text("file_policy_json").notNull(),
    contextBudgetTokens: integer("context_budget_tokens").notNull(),
    turnLimit: integer("turn_limit").notNull(),
    dependencyPolicyJson: text("dependency_policy_json").notNull(),
    contractHash: text("contract_hash").notNull(),
    status: text("status", { enum: ["draft", "active", "retired"] })
      .notNull()
      .default("draft"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("harnesses_slug_version_uidx").on(table.slug, table.version),
    uniqueIndex("harnesses_contract_hash_uidx").on(table.contractHash),
    check("harnesses_version_positive", sql`${table.version} > 0`),
    check(
      "harnesses_context_budget_positive",
      sql`${table.contextBudgetTokens} > 0`,
    ),
    check(
      "harnesses_turn_limit_bounded",
      sql`${table.turnLimit} BETWEEN 1 AND 100`,
    ),
    check(
      "harnesses_status_allowed",
      sql`${table.status} IN ('draft', 'active', 'retired')`,
    ),
  ],
);

export const benchmarks = sqliteTable(
  "benchmarks",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    goal: text("goal"),
    successCriteriaJson: text("success_criteria_json").notNull().default("[]"),
    category: text("category", {
      enum: ["frontend", "browser-game", "browser-3d"],
    }).notNull(),
    status: text("status", { enum: ["draft", "active", "retired"] })
      .notNull()
      .default("draft"),
    rubricStatus: text("rubric_status", {
      enum: ["drafting", "awaiting_approval", "approved"],
    })
      .notNull()
      .default("drafting"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("benchmarks_slug_uidx").on(table.slug),
    index("benchmarks_category_status_idx").on(table.category, table.status),
    index("benchmarks_creator_idx").on(table.creatorId, table.createdAt),
    check(
      "benchmarks_category_allowed",
      sql`${table.category} IN ('frontend', 'browser-game', 'browser-3d')`,
    ),
    check(
      "benchmarks_status_allowed",
      sql`${table.status} IN ('draft', 'active', 'retired')`,
    ),
    check(
      "benchmarks_rubric_status_allowed",
      sql`${table.rubricStatus} IN ('drafting', 'awaiting_approval', 'approved')`,
    ),
  ],
);

export const benchmarkVersions = sqliteTable(
  "benchmark_versions",
  {
    id: text("id").primaryKey(),
    benchmarkId: text("benchmark_id")
      .notNull()
      .references(() => benchmarks.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    canonicalPrompt: text("canonical_prompt").notNull(),
    rubricJson: text("rubric_json").notNull(),
    harnessId: text("harness_id")
      .notNull()
      .references(() => harnesses.id, { onDelete: "restrict" }),
    harnessContractJson: text("harness_contract_json").notNull(),
    environmentHash: text("environment_hash").notNull(),
    objectiveWeightBps: integer("objective_weight_bps")
      .notNull()
      .default(6000),
    judgeWeightBps: integer("judge_weight_bps").notNull().default(4000),
    attemptPolicy: text("attempt_policy", {
      enum: ["pass@1", "pass@k"],
    })
      .notNull()
      .default("pass@1"),
    attemptCount: integer("attempt_count").notNull().default(1),
    dependencyLockHash: text("dependency_lock_hash").notNull(),
    interactionScriptHash: text("interaction_script_hash").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("benchmark_versions_benchmark_version_uidx").on(
      table.benchmarkId,
      table.version,
    ),
    index("benchmark_versions_published_idx").on(table.publishedAt),
    index("benchmark_versions_harness_idx").on(table.harnessId),
    check(
      "benchmark_versions_weights_total",
      sql`${table.objectiveWeightBps} + ${table.judgeWeightBps} = 10000`,
    ),
    check(
      "benchmark_versions_weights_bounded",
      sql`${table.objectiveWeightBps} BETWEEN 0 AND 10000 AND ${table.judgeWeightBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "benchmark_versions_attempt_policy_allowed",
      sql`${table.attemptPolicy} IN ('pass@1', 'pass@k')`,
    ),
    check(
      "benchmark_versions_attempt_count_bounded",
      sql`${table.attemptCount} BETWEEN 1 AND 10`,
    ),
  ],
);

export const catalogRequests = sqliteTable(
  "catalog_requests",
  {
    id: text("id").primaryKey(),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["model", "model-version", "harness"] })
      .notNull(),
    requestedLabel: text("requested_label").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    status: text("status", {
      enum: ["pending", "approved", "mapped", "rejected"],
    })
      .notNull()
      .default("pending"),
    mappedEntityId: text("mapped_entity_id"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    index("catalog_requests_status_idx").on(table.status, table.createdAt),
    index("catalog_requests_requester_idx").on(
      table.requesterUserId,
      table.createdAt,
    ),
    check(
      "catalog_requests_kind_allowed",
      sql`${table.kind} IN ('model', 'model-version', 'harness')`,
    ),
    check(
      "catalog_requests_status_allowed",
      sql`${table.status} IN ('pending', 'approved', 'mapped', 'rejected')`,
    ),
  ],
);

export const resultConfigurations = sqliteTable(
  "result_configurations",
  {
    id: text("id").primaryKey(),
    modelVersionId: text("model_version_id").references(
      () => modelVersions.id,
      { onDelete: "set null" },
    ),
    harnessId: text("harness_id").references(() => harnesses.id, {
      onDelete: "set null",
    }),
    modelLabel: text("model_label").notNull(),
    modelVersionLabel: text("model_version_label").notNull(),
    harnessLabel: text("harness_label").notNull(),
    reasoningRaw: text("reasoning_raw").notNull(),
    reasoningNormalized: text("reasoning_normalized", {
      enum: ["none", "low", "medium", "high", "max", "unknown"],
    }).notNull(),
    declaredSettingsJson: text("declared_settings_json").notNull().default("{}"),
    metadataHash: text("metadata_hash").notNull(),
    catalogStatus: text("catalog_status", {
      enum: ["canonical", "pending"],
    })
      .notNull()
      .default("pending"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("result_configurations_hash_uidx").on(table.metadataHash),
    index("result_configurations_catalog_idx").on(
      table.catalogStatus,
      table.modelVersionId,
      table.harnessId,
    ),
    check(
      "result_configurations_reasoning_allowed",
      sql`${table.reasoningNormalized} IN ('none', 'low', 'medium', 'high', 'max', 'unknown')`,
    ),
    check(
      "result_configurations_catalog_status_allowed",
      sql`${table.catalogStatus} IN ('canonical', 'pending')`,
    ),
  ],
);

export const showcases = sqliteTable(
  "showcases",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    category: text("category", {
      enum: ["frontend", "browser-game", "browser-3d", "other"],
    }).notNull(),
    benchmarkVersionId: text("benchmark_version_id").references(
      () => benchmarkVersions.id,
      { onDelete: "restrict" },
    ),
    resultConfigurationId: text("result_configuration_id").references(
      () => resultConfigurations.id,
      { onDelete: "restrict" },
    ),
    modelVersionId: text("model_version_id").references(() => modelVersions.id, {
      onDelete: "set null",
    }),
    modelLabel: text("model_label").notNull(),
    harness: text("harness").notNull(),
    reasoningLevel: text("reasoning_level").notNull(),
    prompt: text("prompt").notNull(),
    systemPrompt: text("system_prompt"),
    status: text("status", {
      enum: ["draft", "published", "rejected", "removed"],
    })
      .notNull()
      .default("draft"),
    safetyStatus: text("safety_status", {
      enum: ["pending", "scanning", "approved", "blocked"],
    })
      .notNull()
      .default("pending"),
    judgeStatus: text("judge_status", {
      enum: [
        "not_queued",
        "queued",
        "evaluating",
        "judging",
        "scored",
        "unranked",
        "overdue",
        "failed",
      ],
    })
      .notNull()
      .default("not_queued"),
    rankingStatus: text("ranking_status", {
      enum: [
        "pending",
        "eligible",
        "catalog_pending",
        "insufficient_evidence",
        "moderation_hold",
        "superseded",
        "ineligible",
      ],
    })
      .notNull()
      .default("pending"),
    judgeDueAt: integer("judge_due_at", { mode: "timestamp_ms" }),
    supersededById: text("superseded_by_id"),
    sourceVisibility: text("source_visibility", {
      enum: ["public", "private"],
    })
      .notNull()
      .default("public"),
    rightsAttestedAt: integer("rights_attested_at", { mode: "timestamp_ms" }),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("showcases_slug_uidx").on(table.slug),
    index("showcases_public_feed_idx").on(
      table.status,
      table.safetyStatus,
      table.publishedAt,
    ),
    index("showcases_owner_idx").on(table.ownerId, table.updatedAt),
    check("showcases_title_length", sql`length(${table.title}) BETWEEN 8 AND 120`),
    check(
      "showcases_summary_length",
      sql`length(${table.summary}) BETWEEN 24 AND 800`,
    ),
    check(
      "showcases_category_allowed",
      sql`${table.category} IN ('frontend', 'browser-game', 'browser-3d', 'other')`,
    ),
    check(
      "showcases_status_allowed",
      sql`${table.status} IN ('draft', 'published', 'rejected', 'removed')`,
    ),
    check(
      "showcases_safety_status_allowed",
      sql`${table.safetyStatus} IN ('pending', 'scanning', 'approved', 'blocked')`,
    ),
    check(
      "showcases_source_visibility_allowed",
      sql`${table.sourceVisibility} IN ('public', 'private')`,
    ),
    check(
      "showcases_judge_status_allowed",
      sql`${table.judgeStatus} IN ('not_queued', 'queued', 'evaluating', 'judging', 'scored', 'unranked', 'overdue', 'failed')`,
    ),
    check(
      "showcases_ranking_status_allowed",
      sql`${table.rankingStatus} IN ('pending', 'eligible', 'catalog_pending', 'insufficient_evidence', 'moderation_hold', 'superseded', 'ineligible')`,
    ),
  ],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    showcaseId: text("showcase_id")
      .notNull()
      .references(() => showcases.id, { onDelete: "cascade" }),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind", {
      enum: ["source", "video", "image", "log"],
    }).notNull(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256"),
    quarantineStatus: text("quarantine_status", {
      enum: ["awaiting-upload", "quarantined", "scanning", "approved", "blocked"],
    })
      .notNull()
      .default("awaiting-upload"),
    scanReportJson: text("scan_report_json"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("artifacts_object_key_uidx").on(table.objectKey),
    index("artifacts_showcase_status_idx").on(
      table.showcaseId,
      table.quarantineStatus,
    ),
    check("artifacts_size_positive", sql`${table.byteSize} > 0`),
    check(
      "artifacts_kind_allowed",
      sql`${table.kind} IN ('source', 'video', 'image', 'log')`,
    ),
    check(
      "artifacts_quarantine_status_allowed",
      sql`${table.quarantineStatus} IN ('awaiting-upload', 'quarantined', 'scanning', 'approved', 'blocked')`,
    ),
  ],
);

export const uploadSessions = sqliteTable(
  "upload_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    showcaseId: text("showcase_id").references(() => showcases.id, {
      onDelete: "cascade",
    }),
    artifactKind: text("artifact_kind", {
      enum: ["source", "video", "image", "log"],
    }).notNull(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    expectedBytes: integer("expected_bytes").notNull(),
    tokenDigest: text("token_digest").notNull(),
    status: text("status", {
      enum: ["created", "uploading", "uploaded", "expired", "cancelled"],
    })
      .notNull()
      .default("created"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    quarantineCleanedAt: integer("quarantine_cleaned_at", {
      mode: "timestamp_ms",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("upload_sessions_object_key_uidx").on(table.objectKey),
    uniqueIndex("upload_sessions_token_digest_uidx").on(table.tokenDigest),
    index("upload_sessions_user_status_idx").on(table.userId, table.status),
    index("upload_sessions_expiry_idx").on(table.expiresAt),
    check(
      "upload_sessions_artifact_kind_allowed",
      sql`${table.artifactKind} IN ('source', 'video', 'image', 'log')`,
    ),
    check(
      "upload_sessions_status_allowed",
      sql`${table.status} IN ('created', 'uploading', 'uploaded', 'expired', 'cancelled')`,
    ),
    check(
      "upload_sessions_expected_bytes_positive",
      sql`${table.expectedBytes} > 0`,
    ),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("audit_events_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("audit_events_actor_idx").on(table.actorUserId, table.createdAt),
  ],
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    id: text("id").primaryKey(),
    action: text("action").notNull(),
    subjectHash: text("subject_hash").notNull(),
    windowStartedAt: integer("window_started_at", {
      mode: "timestamp_ms",
    }).notNull(),
    count: integer("count").notNull().default(1),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("rate_limits_expiry_idx").on(table.expiresAt),
    index("rate_limits_subject_action_idx").on(table.subjectHash, table.action),
    check("rate_limits_count_positive", sql`${table.count} > 0`),
  ],
);

export const abuseReports = sqliteTable(
  "abuse_reports",
  {
    id: text("id").primaryKey(),
    reporterUserId: text("reporter_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    showcaseId: text("showcase_id").references(() => showcases.id, {
      onDelete: "cascade",
    }),
    runId: text("run_id").references(() => runs.id, {
      onDelete: "cascade",
    }),
    reason: text("reason", {
      enum: ["malware", "copyright", "fraud", "harassment", "other"],
    }).notNull(),
    details: text("details").notNull(),
    status: text("status", {
      enum: ["open", "reviewing", "resolved", "dismissed"],
    })
      .notNull()
      .default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("abuse_reports_status_idx").on(table.status, table.createdAt),
    index("abuse_reports_showcase_idx").on(table.showcaseId),
    index("abuse_reports_run_idx").on(table.runId),
    check(
      "abuse_reports_exactly_one_target",
      sql`(${table.showcaseId} IS NOT NULL AND ${table.runId} IS NULL) OR (${table.showcaseId} IS NULL AND ${table.runId} IS NOT NULL)`,
    ),
    check(
      "abuse_reports_details_length",
      sql`length(${table.details}) BETWEEN 10 AND 2000`,
    ),
    check(
      "abuse_reports_reason_allowed",
      sql`${table.reason} IN ('malware', 'copyright', 'fraud', 'harassment', 'other')`,
    ),
    check(
      "abuse_reports_status_allowed",
      sql`${table.status} IN ('open', 'reviewing', 'resolved', 'dismissed')`,
    ),
  ],
);

export const configurations = sqliteTable(
  "configurations",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
    modelVersionId: text("model_version_id")
      .notNull()
      .references(() => modelVersions.id, { onDelete: "restrict" }),
    harnessId: text("harness_id")
      .notNull()
      .references(() => harnesses.id, { onDelete: "restrict" }),
    endpointName: text("endpoint_name").notNull(),
    providerModelId: text("provider_model_id").notNull(),
    reasoningLevel: text("reasoning_level", {
      enum: ["low", "medium", "high", "max"],
    }).notNull(),
    samplingSettingsJson: text("sampling_settings_json").notNull(),
    settingsHash: text("settings_hash").notNull(),
    maxOutputTokens: integer("max_output_tokens").notNull(),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("configurations_exact_uidx").on(
      table.providerId,
      table.modelVersionId,
      table.harnessId,
      table.endpointName,
      table.reasoningLevel,
      table.settingsHash,
    ),
    index("configurations_model_idx").on(table.modelVersionId, table.status),
    check(
      "configurations_reasoning_allowed",
      sql`${table.reasoningLevel} IN ('low', 'medium', 'high', 'max')`,
    ),
    check(
      "configurations_output_tokens_bounded",
      sql`${table.maxOutputTokens} BETWEEN 1 AND 200000`,
    ),
    check(
      "configurations_status_allowed",
      sql`${table.status} IN ('active', 'disabled')`,
    ),
  ],
);

export const rubricDimensions = sqliteTable(
  "rubric_dimensions",
  {
    id: text("id").primaryKey(),
    benchmarkVersionId: text("benchmark_version_id")
      .notNull()
      .references(() => benchmarkVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    mechanism: text("mechanism", {
      enum: ["objective", "judge", "hybrid"],
    }).notNull(),
    weightBps: integer("weight_bps").notNull(),
    judgeSourceRequired: integer("judge_source_required", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    ordinal: integer("ordinal").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("rubric_dimensions_version_key_uidx").on(
      table.benchmarkVersionId,
      table.key,
    ),
    uniqueIndex("rubric_dimensions_version_ordinal_uidx").on(
      table.benchmarkVersionId,
      table.ordinal,
    ),
    check(
      "rubric_dimensions_mechanism_allowed",
      sql`${table.mechanism} IN ('objective', 'judge', 'hybrid')`,
    ),
    check(
      "rubric_dimensions_weight_bounded",
      sql`${table.weightBps} BETWEEN 1 AND 10000`,
    ),
  ],
);

export const evaluationVersions = sqliteTable(
  "evaluation_versions",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull(),
    judgeProvider: text("judge_provider").notNull(),
    judgeModel: text("judge_model").notNull(),
    judgeModelVersion: text("judge_model_version").notNull(),
    endpointOrigin: text("endpoint_origin").notNull(),
    promptTemplate: text("prompt_template").notNull(),
    promptTemplateHash: text("prompt_template_hash").notNull(),
    rubricProtocolVersion: text("rubric_protocol_version").notNull(),
    sampleCount: integer("sample_count").notNull().default(3),
    maxTokensPerSample: integer("max_tokens_per_sample").notNull(),
    calibrationSetHash: text("calibration_set_hash").notNull(),
    driftThresholdBps: integer("drift_threshold_bps").notNull(),
    status: text("status", { enum: ["draft", "active", "frozen", "retired"] })
      .notNull()
      .default("draft"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("evaluation_versions_version_uidx").on(table.version),
    uniqueIndex("evaluation_versions_prompt_hash_uidx").on(
      table.promptTemplateHash,
      table.rubricProtocolVersion,
    ),
    check(
      "evaluation_versions_samples_three",
      sql`${table.sampleCount} = 3`,
    ),
    check(
      "evaluation_versions_token_cap_positive",
      sql`${table.maxTokensPerSample} > 0`,
    ),
    check(
      "evaluation_versions_drift_bounded",
      sql`${table.driftThresholdBps} BETWEEN 1 AND 10000`,
    ),
    check(
      "evaluation_versions_status_allowed",
      sql`${table.status} IN ('draft', 'active', 'frozen', 'retired')`,
    ),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    publicSlug: text("public_slug").notNull(),
    contributorId: text("contributor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    benchmarkVersionId: text("benchmark_version_id")
      .notNull()
      .references(() => benchmarkVersions.id, { onDelete: "restrict" }),
    configurationId: text("configuration_id")
      .notNull()
      .references(() => configurations.id, { onDelete: "restrict" }),
    evaluationVersionId: text("evaluation_version_id")
      .notNull()
      .references(() => evaluationVersions.id, { onDelete: "restrict" }),
    credentialMode: text("credential_mode", {
      enum: ["byok", "platform-credit", "community-submission"],
    }).notNull(),
    showcaseId: text("showcase_id").references(() => showcases.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: [
        "draft",
        "queued_generation",
        "generating",
        "generated",
        "queued_evaluation",
        "evaluating",
        "judging",
        "scored",
        "published",
        "generation_failed",
        "evaluation_failed",
        "disqualified",
      ],
    })
      .notNull()
      .default("draft"),
    attemptIndex: integer("attempt_index").notNull().default(1),
    passGroupId: text("pass_group_id"),
    environmentHash: text("environment_hash").notNull(),
    harnessContractHash: text("harness_contract_hash").notNull(),
    overallScoreBps: integer("overall_score_bps"),
    rankEligible: integer("rank_eligible", { mode: "boolean" })
      .notNull()
      .default(false),
    injectionFlag: integer("injection_flag", { mode: "boolean" })
      .notNull()
      .default(false),
    postPublicationMarker: integer("post_publication_marker", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    playableEnabled: integer("playable_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    outputContentHash: text("output_content_hash"),
    failureCode: text("failure_code"),
    failureSummary: text("failure_summary"),
    generatedAt: integer("generated_at", { mode: "timestamp_ms" }),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp_ms" }),
    scoredAt: integer("scored_at", { mode: "timestamp_ms" }),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("runs_public_slug_uidx").on(table.publicSlug),
    uniqueIndex("runs_showcase_uidx").on(table.showcaseId),
    uniqueIndex("runs_pass_attempt_uidx").on(
      table.passGroupId,
      table.attemptIndex,
    ),
    index("runs_owner_status_idx").on(table.contributorId, table.status),
    index("runs_rank_idx").on(
      table.benchmarkVersionId,
      table.configurationId,
      table.status,
      table.rankEligible,
    ),
    index("runs_lifecycle_idx").on(table.status, table.updatedAt),
    check(
      "runs_credential_mode_allowed",
      sql`${table.credentialMode} IN ('byok', 'platform-credit', 'community-submission')`,
    ),
    check(
      "runs_status_allowed",
      sql`${table.status} IN ('draft', 'queued_generation', 'generating', 'generated', 'queued_evaluation', 'evaluating', 'judging', 'scored', 'published', 'generation_failed', 'evaluation_failed', 'disqualified')`,
    ),
    check("runs_attempt_positive", sql`${table.attemptIndex} > 0`),
    check(
      "runs_score_bounded",
      sql`${table.overallScoreBps} IS NULL OR ${table.overallScoreBps} BETWEEN 0 AND 10000`,
    ),
  ],
);

export const generationRecords = sqliteTable(
  "generation_records",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    requestHash: text("request_hash").notNull(),
    responseHash: text("response_hash").notNull(),
    provenanceHash: text("provenance_hash").notNull(),
    encryptedEnvelopeObjectKey: text("encrypted_envelope_object_key").notNull(),
    encryptedEnvelopeSha256: text("encrypted_envelope_sha256").notNull(),
    redactedTranscript: text("redacted_transcript").notNull(),
    providerRequestId: text("provider_request_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms").notNull(),
    harnessTurnCount: integer("harness_turn_count").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("generation_records_run_uidx").on(table.runId),
    uniqueIndex("generation_records_provenance_uidx").on(table.provenanceHash),
    check(
      "generation_records_duration_nonnegative",
      sql`${table.durationMs} >= 0`,
    ),
    check(
      "generation_records_turns_positive",
      sql`${table.harnessTurnCount} > 0`,
    ),
  ],
);

export const runArtifacts = sqliteTable(
  "run_artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "generated-source",
        "build-log",
        "run-log",
        "screenshot",
        "video",
        "bundle",
        "evaluation-report",
      ],
    }).notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    public: integer("public", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("run_artifacts_object_key_uidx").on(table.objectKey),
    uniqueIndex("run_artifacts_run_kind_hash_uidx").on(
      table.runId,
      table.kind,
      table.sha256,
    ),
    index("run_artifacts_run_idx").on(table.runId, table.kind),
    check("run_artifacts_size_positive", sql`${table.byteSize} > 0`),
    check(
      "run_artifacts_kind_allowed",
      sql`${table.kind} IN ('generated-source', 'build-log', 'run-log', 'screenshot', 'video', 'bundle', 'evaluation-report')`,
    ),
  ],
);

export const runStageClaims = sqliteTable(
  "run_stage_claims",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stage: text("stage", {
      enum: ["generate-platform", "evaluate", "judge", "publish"],
    }).notNull(),
    stageVersion: text("stage_version").notNull(),
    status: text("status", {
      enum: ["claimed", "completed", "failed"],
    })
      .notNull()
      .default("claimed"),
    attemptCount: integer("attempt_count").notNull().default(1),
    leaseExpiresAt: integer("lease_expires_at", {
      mode: "timestamp_ms",
    }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    errorCode: text("error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("run_stage_claims_idempotency_uidx").on(
      table.runId,
      table.stage,
      table.stageVersion,
    ),
    index("run_stage_claims_lease_idx").on(table.status, table.leaseExpiresAt),
    check(
      "run_stage_claims_stage_allowed",
      sql`${table.stage} IN ('generate-platform', 'evaluate', 'judge', 'publish')`,
    ),
    check(
      "run_stage_claims_status_allowed",
      sql`${table.status} IN ('claimed', 'completed', 'failed')`,
    ),
    check(
      "run_stage_claims_attempts_positive",
      sql`${table.attemptCount} > 0`,
    ),
  ],
);

export const objectiveResults = sqliteTable(
  "objective_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    dimensionKey: text("dimension_key").notNull(),
    checkKey: text("check_key").notNull(),
    status: text("status", { enum: ["pass", "fail", "error"] }).notNull(),
    scoreBps: integer("score_bps").notNull(),
    metricValueJson: text("metric_value_json").notNull(),
    evidenceArtifactId: text("evidence_artifact_id").references(
      () => runArtifacts.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("objective_results_run_check_uidx").on(
      table.runId,
      table.checkKey,
    ),
    index("objective_results_run_dimension_idx").on(
      table.runId,
      table.dimensionKey,
    ),
    check(
      "objective_results_status_allowed",
      sql`${table.status} IN ('pass', 'fail', 'error')`,
    ),
    check(
      "objective_results_score_bounded",
      sql`${table.scoreBps} BETWEEN 0 AND 10000`,
    ),
  ],
);

export const judgeSamples = sqliteTable(
  "judge_samples",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    evaluationVersionId: text("evaluation_version_id")
      .notNull()
      .references(() => evaluationVersions.id, { onDelete: "restrict" }),
    sampleIndex: integer("sample_index").notNull(),
    structuredOutputJson: text("structured_output_json").notNull(),
    responseHash: text("response_hash").notNull(),
    injectionFlag: integer("injection_flag", { mode: "boolean" })
      .notNull()
      .default(false),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("judge_samples_run_index_uidx").on(
      table.runId,
      table.evaluationVersionId,
      table.sampleIndex,
    ),
    check(
      "judge_samples_index_three",
      sql`${table.sampleIndex} BETWEEN 1 AND 3`,
    ),
    check(
      "judge_samples_duration_nonnegative",
      sql`${table.durationMs} >= 0`,
    ),
  ],
);

export const dimensionScores = sqliteTable(
  "dimension_scores",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    rubricDimensionId: text("rubric_dimension_id")
      .notNull()
      .references(() => rubricDimensions.id, { onDelete: "restrict" }),
    objectiveScoreBps: integer("objective_score_bps"),
    judgeMedianScoreBps: integer("judge_median_score_bps"),
    originalCombinedScoreBps: integer("original_combined_score_bps").notNull(),
    adjustedCombinedScoreBps: integer("adjusted_combined_score_bps"),
    overrideActionId: text("override_action_id"),
    reasoning: text("reasoning").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("dimension_scores_run_dimension_uidx").on(
      table.runId,
      table.rubricDimensionId,
    ),
    check(
      "dimension_scores_original_bounded",
      sql`${table.originalCombinedScoreBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "dimension_scores_adjusted_bounded",
      sql`${table.adjustedCombinedScoreBps} IS NULL OR ${table.adjustedCombinedScoreBps} BETWEEN 0 AND 10000`,
    ),
  ],
);

export const leaderboardSnapshots = sqliteTable(
  "leaderboard_snapshots",
  {
    id: text("id").primaryKey(),
    benchmarkVersionId: text("benchmark_version_id")
      .notNull()
      .references(() => benchmarkVersions.id, { onDelete: "restrict" }),
    evaluationVersionId: text("evaluation_version_id")
      .notNull()
      .references(() => evaluationVersions.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    runSetHash: text("run_set_hash").notNull(),
    status: text("status", { enum: ["building", "published", "superseded"] })
      .notNull()
      .default("building"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("leaderboard_snapshots_version_uidx").on(
      table.benchmarkVersionId,
      table.evaluationVersionId,
      table.version,
    ),
    uniqueIndex("leaderboard_snapshots_run_set_uidx").on(
      table.benchmarkVersionId,
      table.evaluationVersionId,
      table.runSetHash,
    ),
    index("leaderboard_snapshots_public_idx").on(
      table.benchmarkVersionId,
      table.status,
      table.publishedAt,
    ),
    check(
      "leaderboard_snapshots_status_allowed",
      sql`${table.status} IN ('building', 'published', 'superseded')`,
    ),
  ],
);

export const leaderboardEntries = sqliteTable(
  "leaderboard_entries",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => leaderboardSnapshots.id, { onDelete: "cascade" }),
    configurationId: text("configuration_id")
      .notNull()
      .references(() => configurations.id, { onDelete: "restrict" }),
    rank: integer("rank").notNull(),
    medianScoreBps: integer("median_score_bps").notNull(),
    q1ScoreBps: integer("q1_score_bps").notNull(),
    q3ScoreBps: integer("q3_score_bps").notNull(),
    runCount: integer("run_count").notNull(),
    provisional: integer("provisional", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("leaderboard_entries_snapshot_config_uidx").on(
      table.snapshotId,
      table.configurationId,
    ),
    uniqueIndex("leaderboard_entries_snapshot_rank_uidx").on(
      table.snapshotId,
      table.rank,
    ),
    check("leaderboard_entries_rank_positive", sql`${table.rank} > 0`),
    check(
      "leaderboard_entries_scores_bounded",
      sql`${table.medianScoreBps} BETWEEN 0 AND 10000 AND ${table.q1ScoreBps} BETWEEN 0 AND 10000 AND ${table.q3ScoreBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "leaderboard_entries_quartile_order",
      sql`${table.q1ScoreBps} <= ${table.medianScoreBps} AND ${table.medianScoreBps} <= ${table.q3ScoreBps}`,
    ),
    check(
      "leaderboard_entries_run_count_positive",
      sql`${table.runCount} > 0`,
    ),
  ],
);

export const aggregateLeaderboardSnapshots = sqliteTable(
  "aggregate_leaderboard_snapshots",
  {
    id: text("id").primaryKey(),
    scope: text("scope", {
      enum: ["frontend", "browser-game", "browser-3d", "overall"],
    }).notNull(),
    evaluationVersionId: text("evaluation_version_id")
      .notNull()
      .references(() => evaluationVersions.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    runSetHash: text("run_set_hash").notNull(),
    status: text("status", { enum: ["building", "published", "superseded"] })
      .notNull()
      .default("building"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("aggregate_snapshots_scope_version_uidx").on(
      table.scope,
      table.evaluationVersionId,
      table.version,
    ),
    uniqueIndex("aggregate_snapshots_scope_run_set_uidx").on(
      table.scope,
      table.evaluationVersionId,
      table.runSetHash,
    ),
    index("aggregate_snapshots_public_idx").on(
      table.scope,
      table.status,
      table.publishedAt,
    ),
    check(
      "aggregate_snapshots_scope_allowed",
      sql`${table.scope} IN ('frontend', 'browser-game', 'browser-3d', 'overall')`,
    ),
    check(
      "aggregate_snapshots_status_allowed",
      sql`${table.status} IN ('building', 'published', 'superseded')`,
    ),
  ],
);

export const aggregateLeaderboardEntries = sqliteTable(
  "aggregate_leaderboard_entries",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => aggregateLeaderboardSnapshots.id, {
        onDelete: "cascade",
      }),
    configurationId: text("configuration_id")
      .notNull()
      .references(() => configurations.id, { onDelete: "restrict" }),
    rank: integer("rank").notNull(),
    scoreBps: integer("score_bps").notNull(),
    benchmarkCoverage: integer("benchmark_coverage").notNull(),
    categoryCoverage: integer("category_coverage").notNull(),
    totalRunCount: integer("total_run_count").notNull(),
    provisional: integer("provisional", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("aggregate_entries_snapshot_config_uidx").on(
      table.snapshotId,
      table.configurationId,
    ),
    uniqueIndex("aggregate_entries_snapshot_rank_uidx").on(
      table.snapshotId,
      table.rank,
    ),
    check("aggregate_entries_rank_positive", sql`${table.rank} > 0`),
    check(
      "aggregate_entries_score_bounded",
      sql`${table.scoreBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "aggregate_entries_coverage_nonnegative",
      sql`${table.benchmarkCoverage} >= 0 AND ${table.categoryCoverage} >= 0 AND ${table.totalRunCount} > 0`,
    ),
  ],
);

export const creditLedger = sqliteTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    type: text("type", {
      enum: ["admin-grant", "reserve", "generation-charge", "judge-charge", "sandbox-charge", "refund", "adjustment"],
    }).notNull(),
    amountMilliCredits: integer("amount_milli_credits").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("credit_ledger_idempotency_uidx").on(table.idempotencyKey),
    index("credit_ledger_user_idx").on(table.userId, table.createdAt),
    index("credit_ledger_run_idx").on(table.runId, table.createdAt),
    check(
      "credit_ledger_type_allowed",
      sql`${table.type} IN ('admin-grant', 'reserve', 'generation-charge', 'judge-charge', 'sandbox-charge', 'refund', 'adjustment')`,
    ),
    check(
      "credit_ledger_amount_nonzero",
      sql`${table.amountMilliCredits} <> 0`,
    ),
  ],
);

export const moderationActions = sqliteTable(
  "moderation_actions",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    entityType: text("entity_type", {
      enum: ["showcase", "run", "abuse-report", "dispute"],
    }).notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action", {
      enum: ["flag", "unpublish", "restore", "disqualify", "resolve", "dismiss", "score-override"],
    }).notNull(),
    reason: text("reason").notNull(),
    previousStateJson: text("previous_state_json").notNull(),
    nextStateJson: text("next_state_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("moderation_actions_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    check(
      "moderation_actions_entity_allowed",
      sql`${table.entityType} IN ('showcase', 'run', 'abuse-report', 'dispute')`,
    ),
    check(
      "moderation_actions_action_allowed",
      sql`${table.action} IN ('flag', 'unpublish', 'restore', 'disqualify', 'resolve', 'dismiss', 'score-override')`,
    ),
    check(
      "moderation_actions_reason_length",
      sql`length(${table.reason}) BETWEEN 10 AND 2000`,
    ),
  ],
);

export const disputes = sqliteTable(
  "disputes",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    openedByUserId: text("opened_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    status: text("status", {
      enum: ["open", "reviewing", "resolved", "dismissed"],
    })
      .notNull()
      .default("open"),
    resolution: text("resolution"),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    index("disputes_status_idx").on(table.status, table.createdAt),
    index("disputes_run_idx").on(table.runId, table.createdAt),
    check(
      "disputes_status_allowed",
      sql`${table.status} IN ('open', 'reviewing', 'resolved', 'dismissed')`,
    ),
    check(
      "disputes_reason_length",
      sql`length(${table.reason}) BETWEEN 20 AND 4000`,
    ),
  ],
);

export const benchmarkProposals = sqliteTable(
  "benchmark_proposals",
  {
    id: text("id").primaryKey(),
    proposerUserId: text("proposer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    category: text("category", {
      enum: ["frontend", "browser-game", "browser-3d"],
    }).notNull(),
    specificationJson: text("specification_json").notNull(),
    status: text("status", {
      enum: ["draft", "submitted", "approved", "rejected"],
    })
      .notNull()
      .default("draft"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewReason: text("review_reason"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    index("benchmark_proposals_status_idx").on(table.status, table.createdAt),
    check(
      "benchmark_proposals_category_allowed",
      sql`${table.category} IN ('frontend', 'browser-game', 'browser-3d')`,
    ),
    check(
      "benchmark_proposals_status_allowed",
      sql`${table.status} IN ('draft', 'submitted', 'approved', 'rejected')`,
    ),
    check(
      "benchmark_proposals_title_length",
      sql`length(${table.title}) BETWEEN 8 AND 120`,
    ),
  ],
);
