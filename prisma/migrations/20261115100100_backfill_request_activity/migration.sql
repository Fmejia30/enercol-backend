UPDATE "post_sale_request" AS request
SET "status" = CASE latest.status
  WHEN 'APPROVED' THEN 'REPORT_APPROVED'::"post_sale_request_status"
  WHEN 'PENDING_VALIDATION' THEN 'PENDING_VALIDATION'::"post_sale_request_status"
  WHEN 'UNDER_REVIEW' THEN 'PENDING_VALIDATION'::"post_sale_request_status"
  WHEN 'CHANGES_REQUESTED' THEN 'REPORT_CHANGES_REQUESTED'::"post_sale_request_status"
  WHEN 'REANALYSIS_REQUIRED' THEN 'REANALYSIS_REQUIRED'::"post_sale_request_status"
  WHEN 'DRAFT' THEN 'REPORT_DRAFT'::"post_sale_request_status"
  ELSE request.status
END
FROM (
  SELECT DISTINCT ON ("post_sale_request_id") "post_sale_request_id", "status"
  FROM "technical_report"
  ORDER BY "post_sale_request_id", "version" DESC
) AS latest
WHERE request.id = latest.post_sale_request_id;

UPDATE "post_sale_request"
SET "status" = 'IN_ANALYSIS'
WHERE "status" IN ('ABIERTA', 'RECEIVED', 'ASSIGNED', 'EN_ANALISIS')
  AND EXISTS (
    SELECT 1 FROM "technical_analysis"
    WHERE "technical_analysis"."post_sale_request_id" = "post_sale_request"."id"
      AND "technical_analysis"."status" = 'SUCCEEDED'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "technical_report"
    WHERE "technical_report"."post_sale_request_id" = "post_sale_request"."id"
  );

UPDATE "post_sale_request"
SET "status" = 'ASSIGNED'
WHERE "status" = 'ABIERTA' AND "assigned_specialist_sub" IS NOT NULL;

UPDATE "post_sale_request"
SET "status" = 'RECEIVED'
WHERE "status" = 'ABIERTA' AND "assigned_specialist_sub" IS NULL;

UPDATE "post_sale_request"
SET "status" = 'IN_ANALYSIS'
WHERE "status" = 'EN_ANALISIS';

INSERT INTO "post_sale_request_activity" (
  "id", "post_sale_request_id", "event_type", "previous_status", "new_status",
  "description", "actor_sub", "actor_role", "dedupe_key", "created_at"
)
SELECT
  gen_random_uuid(),
  id,
  'REQUEST_REGISTERED'::"post_sale_request_activity_event",
  NULL,
  'RECEIVED'::"post_sale_request_status",
  'Solicitud registrada.',
  NULL,
  NULL,
  'request:' || id || ':registered',
  created_at
FROM "post_sale_request";

INSERT INTO "post_sale_request_activity" (
  "id", "post_sale_request_id", "event_type", "previous_status", "new_status",
  "description", "actor_sub", "actor_role", "dedupe_key", "created_at"
)
SELECT
  gen_random_uuid(),
  id,
  'SPECIALIST_ASSIGNED'::"post_sale_request_activity_event",
  'RECEIVED'::"post_sale_request_status",
  'ASSIGNED'::"post_sale_request_status",
  'Solicitud asignada al especialista.',
  assigned_specialist_sub,
  'SPECIALIST',
  'request:' || id || ':assigned',
  created_at
FROM "post_sale_request"
WHERE assigned_specialist_sub IS NOT NULL;

INSERT INTO "post_sale_request_activity" (
  "id", "post_sale_request_id", "event_type", "previous_status", "new_status",
  "description", "actor_sub", "actor_role", "technical_analysis_id", "dedupe_key", "created_at"
)
SELECT
  gen_random_uuid(),
  post_sale_request_id,
  CASE
    WHEN status = 'SUCCEEDED' THEN 'ANALYSIS_COMPLETED'::"post_sale_request_activity_event"
    ELSE 'ANALYSIS_FAILED'::"post_sale_request_activity_event"
  END,
  NULL,
  CASE WHEN status = 'SUCCEEDED' THEN 'IN_ANALYSIS'::"post_sale_request_status" ELSE NULL END,
  CASE
    WHEN status = 'SUCCEEDED' THEN 'Análisis técnico completado.'
    ELSE 'El análisis técnico no se completó.'
  END,
  executed_by_sub,
  'SPECIALIST',
  id,
  'analysis:' || id || CASE WHEN status = 'SUCCEEDED' THEN ':completed' ELSE ':failed' END,
  executed_at
FROM "technical_analysis";

INSERT INTO "post_sale_request_activity" (
  "id", "post_sale_request_id", "event_type", "previous_status", "new_status",
  "description", "actor_sub", "actor_role", "technical_analysis_id", "technical_report_id",
  "report_version", "metadata", "dedupe_key", "created_at"
)
SELECT
  gen_random_uuid(),
  post_sale_request_id,
  'REPORT_GENERATED'::"post_sale_request_activity_event",
  NULL,
  'REPORT_DRAFT'::"post_sale_request_status",
  'Se generó un borrador de informe. Versión ' || version || '.',
  created_by_sub,
  'SPECIALIST',
  analysis_id,
  id,
  version,
  jsonb_build_object('origin', origin::text),
  'report:' || id || ':generated',
  created_at
FROM "technical_report";

INSERT INTO "post_sale_request_activity" (
  "id", "post_sale_request_id", "event_type", "previous_status", "new_status",
  "description", "actor_sub", "actor_role", "technical_analysis_id", "technical_report_id",
  "report_version", "metadata", "dedupe_key", "created_at"
)
SELECT
  gen_random_uuid(),
  review.post_sale_request_id,
  CASE review.event_type
    WHEN 'SUBMITTED' THEN 'REPORT_SUBMITTED'::"post_sale_request_activity_event"
    WHEN 'REVIEW_STARTED' THEN 'REVIEW_STARTED'::"post_sale_request_activity_event"
    WHEN 'APPROVED' THEN 'REPORT_APPROVED'::"post_sale_request_activity_event"
    WHEN 'CHANGES_REQUESTED' THEN 'CHANGES_REQUESTED'::"post_sale_request_activity_event"
    ELSE 'REANALYSIS_REQUIRED'::"post_sale_request_activity_event"
  END,
  NULL,
  CASE review.event_type
    WHEN 'SUBMITTED' THEN 'PENDING_VALIDATION'::"post_sale_request_status"
    WHEN 'REVIEW_STARTED' THEN 'PENDING_VALIDATION'::"post_sale_request_status"
    WHEN 'APPROVED' THEN 'REPORT_APPROVED'::"post_sale_request_status"
    WHEN 'CHANGES_REQUESTED' THEN 'REPORT_CHANGES_REQUESTED'::"post_sale_request_status"
    ELSE 'REANALYSIS_REQUIRED'::"post_sale_request_status"
  END,
  CASE review.event_type
    WHEN 'SUBMITTED' THEN 'Se envió el informe a validación. Versión ' || review.submitted_version || '.'
    WHEN 'REVIEW_STARTED' THEN 'El validador inició la revisión. Versión ' || review.submitted_version || '.'
    WHEN 'APPROVED' THEN 'Se aprobó el informe técnico. Versión ' || review.submitted_version || '.'
    WHEN 'CHANGES_REQUESTED' THEN 'El validador solicitó ajustes. Versión ' || review.submitted_version || '.'
    ELSE 'El validador requirió un nuevo análisis técnico. Versión ' || review.submitted_version || '.'
  END,
  review.actor_sub,
  CASE WHEN review.event_type = 'SUBMITTED' THEN 'SPECIALIST' ELSE 'VALIDATOR' END,
  review.analysis_id,
  review.report_id,
  review.submitted_version,
  CASE WHEN review.comments IS NULL THEN NULL ELSE jsonb_build_object('comments', review.comments) END,
  'report:' || review.report_id || ':' || CASE review.event_type
    WHEN 'SUBMITTED' THEN 'submit'
    WHEN 'REVIEW_STARTED' THEN 'start'
    WHEN 'APPROVED' THEN 'approve'
    WHEN 'CHANGES_REQUESTED' THEN 'request-changes'
    ELSE 'require-reanalysis'
  END,
  review.created_at
FROM "technical_report_review" AS review;
