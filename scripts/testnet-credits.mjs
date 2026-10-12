import { artifact, viem } from "./testnet-runtime.mjs";

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
  const created = [];
  if (logClient === client && process.env.ENVIO_API_TOKEN) {
    const [{ readCoreEvents }, { env }] = await Promise.all([
      import("../server/dist/chain/envio.client.js"), import("../server/dist/config/env.js"),
    ]);
    if (env.monadChainId !== 10143 || env.core.toLowerCase() !== core.toLowerCase()) throw new Error("Credit archive configuration mismatch");
    let cursor = BigInt(start);
    const topic = viem.toEventSelector(event);
    while (cursor <= block.number && BigInt(created.length) < expected) {
      const page = await readCoreEvents(client, cursor, block.number, "json", topic);
      if (page.source !== "envio" || page.nextBlock <= cursor) throw new Error("Credit archive has not caught up");
      for (const entry of page.logs) {
        let decoded;
        try { decoded = viem.decodeEventLog({ abi: [event], data: entry.data, topics: entry.topics, strict: true }); }
        catch { continue; }
        created.push({ ...entry, args: decoded.args });
      }
      cursor = page.nextBlock;
    }
  } else created.push(...await logs(BigInt(start), block.number));
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
