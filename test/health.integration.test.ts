import { describe, expect, it } from "vitest";
import { healthRoutes } from "../src/modules/health/health.routes.js";

function createResponseCollector() {
  return {
    statusCode: 200,
    payload: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.payload = data;
      return this;
    }
  };
}

describe("health routes", () => {
  it("returns healthy response", async () => {
    const response = createResponseCollector();
    const healthHandler = healthRoutes.stack.find((layer) => layer.route?.path === "/health")?.route?.stack[0]?.handle;

    await healthHandler?.({} as never, response as never, (() => undefined) as never);

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({
      ok: true,
      service: "chaufx-api"
    });
  });

  it("returns API docs payload", async () => {
    const response = createResponseCollector();
    const docsHandler = healthRoutes.stack.find((layer) => layer.route?.path === "/docs")?.route?.stack[0]?.handle;

    await docsHandler?.({} as never, response as never, (() => undefined) as never);

    expect(response.statusCode).toBe(200);
    expect((response.payload as { modules: string[] }).modules).toContain("bookings");
  });
});
