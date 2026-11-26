export { escapeHtml } from "./html.ts";

export type Health = {
  status: "ok";
};

export type GatewayHealth = Health & {
  service: "gateway";
  version: string;
};

export type MockServicesHealth = Health & {
  service: "mock-services";
};
