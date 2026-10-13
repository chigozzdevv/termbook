import { ChevronDown } from "lucide-react";

export function Network() {
  return (
    <span className="network-switch">
      <span className="network-label" aria-hidden="true">
        Monad testnet
        <ChevronDown size={14} />
      </span>
      <select aria-label="Network" defaultValue="10143" className="network-select">
        <option value="10143">Monad testnet</option>
        <option value="143" disabled>
          Monad mainnet
        </option>
      </select>
    </span>
  );
}
