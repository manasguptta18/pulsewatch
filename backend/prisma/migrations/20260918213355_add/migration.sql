-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'AVAILABILITY';

-- AlterTable
ALTER TABLE "Monitor" ALTER COLUMN "intervalSeconds" SET DEFAULT 60;
