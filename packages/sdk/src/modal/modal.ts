import type { CollateralMarket, CapabilityDefinition, CapabilityCall } from "@termbook/schema";
import { capabilityCalls } from "@termbook/schema";
import { formatEther, parseAbiItem, parseUnits } from "viem";
import type { TermbookClient } from "../client/client.js";
import type { AppAction, ActionReview } from "../types/app.types.js";
import type { SourceLockWallet } from "../collateral/setup.js";
import { CollateralSetupInterruptedError } from "../collateral/setup.js";
import type { Offer } from "../intent/intent.js";
import type { Intent } from "../intent/intent.js";
import type { Credit } from "../credit/credit.js";
import type { ExecuteResult, ExecutionCheckpoint, ActionOutcome } from "../types/credit.types.js";
import { HttpClient } from "../transport/http.js";

export type OpenOptions = { action?: AppAction; tab?: "account" | "app"; creditId?: `0x${string}` };

const css = `
:host{position:fixed;inset:0;z-index:2147483647;font:14px/1.45 system-ui,sans-serif;color:#e8eef5}
*{box-sizing:border-box}.backdrop{position:absolute;inset:0;background:#070c14c9}
.panel{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(620px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;background:#101b29;border:1px solid #415267;border-radius:16px;box-shadow:0 24px 80px #0008;padding:20px}
header,.row,.tabs,.offer{display:flex;align-items:center;justify-content:space-between;gap:12px}header h2{margin:0;font-size:20px}.tabs{justify-content:flex-start;margin:18px 0;border-bottom:1px solid #415267}.tabs button{border-radius:8px 8px 0 0}
button,select,input,textarea{font:inherit}button{background:#24364a;color:#e8eef5;border:1px solid #526983;border-radius:8px;padding:9px 12px;cursor:pointer}button.primary{background:#146ad3;border-color:#3984de}button:disabled{opacity:.5;cursor:wait}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #80b7ff;outline-offset:2px}
label{display:block;margin:12px 0 4px;font-weight:600}input,select,textarea{width:100%;background:#0a1420;color:#e8eef5;border:1px solid #526983;border-radius:8px;padding:9px}textarea{min-height:75px}
.muted{color:#a8b8ca}.status{min-height:20px;margin:12px 0}.error{color:#ffadad}.card{border:1px solid #415267;border-radius:10px;padding:14px;margin:12px 0}.card h3{margin:0 0 8px}.card p{margin:5px 0}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}.offer{align-items:flex-start}.offer div{flex:1}.mono{font-family:ui-monospace,monospace;overflow-wrap:anywhere}small{display:block;color:#a8b8ca;margin-top:4px}
`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, (_, part) => typeof part === "bigint" ? part.toString() : part, 2);
}

function valueAt(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setValue(value: Record<string, unknown>, path: string, next: unknown): Record<string, unknown> {
  const parts = path.split(".");
  const result = { ...value };
  let cursor = result;
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part];
    cursor[part] = child && typeof child === "object" && !Array.isArray(child) ? { ...child } : {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = next;
  return result;
}

export class TermbookModal {
  readonly ready: Promise<void>;
  private readonly client: TermbookClient;
  private readonly host: HTMLDivElement;
  private readonly root: ShadowRoot;
  private readonly body: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly previousFocus: Element | null;
  private readonly keyHandler: (event: KeyboardEvent) => void;
  private readonly operationAbort = new AbortController();
  private readonly requestedTab?: "account" | "app";
  private tab: "account" | "app";
  private markets: CollateralMarket[] = [];
  private market?: CollateralMarket;
  private sourceWallet?: SourceLockWallet;
  private credits: Credit[] = [];
  private credit?: Credit;
  private summary?: Awaited<ReturnType<Credit["summary"]>>;
  private health?: Awaited<ReturnType<Credit["account"]["health"]>>;
  private closureSupport?: Awaited<ReturnType<Credit["closureSupport"]>>;
  private repaymentReview?: Awaited<ReturnType<Credit["reviewRepayment"]>>;
  private intent?: Intent;
  private offers: Offer[] = [];
  private offer?: Offer;
  private action?: AppAction;
  private readonly preparedAction: boolean;
  private editingAction = false;
  private review?: ActionReview;
  private recentAction?: { capability: string; status: ExecuteResult["status"]; tx?: `0x${string}`; checkpoint?: ExecutionCheckpoint };
  private amountText = "";
  private limitText = "";
  private durationDays = "30";
  private busy = false;
  private closed = false;
  private fieldSeq = 0;

  constructor(client: TermbookClient, options: OpenOptions = {}) {
    if (typeof document === "undefined" || !document.body) throw new Error("modal-dom-unavailable");
    this.client = client;
    this.action = options.action ? { capability: options.action.capability, params: { ...options.action.params } } : undefined;
    this.preparedAction = !!options.action;
    this.requestedTab = options.tab;
    this.tab = options.tab ?? (options.action ? "app" : "account");
    this.previousFocus = document.activeElement;
    this.host = element("div");
    this.root = this.host.attachShadow({ mode: "open" });
    const style = element("style");
    style.textContent = css;
    const backdrop = element("div", undefined, "backdrop");
    const panel = element("section", undefined, "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Termbook");
    const header = element("header");
    const closeButton = element("button", "Close");
    closeButton.type = "button";
    closeButton.addEventListener("click", () => this.close());
    header.append(element("h2", "Termbook"), closeButton);
    this.status = element("div", "Loading…", "status");
    this.body = element("div");
    panel.append(header, this.status, this.body);
    this.root.append(style, backdrop, panel);
    document.body.append(this.host);
    backdrop.addEventListener("click", () => this.close());
    this.keyHandler = (event) => {
      if (this.closed) return;
      if (event.key === "Escape") { event.preventDefault(); this.close(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(this.root.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)"));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && this.root.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && this.root.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", this.keyHandler);
    (header.querySelector("button") as HTMLButtonElement).focus();
    this.ready = this.load(options.creditId).catch((error: unknown) => this.showError(error));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.operationAbort.abort();
    document.removeEventListener("keydown", this.keyHandler);
    this.host.remove();
    if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus();
  }

  private button(label: string, action: () => void | Promise<void>, primary = false): HTMLButtonElement {
    const button = element("button", label, primary ? "primary" : undefined);
    button.type = "button";
    button.addEventListener("click", () => void this.run(action));
    return button;
  }

  private async run(action: () => void | Promise<void>): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    try { await action(); } catch (error) { this.showError(error); }
    finally { this.busy = false; }
  }

  private showError(error: unknown): void {
    if (this.closed) return;
    this.status.className = "status error";
    this.status.textContent = error instanceof Error ? error.message : "operation-failed";
  }

  private showStatus(message: string): void {
    if (this.closed) return;
    this.status.className = "status";
    this.status.textContent = message;
  }

  private storageKey(): string {
    return `termbook:${this.client.config.appToken}:${this.client.signer.address().toLowerCase()}`;
  }

  private savedIds(): string[] {
    try {
      const value = JSON.parse(localStorage.getItem(this.storageKey()) ?? "[]") as unknown;
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && /^0x[a-fA-F0-9]{64}$/.test(id)) : [];
    } catch { return []; }
  }

  private saveId(id: `0x${string}`): void {
    try { localStorage.setItem(this.storageKey(), stringify([...new Set([...this.savedIds(), id])])); } catch { /* storage is optional */ }
  }

  private loadRecentAction(id: `0x${string}`): void {
    this.recentAction = undefined;
    try {
      const raw = localStorage.getItem(`${this.storageKey()}:action:${id}`);
      if (!raw) return;
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (typeof value["capability"] === "string" && ["settled", "partial", "pending", "failed", "cancelled", "expired"].includes(String(value["status"]))
        && (value["tx"] === undefined || typeof value["tx"] === "string" && /^0x[a-fA-F0-9]{64}$/.test(value["tx"]))) {
        this.recentAction = { capability: value["capability"], status: value["status"] as ExecuteResult["status"],
          tx: value["tx"] as `0x${string}` | undefined, checkpoint: value["checkpoint"] as ExecutionCheckpoint | undefined };
      }
    } catch { /* storage is optional */ }
  }

  private saveRecentAction(result: ExecuteResult): void {
    const capability = result.checkpoint?.capability ?? this.action?.capability ?? this.recentAction?.capability;
    if (!this.credit || !capability) return;
    this.recentAction = { capability, status: result.status, tx: result.tx, checkpoint: result.checkpoint };
    try { localStorage.setItem(`${this.storageKey()}:action:${this.credit.id}`, stringify(this.recentAction)); } catch { /* storage is optional */ }
  }

  private executionProgress(checkpoint: ExecutionCheckpoint, outcomes: ActionOutcome[]): void {
    this.saveRecentAction({ status: "pending", tx: checkpoint.tx, draw: 0n, checkpoint });
    const fills = outcomes.map((state) => `${state.status}: filled ${state.filled}, refunded ${state.refunded}, remaining ${state.remaining}`).join("; ");
    this.showStatus(fills || "Waiting for finalized application settlement…");
    this.render();
  }

  private async load(preferred?: `0x${string}`): Promise<void> {
    await this.client.ready();
    const http = new HttpClient(this.client.config.apiBase!);
    const [markets, serverRows] = await Promise.all([
      this.client.catalog.collateralMarkets(),
      http.get<{ creditId: string }[]>(`/credits?borrower=${this.client.signer.address()}`).catch(() => []),
    ]);
    this.markets = markets;
    this.market = markets[0];
    const ids = [...new Set([...serverRows.map((row) => row.creditId), ...this.savedIds()])];
    const verified = await Promise.all(ids.map(async (id) => {
      if (!/^0x[a-fA-F0-9]{64}$/.test(id)) return undefined;
      const credit = this.client.credit(id as `0x${string}`);
      const details = await credit.details().catch(() => null);
      if (!details) return undefined;
      const field = (key: string, index: number) => Array.isArray(details) ? details[index] : details[key];
      return String(field("borrower", 2)).toLowerCase() === this.client.signer.address().toLowerCase()
        && String(field("bundleId", 20)).toLowerCase() === this.client.config.versionId?.toLowerCase()
        ? credit : undefined;
    }));
    this.credits = verified.filter((credit): credit is Credit => !!credit);
    this.credit = this.credits.find((credit) => credit.id.toLowerCase() === preferred?.toLowerCase())
      ?? this.credits[0];
    if (this.credit) {
      this.summary = await this.credit.summary();
      this.health = await this.credit.account.health().catch(() => undefined);
      this.closureSupport = await this.credit.closureSupport().catch(() => undefined);
      this.loadRecentAction(this.credit.id);
    }
    if (!this.requestedTab && !this.action && this.summary?.facility === "ready") this.tab = "app";
    this.showStatus(this.credits.length ? "Select a credit or create one." : "Choose collateral to request credit.");
    this.render();
  }

  private render(): void {
    if (this.closed) return;
    this.body.replaceChildren();
    const tabs = element("nav", undefined, "tabs");
    for (const name of ["account", "app"] as const) {
      const button = this.button(name === "account" ? "Account" : "App", () => { this.tab = name; this.render(); });
      button.setAttribute("aria-current", this.tab === name ? "page" : "false");
      tabs.append(button);
    }
    this.body.append(tabs);
    if (this.credits.length) {
      const row = element("div", undefined, "row");
      const select = element("select");
      for (const credit of this.credits) {
        const option = element("option", `Credit ${credit.id.slice(0, 10)}…`);
        option.value = credit.id;
        option.selected = credit.id === this.credit?.id;
        select.append(option);
      }
      select.addEventListener("change", () => void this.run(async () => {
        this.credit = this.credits.find((credit) => credit.id === select.value);
        this.summary = this.credit ? await this.credit.summary() : undefined;
        this.health = this.credit ? await this.credit.account.health().catch(() => undefined) : undefined;
        this.closureSupport = this.credit ? await this.credit.closureSupport().catch(() => undefined) : undefined;
        this.repaymentReview = undefined;
        if (this.credit) this.loadRecentAction(this.credit.id);
        else this.recentAction = undefined;
        this.review = undefined;
        this.render();
      }));
      row.append(select);
      if (!this.summary || !["reserved", "collateral_locking", "collateral_proving", "account_creating"].includes(this.summary.facility)) {
        row.append(this.button("New credit", () => { this.credit = undefined; this.summary = undefined; this.health = undefined; this.recentAction = undefined; this.tab = "account"; this.render(); }));
      }
      this.body.append(row);
    }
    if (this.tab === "account") this.renderAccount();
    else this.renderApp();
  }

  private renderAccount(): void {
    if (this.credit && this.summary) {
      const card = element("div", undefined, "card");
      card.append(element("h3", "Credit account"));
      for (const [label, value] of [
        ["Status", this.summary.facility], ["Limit", this.summary.limit.toString()],
        ["Debt", this.summary.debt.toString()], ["Account", this.summary.account ?? "Pending"],
        ["Recovery health", this.summary.debt === 0n ? "No debt" : this.health?.value === null || !this.health ? "Unavailable" : `${this.health.value} bps (${this.health.state})`],
      ]) card.append(element("p", `${label}: ${value}`));
      const actions = element("div", undefined, "actions");
      actions.append(this.button("Refresh", async () => {
        this.summary = await this.credit!.summary(); this.health = await this.credit!.account.health().catch(() => undefined);
        this.closureSupport = await this.credit!.closureSupport().catch(() => undefined); this.render();
      }));
      if (this.summary.facility === "ready" || this.summary.facility === "closing") {
        actions.append(this.button("Review repayment", async () => {
          this.repaymentReview = await this.credit!.reviewRepayment({ amount: "max", from: "wallet" });
          this.render();
        }));
      }
      if (this.repaymentReview) {
        const review = this.repaymentReview;
        card.append(element("p", `Repay current debt ${review.debt}. Maximum wallet payment ${review.cap}, including interest until ${new Date(review.deadline * 1000).toLocaleTimeString()}. Only the debt due at settlement is transferred.`));
        actions.append(this.button("Confirm repayment", async () => {
          const result = await this.credit!.repay({ amount: "max", from: "wallet", maxPayment: review.cap, deadline: review.deadline });
          this.repaymentReview = undefined;
          this.showStatus(`Repayment ${result.status}; paid ${result.applied}; remaining debt ${result.remaining}.${result.approvalCleanupRequired ? " Clear the unused token approval in your wallet." : ""}`);
          this.summary = await this.credit!.summary(); this.render();
        }, true));
      }
      if (this.summary.facility === "ready" || this.summary.facility === "closing") {
        actions.append(this.button(this.summary.facility === "closing" ? "Continue closure" : "Close facility", async () => {
          await this.closeFacility();
        }));
        if (this.summary.facility === "ready" && this.closureSupport?.retention) {
          card.append(element("p", "You can repay and keep the position. This freezes trading and requires full repayment before account ownership and collateral are released."));
          actions.append(this.button("Repay and keep position", () => this.closeFacility("retain")));
        }
      }
      if (["reserved", "collateral_locking", "collateral_proving", "account_creating"].includes(this.summary.facility)) {
        actions.append(this.button("Continue setup", () => this.resumeSetup()));
      }
      card.append(actions);
      this.body.append(card);
      return;
    }
    if (!this.market || this.markets.length === 0) {
      this.body.append(element("p", "No collateral market is currently admitted. Try again after governance and the market operator publish one.", "muted"));
      return;
    }
    const form = element("div", undefined, "card");
    form.append(element("h3", "Request credit"));
    form.append(element("label", "Collateral market"));
    const marketSelect = element("select");
    for (const market of this.markets) {
      const option = element("option", `${market.label} (${market.kind === "evm" ? market.chainId : "Solana"})`);
      option.value = market.id; option.selected = market.id === this.market.id; marketSelect.append(option);
    }
    marketSelect.addEventListener("change", () => {
      this.market = this.markets.find((market) => market.id === marketSelect.value);
      this.sourceWallet = undefined; this.intent = undefined; this.offers = []; this.offer = undefined; this.render();
    });
    form.append(marketSelect);
    const source = this.button(this.sourceWallet ? `Source wallet ${this.sourceWallet.account.accountBytes.slice(0, 12)}…` : "Connect source wallet", async () => {
      this.sourceWallet = await this.client.sourceWallet(this.market!);
      this.showStatus("Source wallet connected. Review collateral and terms."); this.render();
    });
    form.append(source);
    form.append(this.input("Collateral amount", this.amountText, (value) => { this.amountText = value; }, `Decimal amount, ${this.market.decimals} decimals`));
    form.append(this.input("Duration (days)", this.durationDays, (value) => { this.durationDays = value; }));
    form.append(this.input(this.action ? "Borrow limit cap (optional, base units)" : "Borrow limit (base units)", this.limitText,
      (value) => { this.limitText = value; }));
    const controls = element("div", undefined, "actions");
    controls.append(this.button("Find offers", () => this.findOffers(), true));
    form.append(controls);
    this.body.append(form);
    if (this.offers.length) this.renderOffers();
  }

  private async closeFacility(mode?: "unwind" | "retain"): Promise<void> {
    try {
      await this.credit!.close({ mode, signal: this.operationAbort.signal, onProgress: ({ stage }) => this.showStatus({
        freezing: "Stopping new trades…", unwinding: "Closing positions…",
        settlement_pending: "Waiting for the application to settle…", repaying: "Repaying the House…",
        funding_required: "Repay the remaining debt, then continue closure.",
        withdrawing_surplus: "Returning remaining account funds…", return_pending: "Waiting for collateral return confirmation…",
        closed: "Facility closed.",
      }[stage]) });
    } finally {
      this.summary = await this.credit!.summary();
      this.closureSupport = await this.credit!.closureSupport().catch(() => undefined);
      this.render();
    }
  }

  private input(label: string, value: string, update: (value: string) => void, hint?: string): HTMLDivElement {
    const wrapper = element("div");
    const input = element("input");
    const id = `termbook-field-${++this.fieldSeq}`;
    input.id = id;
    input.value = value;
    input.addEventListener("input", () => update(input.value));
    const fieldLabel = element("label", label);
    fieldLabel.htmlFor = id;
    wrapper.append(fieldLabel, input);
    if (hint) wrapper.append(element("small", hint));
    return wrapper;
  }

  private async findOffers(): Promise<void> {
    if (!this.market || !this.sourceWallet) throw new Error("source-wallet-required");
    if (!this.client.config.actions?.find((item) => item.capability === this.action?.capability) && this.action) {
      throw new Error("capability-denied");
    }
    const amount = parseUnits(this.amountText, this.market.decimals);
    const days = Number(this.durationDays);
    if (amount <= 0n || !Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error("credit-terms-invalid");
    const limit = this.limitText ? BigInt(this.limitText) : undefined;
    if (!this.action && (!limit || limit <= 0n)) throw new Error("credit-limit-required");
    const owner = this.sourceWallet.account;
    const collateral = this.market.kind === "evm"
      ? { chainId: this.market.chainId, asset: this.market.asset as `0x${string}`, amount,
        owner: owner.accountBytes as `0x${string}`, recipient: owner.accountBytes as `0x${string}` }
      : { chain: { namespace: "solana" as const, reference: this.market.genesis as `0x${string}` },
        asset: { namespace: "solana" as const, reference: this.market.genesis as `0x${string}`,
          kind: "native" as const, assetBytes: this.market.asset as `0x${string}` }, amount,
        owner: { namespace: "solana" as const, reference: this.market.genesis as `0x${string}`,
          accountBytes: owner.accountBytes as `0x${string}` },
        returnRecipient: { namespace: "solana" as const, reference: this.market.genesis as `0x${string}`,
          accountBytes: owner.accountBytes as `0x${string}` } };
    this.showStatus("Requesting House offers…");
    this.intent = this.client.intent({ collateral, credit: { duration: days * 86400, limit }, action: this.action });
    this.offers = await this.intent.offers();
    this.offer = undefined;
    this.showStatus(this.offers.length ? "Select an offer to review its terms." : "No compatible House offer is available.");
    this.render();
  }

  private renderOffers(): void {
    const section = element("div");
    section.append(element("h3", "House offers"));
    for (const offer of this.offers) {
      const card = element("div", undefined, "card offer");
      const detail = element("div");
      detail.append(element("p", `Limit ${offer.limit} base units · APR ${offer.aprBps / 100}%`));
      if (offer.estimatedTotalCost !== undefined) detail.append(element("p", `Estimated total cost ${offer.estimatedTotalCost} base units for a ${offer.costAssumptions?.draw ?? 0n} base-unit draw over ${offer.costAssumptions?.durationSeconds ?? 0} seconds.`));
      if (offer.riskTerms) detail.append(element("p", `Required initial health ${offer.riskTerms.initialBps} bps · Recovery threshold ${offer.riskTerms.liquidationBps} bps`));
      detail.append(element("small", `Fee ${offer.originationFee} · Bond ${offer.reservationBond} · Maturity ${new Date(offer.maturity * 1000).toLocaleString()}`));
      card.append(detail, this.button("Review terms", () => { this.offer = offer; this.render(); }));
      section.append(card);
    }
    if (this.offer) {
      const terms = element("div", undefined, "card");
      terms.append(element("h3", "Confirm offer"));
      terms.append(element("p", `House ${this.offer.house}`, "mono"));
      terms.append(element("p", `Collateral ${this.offer.collateralAmount} · Credit ${this.offer.limit} · APR ${this.offer.aprBps / 100}%`));
      terms.append(element("p", `Origination fee ${this.offer.originationFee} · Reservation bond ${this.offer.reservationBond}`));
      terms.append(element("p", this.offer.retentionSupported ? "Exit options: unwind positions, or repay and keep positions after verified ownership release." : "Exit option: unwind positions and repay before closure."));
      if (this.offer.reservationTerms) {
        const reservation = this.offer.reservationTerms;
        terms.append(element("p", `Reservation rate ${reservation.annualRateBps / 100}% annually on the reserved limit until ready or the setup deadline.`));
        terms.append(element("p", `Setup fee ${reservation.readyFee} · Abandonment fee ${reservation.abandonFee + reservation.repeatCharge} · Expiry fee ${reservation.expiryFee + reservation.repeatCharge}.`));
        terms.append(element("p", "Unused bond returns to the authorized payer. An attested protocol setup failure refunds the full bond."));
      }
      if (this.offer.estimatedTotalCost !== undefined) terms.append(element("p", `Estimated total cost ${this.offer.estimatedTotalCost} base units for a ${this.offer.costAssumptions?.draw ?? 0n} base-unit draw over ${this.offer.costAssumptions?.durationSeconds ?? 0} seconds.`));
      if (this.offer.riskTerms) terms.append(element("p", `Initial ${this.offer.riskTerms.initialBps} · Maintenance ${this.offer.riskTerms.maintenanceBps} · Watch ${this.offer.riskTerms.watchBps} · Freeze ${this.offer.riskTerms.freezeBps} · Recovery ${this.offer.riskTerms.liquidationBps} bps`));
      terms.append(element("p", `Expires ${new Date(this.offer.expiry * 1000).toLocaleString()}`));
      terms.append(this.button("Accept offer", () => this.acceptOffer(), true));
      section.append(terms);
    }
    this.body.append(section);
  }

  private async acceptOffer(): Promise<void> {
    if (!this.intent || !this.offer || !this.sourceWallet) throw new Error("offer-required");
    this.showStatus("Waiting for wallet approvals and collateral confirmation…");
    try {
      this.credit = await this.intent.accept({ offer_id: this.offer.id, reviewedOffer: this.offer, source_wallet: this.sourceWallet,
        on_progress: (checkpoint, binding) => {
          this.saveId(binding.creditId);
          this.showStatus(`Collateral setup: ${checkpoint.stage.replaceAll("_", " ")}.`);
          try { localStorage.setItem(`${this.storageKey()}:setup:${binding.creditId}`, stringify({ binding, checkpoint })); } catch { /* storage is optional */ }
        } });
    } catch (error) {
      if (error instanceof Error && ["offer-review-stale", "offer-not-found"].includes(error.message)) {
        this.offers = await this.intent.offers();
        this.offer = undefined;
        this.showStatus("House terms changed. Review the current offers.");
        this.render();
        return;
      }
      if (!(error instanceof CollateralSetupInterruptedError)) throw error;
      this.credit = error.setup.credit;
      this.credit.setup = error.setup;
      this.saveId(this.credit.id);
      this.showError(error.cause);
    }
    if (!this.credit) return;
    this.saveId(this.credit.id);
    this.loadRecentAction(this.credit.id);
    await this.trackCredit(this.credit, this.offer.house).catch(() => undefined);
    if (!this.credits.some((credit) => credit.id === this.credit!.id)) this.credits.push(this.credit);
    this.summary = await this.credit.summary();
    this.closureSupport = await this.credit.closureSupport().catch(() => undefined);
    this.offers = []; this.offer = undefined;
    if (this.summary.facility === "ready" && this.action) this.tab = "app";
    this.render();
  }

  private async trackCredit(credit: Credit, house: `0x${string}`): Promise<void> {
    await this.client.authenticatedPost("/credits", { creditId: credit.id, borrower: this.client.signer.address(), house });
  }

  private async resumeSetup(): Promise<void> {
    if (!this.credit) return;
    if (!this.credit.setup) {
      let saved: string | null;
      try { saved = localStorage.getItem(`${this.storageKey()}:setup:${this.credit.id}`); } catch { saved = null; }
      if (!saved) throw new Error("setup-checkpoint-unavailable");
      if (!this.sourceWallet) {
        const parsed = JSON.parse(saved) as { binding?: { asset?: { namespace?: string; reference?: string; assetBytes?: string } } };
        const asset = parsed.binding?.asset;
        const market = this.markets.find((entry) => entry.kind === "solana"
          ? asset?.namespace === "solana" && entry.genesis.toLowerCase() === asset.reference?.toLowerCase()
          : asset?.namespace === "eip155" && String(entry.chainId) === asset.reference
            && entry.asset.toLowerCase() === asset.assetBytes?.toLowerCase());
        if (!market) throw new Error("setup-market-unavailable");
        this.market = market;
        this.sourceWallet = await this.client.sourceWallet(market);
      }
      this.credit.setup = await this.client.collateral_setup(saved, { sourceWallet: this.sourceWallet,
        onProgress: (checkpoint, binding) => {
          this.showStatus(`Collateral setup: ${checkpoint.stage.replaceAll("_", " ")}.`);
          try { localStorage.setItem(`${this.storageKey()}:setup:${binding.creditId}`, stringify({ binding, checkpoint })); } catch { /* storage is optional */ }
        } });
    }
    const checkpoint = await this.credit.setup.resume();
    this.showStatus(`Collateral setup: ${checkpoint.stage.replaceAll("_", " ")}.`);
    this.summary = await this.credit.summary();
    if (checkpoint.stage === "ready" && this.action) this.tab = "app";
    this.render();
  }

  private renderApp(): void {
    if (this.recentAction) {
      const status = element("div", undefined, "card");
      status.append(element("h3", "Recent action"), element("p", `${this.recentAction.capability.replaceAll("_", " ")}: ${this.recentAction.status}`));
      if (this.recentAction.tx) status.append(element("p", this.recentAction.tx, "mono"));
      if (this.recentAction.status === "pending" && this.credit) {
        status.append(this.button("Resume action", async () => {
          const result = await this.credit!.app.resumeExecution({ checkpoint: this.recentAction?.checkpoint,
            signal: this.operationAbort.signal, onProgress: (checkpoint, outcomes) => this.executionProgress(checkpoint, outcomes) });
          this.saveRecentAction(result); this.showStatus(`Action ${result.status}.`); this.render();
        }));
      }
      this.body.append(status);
    }
    if (!this.credit || !this.summary || this.summary.facility !== "ready") {
      this.body.append(element("p", this.action ? "Your saved action is ready for review after a compatible credit is ready." : "Select or create a ready credit in Account.", "muted"));
      if (this.action) {
        const card = element("div", undefined, "card");
        card.append(element("h3", this.action.capability.replaceAll("_", " ")),
          element("pre", stringify(this.action.params), "mono"));
        this.body.append(card);
      }
      this.body.append(this.button("Go to Account", () => { this.tab = "account"; this.render(); }));
      return;
    }
    const definitions = this.client.config.actions ?? [];
    if (!definitions.length) { this.body.append(element("p", "No application capability is published.", "muted")); return; }
    if (!this.preparedAction || this.editingAction) {
      const picker = element("select");
      const placeholder = element("option", "Select an action"); placeholder.value = ""; picker.append(placeholder);
      for (const definition of definitions) {
        const option = element("option", definition.label);
        option.value = definition.capability; option.selected = this.action?.capability === definition.capability; picker.append(option);
      }
      picker.addEventListener("change", () => { this.action = picker.value ? { capability: picker.value, params: {} } : undefined; this.review = undefined; this.render(); });
      this.body.append(element("label", "Application action"), picker);
    }
    if (!this.action) return;
    const definition = definitions.find((item) => item.capability === this.action!.capability);
    if (!definition) { this.body.append(element("p", "This action is no longer available.", "error")); return; }
    const form = element("div", undefined, "card");
    form.append(element("h3", definition.label));
    if (this.preparedAction && !this.editingAction) {
      form.append(element("pre", stringify(this.action.params), "mono"));
      form.append(this.button("Edit trade", () => { this.editingAction = true; this.review = undefined; this.render(); }));
    } else this.renderActionFields(form, definition);
    const controls = element("div", undefined, "actions");
    controls.append(this.button("Review action", async () => {
      this.review = await this.credit!.app.review(this.action!);
      this.showStatus("Review the fresh funding and debt amounts before confirming."); this.render();
    }));
    form.append(controls);
    if (this.review) {
      const review = element("div", undefined, "card");
      review.append(element("h3", "Execution review"));
      review.append(element("p", `Required input ${this.review.requiredInput} · Free account assets ${this.review.freeAssets}`));
      review.append(element("p", `New draw ${this.review.draw} · Debt ${this.review.currentDebt} → ${this.review.projectedDebt}`));
      if (this.review.nativeValue) review.append(element("p", `MON attached to calls ${formatEther(this.review.nativeValue)}`));
      for (const spend of this.review.spending ?? []) review.append(element("p", `Spend ${spend.amount} of token ${spend.token}`));
      review.append(element("p", `Origination fee ${this.review.originationFee} · Current recovery health ${this.review.healthBps === null ? "unavailable" : `${this.review.healthBps} bps (${this.review.healthState})`}`));
      review.append(element("p", `Projected recovery health ${this.review.projectedHealthBps} bps · Required ${this.review.initialHealthBps} bps`));
      review.append(element("p", `Projected recoverable value ${this.review.projectedRecoveryValue}`));
      if (this.review.price) {
        const label = this.review.boundKind === "min_output" ? "Minimum token output" : this.review.boundKind === "max_input" ? "Maximum token input"
          : `${this.review.price.isMax ? "Maximum" : "Minimum"} execution price`;
        review.append(element("p", `Slippage ${this.review.price.slippageBps} bps · ${label} ${this.review.price.bound}`));
        review.append(element("small", "Token bounds use smallest token units. A changed bound requires a fresh review."));
      }
      if (!this.review.canExecute) review.append(element("p", "This action is below the required recovery health.", "error"));
      review.append(element("small", `Settlement asset ${this.review.settlementAsset}. Amounts shown in smallest token units.`));
      if (this.review.canExecute) review.append(this.button("Confirm action", async () => {
        if (!this.review) throw new Error("action-review-required");
        const result = await this.credit!.app.execute(this.action!, this.review, undefined, {
          signal: this.operationAbort.signal, onProgress: (checkpoint, outcomes) => this.executionProgress(checkpoint, outcomes),
        });
        this.saveRecentAction(result);
        this.review = undefined;
        this.summary = await this.credit!.summary();
        this.showStatus(`Action ${result.status}. Transaction ${result.tx ?? "unavailable"}.`);
        this.render();
      }, true));
      form.append(review);
    }
    this.body.append(form);
  }

  private renderActionFields(container: HTMLElement, definition: CapabilityDefinition): void {
    const fields = capabilityCalls(definition).flatMap((call) => {
      const item = parseAbiItem(call.signature);
      return item.type !== "function" ? [] : call.arguments.map((argument, index) => ({ argument, type: item.inputs[index]?.type }));
    });
    const addField = (path: string | undefined, label: string, max?: string) => {
      if (path) fields.push({ argument: { source: "input", path, label, ...(max ? { min: "0", max } : {}) } as CapabilityCall["arguments"][number], type: "uint256" });
    };
    for (const call of capabilityCalls(definition)) {
      addField(call.valuePath, "MON value (wei)");
      addField(call.spendPath, "Token amount (smallest units)");
    }
    addField(definition.price?.slippagePath, "Slippage (basis points)", "5000");
    addField(definition.exposurePath, "Exposure (settlement units)");
    const shown = new Set<string>();
    for (const { argument, type } of fields) {
      if (argument.source !== "input" || !argument.path || shown.has(argument.path)) continue;
      shown.add(argument.path);
      const path = argument.path;
      const current = valueAt(this.action!.params, path);
      const label = element("label", argument.label ?? path.replaceAll("_", " "));
      const id = `termbook-field-${++this.fieldSeq}`;
      label.htmlFor = id;
      const choices = argument.choices;
      let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (choices) {
        const select = element("select");
        const empty = element("option", "Select"); empty.value = ""; select.append(empty);
        for (const choice of Object.keys(choices)) {
          const option = element("option", choice); option.value = choice; option.selected = current === choice; select.append(option);
        }
        input = select;
      } else if (type === "tuple" || type?.endsWith("]")) {
        input = element("textarea");
        input.value = current === undefined ? "" : stringify(current);
      } else if (type === "bool") {
        const select = element("select");
        for (const [value, text] of [["", "Select"], ["true", "Yes"], ["false", "No"]]) {
          const option = element("option", text); option.value = value; option.selected = current === (value === "true") && value !== "";
          select.append(option);
        }
        input = select;
      } else {
        input = element("input");
        input.value = current === undefined ? "" : String(current);
      }
      input.addEventListener("input", () => {
        const next = input instanceof HTMLTextAreaElement ? (() => { try { return JSON.parse(input.value) as unknown; } catch { return input.value; } })()
          : type === "bool" && !choices ? input.value === "true" ? true : input.value === "false" ? false : input.value
          : input.value;
        this.action = { ...this.action!, params: setValue(this.action!.params, path, next) };
        this.review = undefined;
        const oldReview = container.querySelector(".card");
        oldReview?.remove();
      });
      input.id = id;
      container.append(label, input);
      if (argument.min || argument.max) container.append(element("small", `Allowed ${argument.min ?? "0"}–${argument.max ?? "contract limit"}`));
    }
  }
}
