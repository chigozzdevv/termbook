import { keccak256, type Address } from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { importVerifiedSource } from "./integration.source.js";
import { readProxyImplementation } from "../chain/proxy.js";

export const platformService = {
  spot() {
    const router = process.env["ATOMIC_SPOT_ROUTER"], module = process.env["ATOMIC_SPOT_MODULE"], reader = process.env["SHARED_READ_PROGRAM"];
    if ([router, module, reader].some((value) => !/^0x[a-fA-F0-9]{40}$/.test(value ?? "") || /^0x0{40}$/i.test(value ?? ""))) {
      throw new Error("integration-platform-unavailable");
    }
    return { chain_id: env.monadChainId, router, module, read_program: reader };
  },
  useCase() {
    const execution = process.env["SHARED_USE_CASE_POLICY"], reader = process.env["SHARED_USE_CASE_READER"],
      recovery = process.env["SHARED_USE_CASE_RECOVERY"], read_program = process.env["SHARED_READ_PROGRAM"];
    if ([execution, reader, recovery, read_program].some((value) => !/^0x[a-fA-F0-9]{40}$/.test(value ?? "") || /^0x0{40}$/i.test(value ?? ""))) {
      throw new Error("integration-platform-unavailable");
    }
    return { chain_id: env.monadChainId, contracts: { execution, reader, recovery, exit: recovery }, read_program };
  },
  async source(target: Address) {
    const chain = monadClient();
    const block = await chain.getBlock({ blockTag: "finalized" });
    const code = await chain.getBytecode({ address: target, blockNumber: block.number });
    if (!code || code === "0x") throw new Error("integration-target-unavailable");
    const proxy = await readProxyImplementation(chain, target, block.number);
    if (proxy) {
      const implementation = proxy.implementation;
      const implCode = await chain.getBytecode({ address: implementation, blockNumber: block.number });
      if (!implCode || implCode === "0x") throw new Error("integration-implementation-unavailable");
      const [source, implementationSource] = await Promise.all([
        importVerifiedSource(env.monadChainId, target, code, null),
        importVerifiedSource(env.monadChainId, implementation, implCode, null),
      ]);
      if (implementationSource.runtimeReviewTarget && implementationSource.runtimeReviewTarget.toLowerCase() !== target.toLowerCase()) throw new Error("integration-runtime-review-target-mismatch");
      return { target, code_hash: keccak256(code), source_hash: source.sourceHash,
        implementation, implementation_slot: proxy.slot, implementation_code_hash: keccak256(implCode), implementation_source_hash: implementationSource.sourceHash,
        ...(implementationSource.runtimeReview ? { implementation_runtime_review: implementationSource.runtimeReview } : {}) };
    }
    const source = await importVerifiedSource(env.monadChainId, target, code, null);
    if (source.runtimeReview) throw new Error("integration-runtime-review-target-mismatch");
    return { target, code_hash: keccak256(code), source_hash: source.sourceHash,
      implementation: undefined, implementation_slot: undefined, implementation_code_hash: undefined,
      implementation_source_hash: undefined, implementation_runtime_review: undefined };
  },
};
