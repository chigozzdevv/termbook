const BPS = 10_000n;
const YEAR = 365n * 24n * 60n * 60n;

type QuoteRow = Record<string, unknown>;

function amount(value: unknown): bigint | undefined {
  try {
    const parsed = BigInt(String(value));
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function rankQuotes(intent: QuoteRow, rows: QuoteRow[], now = Math.floor(Date.now() / 1000)) {
  const duration = Number(intent["duration"]);
  if (!Number.isSafeInteger(duration) || duration <= 0) return [];
  const funding = amount(intent["actionFunding"] ?? "0");
  if (funding === undefined) return [];
  const eligible = rows.flatMap((row) => {
    const limit = amount(row["limit"]);
    const fee = amount(row["originationFee"] ?? "0");
    const apr = Number(row["aprBps"]);
    const commitment = Number(row["commitmentFeeBps"] ?? 0);
    const expiry = Number(row["expiry"]);
    const maturity = Number(row["maturity"]);
    const setupDeadline = Number(row["setupDeadline"]);
    if (limit === undefined || fee === undefined || limit <= fee || !Number.isSafeInteger(apr)
      || apr < 0 || apr > 1_000_000 || !Number.isSafeInteger(commitment) || commitment < 0
      || commitment > 10_000 || !Number.isSafeInteger(expiry) || expiry <= now
      || !Number.isSafeInteger(setupDeadline) || setupDeadline <= now
      || !Number.isSafeInteger(maturity) || maturity < setupDeadline + duration
      || String(row["borrower"]).toLowerCase() !== String(intent["borrower"]).toLowerCase()
      || String(row["bundleId"]).toLowerCase() !== String(intent["bundleId"]).toLowerCase()
      || String(row["settlementAsset"]).toLowerCase() !== String(intent["settlementAsset"]).toLowerCase()
      || limit < funding + fee) return [];
    return [{ row, limit, fee, apr: BigInt(apr), commitment: BigInt(commitment) }];
  });
  if (!eligible.length) return [];
  const commonDraw = funding > 0n ? funding : eligible.reduce((min, quote) => {
    const available = quote.limit - quote.fee;
    return available < min ? available : min;
  }, eligible[0]!.limit - eligible[0]!.fee);
  const seconds = BigInt(duration);
  return eligible.map((quote) => {
    const publicQuote = { ...quote.row };
    delete publicQuote["_id"];
    delete publicQuote["__v"];
    delete publicQuote["createdAt"];
    delete publicQuote["updatedAt"];
    const interest = commonDraw * quote.apr * seconds / BPS / YEAR;
    const committed = quote.limit - commonDraw;
    const commitmentFee = committed * quote.commitment * seconds / BPS / YEAR;
    const estimatedTotalCost = quote.fee + interest + commitmentFee;
    return { ...publicQuote, id: quote.row["quoteId"], estimatedTotalCost: estimatedTotalCost.toString(),
      costAssumptions: { draw: commonDraw.toString(), durationSeconds: duration,
        interest: interest.toString(), commitmentFee: commitmentFee.toString() },
      _score: estimatedTotalCost, _limit: quote.limit };
  }).sort((a, b) => a._score < b._score ? -1 : a._score > b._score ? 1
    : a._limit > b._limit ? -1 : a._limit < b._limit ? 1
    : String(a.id).localeCompare(String(b.id)))
    .map(({ _score, _limit, ...offer }) => offer);
}
