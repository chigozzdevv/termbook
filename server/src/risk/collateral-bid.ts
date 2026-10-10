import { encodeFunctionData, parseAbi, type Address, type Hex, type LocalAccount, type PublicClient } from "viem";
import { termbookCoreAbi } from "@termbook/bindings";
import { keeperTransaction } from "../chain/keeper.js";
import { env } from "../config/env.js";

const tokenAbi = parseAbi(["function balanceOf(address) view returns(uint256)", "function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)"]);
const oracleAbi = parseAbi(["function read(bytes32) view returns(uint256,uint256,uint80)"]);
const ceil = (a: bigint, b: bigint) => a === 0n ? 0n : (a - 1n) / b + 1n;

export function collateralBidSize(input: { debt: bigint; balance: bigint; maximum: bigint; collateral: bigint; saleCap: bigint; price: bigint; collateralDecimals: number; settlementDecimals: number }) {
  if (input.price <= 0n || ![input.collateralDecimals, input.settlementDecimals].every((n) => Number.isInteger(n) && n >= 0 && n <= 18)
    || [input.debt, input.balance, input.maximum, input.collateral, input.saleCap].some((n) => n < 0n)) throw new Error("risk-collateral-bid-price-invalid");
  const budget = [input.debt, input.balance, input.maximum].reduce((a, b) => a < b ? a : b);
  const unit = 10n ** BigInt(input.collateralDecimals), settlementUnit = 10n ** BigInt(input.settlementDecimals);
  const amount = [budget * 10n ** 18n * unit / (input.price * settlementUnit), input.collateral, input.saleCap].reduce((a, b) => a < b ? a : b);
  const payment = ceil(ceil(amount * input.price, unit) * settlementUnit, 10n ** 18n);
  if (payment > budget) throw new Error("risk-collateral-bid-price-invalid");
  return amount === 0n || payment === 0n ? null : { collateralAmount: amount, settlementAmount: payment };
}

function configuredLimit(collateral: Address, settlement: Address): bigint | undefined {
  const raw = process.env["LOCAL_COLLATERAL_BIDS"];
  if (!raw) return;
  if (raw.length > 8192) throw new Error("risk-collateral-bid-config-invalid");
  const items: unknown = JSON.parse(raw);
  if (!Array.isArray(items) || items.length > 8) throw new Error("risk-collateral-bid-config-invalid");
  const seen = new Set<string>();
  let result: bigint | undefined;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("risk-collateral-bid-config-invalid");
    const { chain_id, collateral_asset, settlement_asset, maximum_settlement } = item as Record<string, unknown>;
    if (Object.keys(item).some((key) => !["chain_id", "collateral_asset", "settlement_asset", "maximum_settlement"].includes(key))
      || chain_id !== env.monadChainId || ![collateral_asset, settlement_asset].every((a) => typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a) && !/^0x0{40}$/i.test(a))
      || typeof maximum_settlement !== "string" || !/^[1-9]\d{0,38}$/.test(maximum_settlement)
      || BigInt(maximum_settlement) >= 2n ** 128n) throw new Error("risk-collateral-bid-config-invalid");
    const key = `${String(collateral_asset).toLowerCase()}:${String(settlement_asset).toLowerCase()}`;
    if (seen.has(key)) throw new Error("risk-collateral-bid-config-invalid");
    seen.add(key);
    if (key === `${collateral.toLowerCase()}:${settlement.toLowerCase()}`) result = BigInt(maximum_settlement);
  }
  return result;
}

export async function submitCollateralBid(input: { client: PublicClient; account: LocalAccount; creditId: Hex; revision: bigint; debt: bigint; collateralAsset: Address; collateralAmount: bigint; settlementAsset: Address; blockNumber: bigint; submit: typeof keeperTransaction }): Promise<boolean> {
  const maximum = configuredLimit(input.collateralAsset, input.settlementAsset);
  if (!maximum) return false;
  const core = env.core as Address, client = input.client;
  const id = await client.readContract({ address: core, abi: termbookCoreAbi, functionName: "localSaleMarketId", args: [input.collateralAsset, input.settlementAsset], blockNumber: input.blockNumber });
  const policy = await client.readContract({ address: core, abi: termbookCoreAbi, functionName: "localSalePolicies", args: [id], blockNumber: input.blockNumber });
  if (!policy[9]) throw new Error("risk-collateral-bid-policy-invalid");
  const [price, balance, allowance] = await Promise.all([
    client.readContract({ address: policy[0], abi: oracleAbi, functionName: "read", args: [policy[1]], blockNumber: input.blockNumber }),
    client.readContract({ address: input.settlementAsset, abi: tokenAbi, functionName: "balanceOf", args: [input.account.address], blockNumber: input.blockNumber }),
    client.readContract({ address: input.settlementAsset, abi: tokenAbi, functionName: "allowance", args: [input.account.address, core], blockNumber: input.blockNumber }),
  ]);
  const bid = collateralBidSize({ debt: input.debt, balance, maximum, collateral: input.collateralAmount, saleCap: policy[5], price: price[0], collateralDecimals: policy[3], settlementDecimals: policy[4] });
  if (!bid) return false;
  const send = async (to: Address, data: Hex, operation: string) => {
    await client.call({ account: input.account.address, to, data });
    return input.submit({ client, account: input.account, rpcUrl: env.rpcUrl, chainId: env.monadChainId, operation, to, data });
  };
  if (allowance !== bid.settlementAmount) {
    if (allowance !== 0n && await send(input.settlementAsset, encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [core, 0n] }), `${input.creditId}:${input.revision}:bid-reset:${input.blockNumber}`) !== "success") return true;
    if (await send(input.settlementAsset, encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [core, bid.settlementAmount] }), `${input.creditId}:${input.revision}:bid-approve:${input.blockNumber}`) !== "success") return true;
  }
  await send(core, encodeFunctionData({ abi: termbookCoreAbi, functionName: "recoverLocalCollateralWithBid", args: [input.creditId, bid.collateralAmount, bid.settlementAmount] }), `${input.creditId}:${input.revision}:collateral-bid`);
  return true;
}
