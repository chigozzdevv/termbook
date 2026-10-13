const monad = "https://testnet.monadscan.com";
const sourceExplorers: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  143: "https://monadscan.com",
  10143: monad,
  8453: "https://basescan.org",
  84532: "https://sepolia.basescan.org",
};

export const explorer = {
  address: (address: string) => `${monad}/address/${encodeURIComponent(address)}`,
  transaction: (hash: string) => `${monad}/tx/${encodeURIComponent(hash)}`,
  block: (number: number) => `${monad}/block/${number}`,
  asset: (address: string, chainId?: number) => {
    const origin = chainId === undefined ? undefined : sourceExplorers[chainId];
    return origin && /^0x[a-fA-F0-9]{40}$/.test(address) && !/^0x0{40}$/i.test(address)
      ? `${origin}/address/${encodeURIComponent(address)}`
      : undefined;
  },
};
