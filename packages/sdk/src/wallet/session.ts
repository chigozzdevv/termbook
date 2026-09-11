export type SessionScope = {
  creditId: `0x${string}`;
  capabilities: string[];
  perAction: bigint;
  total: bigint;
  expiry: number;
};

export class Session {
  scope: SessionScope | null = null;

  start(scope: SessionScope): void {
    if (!/^0x[a-fA-F0-9]{64}$/.test(scope.creditId) || scope.capabilities.length === 0 || scope.perAction <= 0n || scope.total <= 0n || scope.perAction > scope.total || scope.expiry <= Math.floor(Date.now() / 1000)) throw new Error("param-invalid");
    this.scope = scope;
  }

  revoke(): void {
    this.scope = null;
  }

  canExecute(creditId: `0x${string}`, capability: string, amount: bigint): boolean {
    if (!this.scope || this.scope.creditId !== creditId || !this.scope.capabilities.includes(capability)) return false;
    if (this.scope.expiry <= Math.floor(Date.now() / 1000) || amount < 0n || amount > this.scope.perAction || amount > this.scope.total) return false;
    return true;
  }
}
