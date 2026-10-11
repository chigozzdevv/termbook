import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pages } from "../src/features/docs/content";
import { actionExamples } from "../src/features/docs/content/use-cases";
import { kuruImplementation, kuruReadProgram, kuruOrders } from "../src/features/docs/content/kuru-source";
import { docHref, searchDocs, searchEntries } from "../src/features/docs/model";
import { actionParameters, standardActionSchema } from "../../packages/schema/src/actions";

describe("documentation integrity", () => {
  it("resolves all guide links and section anchors", () => {
    expect(new Set(pages.map((page) => page.slug)).size).toBe(pages.length);
    const urls = new Set(pages.flatMap((page) => [docHref(page.slug), ...page.sections.map((section) => `${docHref(page.slug)}#${section.id}`)]));
    for (const page of pages) {
      expect(new Set(page.sections.map((section) => section.id)).size).toBe(page.sections.length);
      for (const section of page.sections) for (const block of section.blocks) {
        if (block.kind === "links") for (const link of block.items) expect(urls.has(link.href), link.href).toBe(true);
      }
    }
  });

  it("documents every standard capability with schema-valid inputs", () => {
    for (const [use_case, examples] of Object.entries(actionExamples)) {
      const capabilities = new Set(examples.map((example) => example.capability));
      expect([...capabilities].sort()).toEqual(Object.keys(actionParameters[use_case as keyof typeof actionParameters]).sort());
      for (const example of examples) expect(standardActionSchema.safeParse({ use_case, ...example }).success, `${use_case}.${example.capability}`).toBe(true);
    }
  });

  it("keeps the complete Kuru example aligned with its implementation", () => {
    expect(kuruImplementation).toBe(readFileSync(new URL("../../server/src/kuru/integration.ts", import.meta.url), "utf8").trimEnd());
    expect(kuruReadProgram).toBe(readFileSync(new URL("../../server/src/kuru/read.ts", import.meta.url), "utf8").trimEnd());
    expect(kuruOrders).toBe(readFileSync(new URL("../../server/src/kuru/orders.ts", import.meta.url), "utf8").trimEnd());
  });

  it("searches section content and ranks heading matches", () => {
    const entries = searchEntries(pages);
    const first = searchDocs(entries, "recovery")[0];
    expect(`${first.title} ${first.heading}`).toMatch(/recovery/i);
    expect(searchDocs(entries, "source wallet").some((entry) => entry.title.includes("wallet"))).toBe(true);
    expect(searchDocs(entries, "definitely-no-match")).toEqual([]);
    expect(searchDocs(entries, "").every((entry) => !entry.heading)).toBe(true);
    expect(searchDocs(entries, "minimum_receive").length).toBeGreaterThan(0);
  });

  it("links deployment addresses to the matching testnet explorer", () => {
    const deployment = readFileSync(new URL("../../deployments/testnet.json", import.meta.url), "utf8").toLowerCase();
    const addresses = pages.find((page) => page.slug === "getting-started/networks")!.sections.find((section) => section.id === "addresses")!;
    const block = addresses.blocks.find((block) => block.kind === "table")!;
    if (block.kind !== "table") throw new Error("Deployment table missing");
    expect(block.rows).toHaveLength(4);
    for (const row of block.rows) {
      const cell = row[1];
      if (!cell || typeof cell === "string") throw new Error("Explorer link missing");
      expect(deployment).toContain(cell.text.toLowerCase());
      expect(cell.href).toBe(`https://testnet.monadexplorer.com/address/${cell.text}`);
      expect(cell.label).toContain("Monad testnet explorer");
    }
  });
});
