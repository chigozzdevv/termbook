import { artifact } from "./testnet-runtime.mjs";

export async function loadCredits(deployment, network) {
  const client = network.client ?? network.publicClient;
  const logClient = network.logClient ?? client;
  const core = deployment.addresses[10143].TermbookCore;
  const block = await client.getBlock({ blockTag: "finalized" });
  const abi = artifact("TermbookCore").abi;
  const read = (functionName, args = []) => client.readContract({ address: core, abi, functionName, args, blockNumber: block.number });
  const expected = await read("acceptedCredits");
  if (expected === 0n) return { core, observations: [] };
  const start = deployment.deploymentBlocks?.[10143];
  if (start === undefined) throw new Error("Missing Core deployment block");
  const event = abi.find((entry) => entry.type === "event" && entry.name === "CreditCreated");
  if (!event) throw new Error("Missing credit creation event");
  if (logClient !== client && (await logClient.getChainId() !== 10143
    || (await logClient.getBlock({ blockNumber: block.number })).hash !== block.hash)) {
    throw new Error("Credit log provider chain or block mismatch");
  }
  async function logs(from, to) {
    try { return await logClient.getLogs({ address: core, event, fromBlock: from, toBlock: to, strict: true }); }
    catch (cause) {
      if (to - from < 100n || !/range|too many|limit exceeded|response size|maximum.*blocks/i.test(cause.message)) throw cause;
      const middle = (from + to) / 2n;
      return [...await logs(from, middle), ...await logs(middle + 1n, to)];
    }
  }
  const created = await logs(BigInt(start), block.number);
  const ids = created.map((log) => log.args.creditId);
  if (BigInt(ids.length) !== expected || new Set(ids).size !== ids.length) throw new Error("Onchain credit inventory is incomplete");
  const observations = [];
  for (const creditId of ids) {
    const credit = await read("creditDetails", [creditId]);
    observations.push({ creditId, account: credit.account, lockId: credit.lockId });
  }
  if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error("Credit inventory block changed");
  return { core, observations };
}
