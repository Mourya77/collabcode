-- CreateTable
CREATE TABLE "YjsDocument" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YjsDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YjsDocument_fileId_key" ON "YjsDocument"("fileId");

-- AddForeignKey
ALTER TABLE "YjsDocument" ADD CONSTRAINT "YjsDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
