import { Select } from "@/components/ui/select";

export function Network() {
  return (
    <Select
      aria-label="Network"
      defaultValue="10143"
      wrapperClassName="network-switch"
      className="network-select"
    >
      <option value="10143">Monad testnet</option>
      <option value="143" disabled>
        Monad mainnet
      </option>
    </Select>
  );
}
