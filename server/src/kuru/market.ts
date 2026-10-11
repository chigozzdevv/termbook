import { formatUnits, parseAbi, type Hex } from "viem";

export const marketAbi = parseAbi([
  "function getMarketParams() view returns (uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)",
  "function marketState() view returns (uint8)",
  "function getL2Book(uint32,uint32) view returns (bytes)",
]);
export const tradeEvent = parseAbi([
  "event Trade(uint40 orderId,address makerAddress,bool isBuy,uint256 price,uint96 updatedSize,address takerAddress,address txOrigin,uint96 filledSize)",
])[0];

export type Level = { price: string; size: string };

export function decimalRatio(value: bigint, scale: bigint): string {
  if (scale <= 0n) throw new Error("kuru-market-invalid");
  return formatUnits(value * 10n ** 18n / scale, 18);
}

export function decodeBook(data: Hex, block: bigint, pricePrecision: bigint, sizePrecision: bigint) {
  if (!/^0x(?:[a-fA-F0-9]{64}){2,66}$/.test(data) || pricePrecision <= 0n || sizePrecision <= 0n) throw new Error("kuru-book-invalid");
  const words = data.slice(2).match(/.{64}/g)!.map((word) => BigInt(`0x${word}`));
  if (words[0] !== block) throw new Error("kuru-book-invalid");
  let offset = 1;
  const side = (ascending: boolean): Level[] => {
    const levels: Level[] = [];
    let prior = ascending ? 0n : 2n ** 32n;
    while (offset < words.length && (ascending || words[offset] !== 0n)) {
      const price = words[offset++], size = words[offset++];
      if (price === undefined || size === undefined || price <= 0n || price >= 2n ** 32n || size <= 0n || size >= 2n ** 96n
        || (ascending ? price <= prior : price >= prior) || levels.length >= 16) throw new Error("kuru-book-invalid");
      levels.push({ price: decimalRatio(price, pricePrecision), size: decimalRatio(size, sizePrecision) });
      prior = price;
    }
    if (!ascending) {
      if (words[offset] !== 0n) throw new Error("kuru-book-invalid");
      offset++;
    }
    return levels;
  };
  const bids = side(false), asks = side(true);
  if (offset !== words.length || bids[0] && asks[0] && Number(bids[0].price) >= Number(asks[0].price)) throw new Error("kuru-book-invalid");
  return { bids, asks };
}
