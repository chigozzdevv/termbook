import { ChevronDown, Globe } from "lucide-react";

export function Network() {
  return (
    <span className="network-switch">
      <span className="network-label" aria-hidden="true">
        <Globe size={18} className="network-icon" />
        <span className="network-name">Monad testnet</span>
        <ChevronDown size={14} />
      </span>
      <select aria-label="Network" title="Monad testnet" defaultValue="10143" className="network-select">
        <option value="10143">Monad testnet</option>
        <option value="143" disabled>
          Monad mainnet
        </option>
      </select>
    </span>
  );
}
