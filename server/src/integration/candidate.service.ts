import { randomUUID } from "node:crypto";
import { candidateRepo } from "./candidate.repo.js";
import { inspectIntegrationDraft } from "./integration.draft.js";
import { applicationService } from "./application.service.js";
import { integrationService } from "./integration.service.js";
import { integrationRepo } from "./integration.repo.js";
import { withTx } from "../database/transaction.js";
import { validateIntegrationAcceptance } from "./integration.builder.js";
import { validateIntegrationSources } from "./integration.source.js";
import { integrationAcceptanceSchema, integrationDraftRequestSchema,
  integrationMappingSchema, integrationSchema } from "./integration.schema.js";
import type { z } from "zod";
import { capabilityCalls } from "@termbook/schema";

type CandidateDraft = Awaited<ReturnType<typeof inspectIntegrationDraft>>;

function matchesDraft(draft: CandidateDraft, mapping: z.infer<typeof integrationMappingSchema>): boolean {
  const entries = draft.entries;
  return mapping.actions.flatMap(capabilityCalls).every((action) => entries.some((entry) =>
    entry.target.toLowerCase() === action.target.toLowerCase()
      && entry.signature === action.signature))
    && mapping.verifiedSources.every((source) => entries.some((entry) =>
      entry.target.toLowerCase() === source.target.toLowerCase()
      && entry.source.sourceHash.toLowerCase() === source.sourceHash.toLowerCase()
      && (entry.implementation ?? undefined)?.toLowerCase()
        === source.implementation?.toLowerCase()
      && (entry.implementationSource?.sourceHash ?? undefined)?.toLowerCase()
        === source.implementationSourceHash?.toLowerCase()));
}

export const candidateService = {
  async create(input: z.infer<typeof integrationDraftRequestSchema>, owner: string) {
    await applicationService.requireVerified(input.applicationId, owner);
    const { applicationId, ...draftInput } = input;
    const draft = await inspectIntegrationDraft(draftInput);
    const id = randomUUID();
    await candidateRepo.create({ id, applicationId, owner: owner.toLowerCase(), status: "mapping", draft });
    return { id, status: "mapping", draft };
  },
  async details(id: string, owner: string) {
    const candidate = await candidateRepo.get(id);
    if (!candidate || candidate["owner"] !== owner.toLowerCase()) {
      throw new Error("integration-candidate-unavailable");
    }
    return { id, applicationId: String(candidate["applicationId"]),
      status: String(candidate["status"]), draft: candidate["draft"],
      mapping: candidate["mapping"] ?? null, proposal: candidate["proposal"] ?? null };
  },
  async map(id: string, owner: string, mapping: z.infer<typeof integrationMappingSchema>) {
    const candidate = await candidateRepo.get(id);
    if (!candidate || candidate["status"] !== "mapping" || candidate["owner"] !== owner.toLowerCase()
      || candidate["applicationId"] !== mapping.applicationId) throw new Error("integration-candidate-unavailable");
    await applicationService.requireVerified(mapping.applicationId, owner);
    if (!matchesDraft(candidate["draft"] as CandidateDraft, mapping)) {
      throw new Error("integration-mapping-not-observed");
    }
    const updated = await candidateRepo.setMapping(id, owner.toLowerCase(), mapping);
    if (!updated) throw new Error("integration-candidate-unavailable");
    return { id, status: "ready_to_test" };
  },
  async evidence(id: string, owner: string, acceptance: z.infer<typeof integrationAcceptanceSchema>) {
    const candidate = await candidateRepo.get(id);
    if (!candidate || candidate["status"] !== "ready_to_test" || candidate["owner"] !== owner.toLowerCase()) {
      throw new Error("integration-candidate-unavailable");
    }
    const mapping = integrationMappingSchema.parse(candidate["mapping"]);
    await applicationService.requireVerified(mapping.applicationId, owner);
    const proposal = integrationSchema.parse({ ...mapping, acceptance });
    await Promise.all([
      validateIntegrationAcceptance(proposal.versionId as `0x${string}`,
        proposal.settlementAsset as `0x${string}`, proposal.actions, proposal.acceptance),
      validateIntegrationSources(proposal.actions, proposal.verifiedSources),
    ]);
    const updated = await candidateRepo.setProposal(id, owner.toLowerCase(), proposal);
    if (!updated) throw new Error("integration-candidate-unavailable");
    return { id, status: "security_review" };
  },
  async publish(id: string, reviewer: string) {
    const candidate = await candidateRepo.get(id);
    if (!candidate || candidate["status"] !== "security_review") throw new Error("integration-candidate-unavailable");
    const proposal = integrationSchema.parse(candidate["proposal"]);
    if (proposal.applicationId !== candidate["applicationId"]
      || !matchesDraft(candidate["draft"] as CandidateDraft, proposal)) {
      throw new Error("integration-candidate-unavailable");
    }
    const prepared = await integrationService.prepare(proposal);
    try {
      await withTx(async (session) => {
        await integrationRepo.create(prepared.doc, session);
        const updated = await candidateRepo.activate(id, reviewer.toLowerCase(), session);
        if (!updated) throw new Error("integration-candidate-unavailable");
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        throw new Error("integration-conflict", { cause: error });
      }
      throw error;
    }
    return { candidateId: id, versionId: prepared.versionId, appToken: prepared.appToken };
  },
};
