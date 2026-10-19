import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { createRefreshTokenId, signRefreshToken, verifyRefreshToken } from "../src/lib/auth.js";

describe("refresh token IDs", () => {
  it("embeds a unique token ID in newly issued refresh tokens", () => {
    const tokenId = createRefreshTokenId();
    const token = signRefreshToken({ userId: "driver-1", role: "driver", tokenId });

    expect(verifyRefreshToken(token)).toEqual({
      userId: "driver-1",
      role: "driver",
      tokenId
    });
  });

  it("continues to read legacy refresh tokens without a token ID", () => {
    const token = jwt.sign(
      { userId: "driver-1", role: "driver" },
      env.JWT_REFRESH_SECRET,
      { expiresIn: "1h" }
    );

    expect(verifyRefreshToken(token)).toEqual({
      userId: "driver-1",
      role: "driver",
      tokenId: undefined
    });
  });
});
