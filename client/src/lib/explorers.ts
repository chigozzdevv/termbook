const monad = "https://testnet.monadscan.com";

export const explorer = {
  address: (address: string) => `${monad}/address/${encodeURIComponent(address)}`,
  transaction: (hash: string) => `${monad}/tx/${encodeURIComponent(hash)}`,
  block: (number: number) => `${monad}/block/${number}`,
};
