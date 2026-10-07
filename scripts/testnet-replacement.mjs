export async function verifySettledCredits(previous, evidence, read) {
  const core = previous.addresses[10143].TermbookCore;
  const count = await read(10143, "TermbookCore", core, "acceptedCredits");
  if (count === 0n) return [];
  if (evidence?.core?.toLowerCase() !== core.toLowerCase()) throw new Error("Previous credit evidence mismatch");
  const credits = evidence.observations;
  if (!Array.isArray(credits) || BigInt(credits.length) !== count
    || new Set(credits.map((credit) => credit.creditId)).size !== credits.length) {
    throw new Error("Previous credit inventory is incomplete");
  }
  const observations = [];
  for (const entry of credits) {
    const credit = await read(10143, "TermbookCore", core, "creditDetails", [entry.creditId]);
    if (![6, 7, 10].includes(credit.facility) || credit.debt !== 0n || !credit.collateralReturned
      || credit.account.toLowerCase() !== entry.account.toLowerCase() || credit.lockId !== entry.lockId) {
      throw new Error("Replacement requires settlement of every previous credit");
    }
    const lock = await read(11155111, "CollateralVault", credit.collateralVault, "locks", [entry.lockId]);
    if (lock[2] !== 0n || credit.facility !== 7
      && !await read(10143, "CreditAccount", credit.account, "released")) {
      throw new Error("Previous custody has not been released");
    }
    observations.push({ creditId: entry.creditId, facility: credit.facility, debt: "0", sourceLockedAmount: "0" });
  }
  return observations;
}
