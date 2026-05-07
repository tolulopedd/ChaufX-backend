import { Router } from "express";
import { apiDocs } from "../../lib/docs.js";

export const healthRoutes = Router();

healthRoutes.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "chaufx-api"
  });
});

healthRoutes.get("/docs", (_request, response) => {
  response.json(apiDocs);
});
