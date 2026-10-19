-- New refresh tokens include this indexed ID in their signed JWT `jti` claim.
-- Existing rows remain valid and use the legacy lookup once before rotating.
ALTER TABLE "RefreshToken"
  ADD COLUMN "tokenId" TEXT;

CREATE UNIQUE INDEX "RefreshToken_tokenId_key" ON "RefreshToken"("tokenId");
CREATE INDEX "RefreshToken_userId_tokenId_revokedAt_idx"
  ON "RefreshToken"("userId", "tokenId", "revokedAt");
