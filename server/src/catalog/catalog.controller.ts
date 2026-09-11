import { catalogService } from "./catalog.service.js";

export const catalogController = {
  async overview() {
    return catalogService.overview();
  },
};
