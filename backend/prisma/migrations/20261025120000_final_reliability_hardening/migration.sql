-- Preserve all existing incidents and stop safely if they already contain
-- multiple ongoing incidents for the same monitor and type. Resolve such rows
-- manually before applying this migration; the migration never deletes them.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Incident"
        WHERE "status" = 'ONGOING'
        GROUP BY "monitorId", "type"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Resolve duplicate ongoing incidents before applying reliability migration';
    END IF;
END $$;

ALTER TABLE "MonitorCheck"
ADD COLUMN "scheduledOccurrenceId" TEXT;

CREATE UNIQUE INDEX "MonitorCheck_monitorId_scheduledOccurrenceId_key"
ON "MonitorCheck"("monitorId", "scheduledOccurrenceId");

CREATE UNIQUE INDEX "Incident_one_ongoing_per_monitor_type_key"
ON "Incident"("monitorId", "type")
WHERE "status" = 'ONGOING';

CREATE TABLE "NotificationOutbox" (
    "id" SERIAL NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "incidentId" INTEGER,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationOutbox_incidentId_fkey"
        FOREIGN KEY ("incidentId") REFERENCES "Incident"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NotificationOutbox_dedupeKey_key"
ON "NotificationOutbox"("dedupeKey");

CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx"
ON "NotificationOutbox"("status", "nextAttemptAt");

CREATE INDEX "NotificationOutbox_status_lockedUntil_idx"
ON "NotificationOutbox"("status", "lockedUntil");
