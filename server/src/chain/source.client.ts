export type ProofBundle = { header: string; proof: string; finalized: boolean };

export async function fetchProof(sourceRpc: string, lockId: string): Promise<ProofBundle> {
  let base: URL;
  try {
    base = new URL(sourceRpc);
  } catch {
    throw new Error("proof-invalid");
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("proof-invalid");
  if (!/^0x[a-fA-F0-9]{64}$/.test(lockId)) throw new Error("proof-invalid");
  const proofUrl = new URL(base.toString());
  proofUrl.pathname = `${proofUrl.pathname.replace(/\/$/, "")}/proof/${lockId}`;
  proofUrl.search = "";
  const res = await fetch(proofUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res || !res.ok) throw new Error("proof-unavailable");
  const body = (await res.json()) as { header?: string; proof?: string; finalized?: boolean };
  if (!body.header || !/^0x[0-9a-fA-F]+$/.test(body.header) || body.header.length < 194 || body.header.length % 2 !== 0 || !body.proof || !/^0x[0-9a-fA-F]+$/.test(body.proof) || body.proof.length < 258 || body.proof.length % 2 !== 0 || body.finalized !== true) throw new Error("proof-invalid");
  return { header: body.header, proof: body.proof, finalized: true };
}
