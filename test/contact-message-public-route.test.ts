import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { contactMessageRoutes } from "../src/modules/contact-messages/contact-messages.routes.js";
import { usersRoutes } from "../src/modules/users/users.routes.js";

describe("public contact messages", () => {
  it("is mounted before routers that apply authentication globally", () => {
    const app = createApp();
    const layers = (app as unknown as { _router: { stack: Array<{ handle: unknown }> } })._router.stack;
    const contactRouteIndex = layers.findIndex((layer) => layer.handle === contactMessageRoutes);
    const usersRouteIndex = layers.findIndex((layer) => layer.handle === usersRoutes);

    expect(contactRouteIndex).toBeGreaterThanOrEqual(0);
    expect(usersRouteIndex).toBeGreaterThanOrEqual(0);
    expect(contactRouteIndex).toBeLessThan(usersRouteIndex);
  });
});
