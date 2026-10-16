CREATE TYPE "ContactMessageReplyAuthor" AS ENUM ('CONTACT', 'ADMIN');

ALTER TABLE "ContactMessage"
  ADD COLUMN "feedbackTokenHash" TEXT;

CREATE UNIQUE INDEX "ContactMessage_feedbackTokenHash_key"
  ON "ContactMessage"("feedbackTokenHash");

CREATE TABLE "ContactMessageReply" (
  "id" TEXT NOT NULL,
  "contactMessageId" TEXT NOT NULL,
  "author" "ContactMessageReplyAuthor" NOT NULL,
  "message" TEXT NOT NULL,
  "adminUserId" TEXT,
  "emailSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContactMessageReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactMessageReply_contactMessageId_createdAt_idx"
  ON "ContactMessageReply"("contactMessageId", "createdAt");

ALTER TABLE "ContactMessageReply"
  ADD CONSTRAINT "ContactMessageReply_contactMessageId_fkey"
  FOREIGN KEY ("contactMessageId") REFERENCES "ContactMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactMessageReply"
  ADD CONSTRAINT "ContactMessageReply_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
