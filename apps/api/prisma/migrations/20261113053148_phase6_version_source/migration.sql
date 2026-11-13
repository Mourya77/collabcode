-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "label" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'SAVE';
