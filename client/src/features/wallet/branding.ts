import type { BrowserWallet, Provider } from "./connection";

// Brand assets: metamask.io/assets and github.com/RabbyHub/logo.
export const brands = [
  {
    name: "MetaMask",
    rdns: "io.metamask",
    icon: "/wallets/metamask.svg",
    href: "https://metamask.io/download",
  },
  { name: "Rabby", rdns: "io.rabby", icon: "/wallets/rabby.svg", href: "https://rabby.io/" },
] as const;

export function brandFor(info: BrowserWallet["info"]) {
  return brands.find(
    (brand) => brand.rdns === info.rdns || brand.name.toLowerCase() === info.name.toLowerCase(),
  );
}

export function imageSource(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 250_000) return;
  if (brands.some((brand) => brand.icon === value)) return value;
  if (
    /^data:image\/(?:svg\+xml|png|webp|jpeg)(?:;charset=[a-z0-9_-]+)?(?:;base64)?,.+$/i.test(value)
  )
    return value;
}

export function legacyInfo(provider: Provider): BrowserWallet["info"] {
  const flags = provider as Provider & { isRabby?: boolean; isMetaMask?: boolean };
  const brand = flags.isRabby ? brands[1] : flags.isMetaMask ? brands[0] : undefined;
  return {
    uuid: "injected",
    name: brand?.name ?? "Browser wallet",
    icon: brand?.icon,
    rdns: brand?.rdns,
  };
}
