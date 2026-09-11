import { houseService } from "../house/house.service.js";
import { integrationService } from "../integration/integration.service.js";
import { env } from "../config/env.js";

export const catalogService = {
  async overview() {
    const [houses, integrations] = await Promise.all([
      houseService.list(),
      integrationService.list(),
    ]);
    const assets = [...new Set(houses.map((house) => house.asset).filter((asset): asset is string => typeof asset === "string"))].map((asset) => ({ asset }));
    const chains = env.monadChainId > 0 ? [{ chainId: env.monadChainId }] : [];
    return { chains, assets, houses, integrations };
  },
};
