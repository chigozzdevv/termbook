import type { TermbookClient } from "../client/client.js";
import type { CatalogFilters } from "../types/catalog.types.js";
import { HttpClient } from "../transport/http.js";

export class Catalog {
  client: TermbookClient;

  constructor(client: TermbookClient) {
    this.client = client;
  }

  private async overview(): Promise<Record<string, unknown>> {
    await this.client.ready();
    const base = this.client.config.apiBase;
    if (!base) throw new Error("api-required");
    return new HttpClient(base).get<Record<string, unknown>>("/catalog");
  }

  private filter(rows: unknown[], filters?: CatalogFilters): unknown[] {
    if (!filters) return rows;
    return rows.filter((row) => {
      if (!row || typeof row !== "object") return false;
      const value = row as Record<string, unknown>;
      if (filters.chainId !== undefined && Number(value["chainId"] ?? value["chain_id"]) !== filters.chainId) return false;
      if (filters.asset !== undefined && String(value["asset"] ?? value["address"] ?? "").toLowerCase() !== filters.asset.toLowerCase()) return false;
      if (filters.house !== undefined && String(value["house"] ?? "").toLowerCase() !== filters.house.toLowerCase()) return false;
      return true;
    });
  }

  async chains(f?: CatalogFilters): Promise<unknown[]> {
    const data = await this.overview();
    return this.filter(Array.isArray(data["chains"]) ? data["chains"] : [], f);
  }

  async assets(f?: CatalogFilters): Promise<unknown[]> {
    const data = await this.overview();
    return this.filter(Array.isArray(data["assets"]) ? data["assets"] : [], f);
  }

  async houses(f?: CatalogFilters): Promise<unknown[]> {
    const data = await this.overview();
    return this.filter(Array.isArray(data["houses"]) ? data["houses"] : [], f);
  }

  async integrations(f?: CatalogFilters): Promise<unknown[]> {
    const data = await this.overview();
    return this.filter(Array.isArray(data["integrations"]) ? data["integrations"] : [], f);
  }
}
