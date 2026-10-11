import { ReadProgramBuilder } from "@termbook/sdk";
import { encodeFunctionData, parseAbi, zeroAddress, type Hex } from "viem";

export function kuru_quote_program(parameter_hash: Hex, size_precision: bigint, price_precision: bigint,
  base_decimals: bigint, quote_decimals: bigint) {
  const p = new ReadProgramBuilder();
  const zero = p.constant(0n), one = p.constant(1n), two = p.constant(2n), thirtyTwo = p.constant(32n);
  const baseScale = p.constant(10n ** base_decimals), quoteScale = p.constant(10n ** quote_decimals);
  const size = p.constant(size_precision), price = p.constant(price_precision), bps = p.constant(10_000n);
  const maxPrice = p.constant(2n ** 32n - 1n), maxSize = p.constant(2n ** 96n - 1n);
  const state = p.query(zeroAddress, encodeFunctionData({ abi: parseAbi(["function marketState() view returns (uint8)"]), functionName: "marketState" }), { gas_limit: 30_000 });
  p.assert(p.equal(p.word(state, zero), zero));
  const parameters = p.query(zeroAddress, encodeFunctionData({ abi: parseAbi(["function getMarketParams() view returns (uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)"]), functionName: "getMarketParams" }), { expected_hash: parameter_hash, gas_limit: 100_000 });
  const fee = p.word(parameters, p.constant(9n));
  p.assert(p.less(fee, bps));
  let remaining = p.minimum(p.multiply_divide(p.amount(), size, baseScale), maxSize);
  const requested = remaining;
  const book = p.query(zeroAddress, encodeFunctionData({ abi: parseAbi(["function getL2Book(uint32,uint32) view returns (bytes)"]), functionName: "getL2Book", args: [16, 0] }), { gas_limit: 500_000 });
  const length = p.length(book), four = p.constant(4n);
  p.assert(p.and(p.less_equal(four, length), p.less_equal(length, p.constant(36n))));
  p.assert(p.equal(p.word(book, zero), thirtyTwo));
  p.assert(p.equal(p.word(book, one), p.multiply_divide(p.subtract(length, two), thirtyTwo, one)));
  p.assert(p.equal(p.word(book, two), p.block_number()));
  const end = p.subtract(length, one);
  p.assert(p.equal(p.word(book, end), zero));
  p.assert(p.equal(p.multiply_divide(p.multiply_divide(length, one, two), two, one), length));
  let previous = p.add(maxPrice, one), gross = zero;
  for (let index = 0; index < 16; index++) {
    const priceIndex = p.constant(BigInt(3 + index * 2));
    const levelPrice = p.word_or_zero(book, priceIndex), levelSize = p.word_or_zero(book, p.constant(BigInt(4 + index * 2)));
    const active = p.less(priceIndex, end);
    p.assert(p.select(active, p.and(p.less(zero, levelPrice), p.and(p.less(levelPrice, previous), p.less_equal(levelPrice, maxPrice))), one));
    p.assert(p.less_equal(levelSize, maxSize));
    const filled = p.select(active, p.minimum(levelSize, remaining), zero);
    gross = p.add(gross, p.multiply_divide(filled, levelPrice, size));
    remaining = p.subtract(remaining, filled);
    previous = p.select(active, levelPrice, previous);
  }
  const available = p.multiply_divide(p.subtract(requested, remaining), baseScale, size);
  const quote = p.multiply_divide(gross, quoteScale, price);
  return p.finish([available, p.multiply_divide(quote, p.subtract(bps, fee), bps)]);
}

export function kuru_counter_program() {
  const p = new ReadProgramBuilder();
  const query = p.query(zeroAddress, encodeFunctionData({ abi: parseAbi(["function s_orderIdCounter() view returns (uint40)"]), functionName: "s_orderIdCounter" }), { gas_limit: 30_000 });
  return p.finish([p.word(query, p.constant(0n))]);
}

export function kuru_balance_program() {
  const p = new ReadProgramBuilder(), account = p.account(), token = p.index();
  const query = p.query(zeroAddress, encodeFunctionData({ abi: parseAbi(["function getBalance(address,address) view returns (uint256)"]),
    functionName: "getBalance", args: [zeroAddress, zeroAddress] }), { arguments: [{ word: 0, register: account }, { word: 1, register: token }], gas_limit: 50_000 });
  return p.finish([account, p.word(query, p.constant(0n))]);
}

export function kuru_order_program(size_precision: bigint, price_precision: bigint, base_decimals: bigint, quote_decimals: bigint) {
  const p = new ReadProgramBuilder(), id = p.index(), zero = p.constant(0n), one = p.constant(1n);
  const order = p.query(zeroAddress, encodeFunctionData({ abi: parseAbi(["function s_orders(uint40) view returns (address,uint96,uint40,uint40,uint40,uint32,uint32,bool)"]),
    functionName: "s_orders", args: [0] }), { arguments: [{ word: 0, register: id }], gas_limit: 50_000 });
  const owner = p.word(order, zero), size = p.word(order, one), price = p.word(order, p.constant(5n)), buy = p.word(order, p.constant(7n));
  const head = (side: "buy" | "sell") => {
    const query = p.query(zeroAddress, encodeFunctionData({ abi: parseAbi([`function s_${side}PricePoints(uint256) view returns (uint40,uint40)`]),
      functionName: `s_${side}PricePoints`, args: [0n] }), { arguments: [{ word: 0, register: price }], gas_limit: 40_000 });
    return p.word(query, zero);
  };
  const first = p.select(buy, head("buy"), head("sell"));
  const active = p.and(p.less(zero, owner), p.and(p.less(zero, first), p.and(p.less_equal(first, id), p.less(zero, size))));
  const quantity = p.multiply_divide(size, p.constant(10n ** base_decimals), p.constant(size_precision));
  const quote = p.multiply_divide(p.multiply_divide(size, price, p.constant(size_precision)), p.constant(10n ** quote_decimals), p.constant(price_precision));
  return p.finish([owner, p.select(active, p.select(buy, quote, quantity), zero), p.select(active, quantity, zero), price, buy, active]);
}
