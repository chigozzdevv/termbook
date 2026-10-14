import type { CollateralMarket, CapabilityDefinition, CapabilityCall, TermAction } from "@termbook/schema";
import { assertActionUseCase, assertStandardAction, capabilityCalls, matchesAction, standardActionFields } from "@termbook/schema";
import { formatUnits, parseAbi, parseAbiItem, zeroAddress } from "viem";
import type { TermbookClient } from "../client/client.js";
import type { AppAction, ActionReview } from "../types/app.types.js";
import type { SourceLockWallet } from "../collateral/setup.js";
import { CollateralSetupInterruptedError } from "../collateral/setup.js";
import { solanaAlias, solanaPubkeyBase58 } from "../collateral/solana.js";
import type { Offer } from "../intent/intent.js";
import type { Intent } from "../intent/intent.js";
import type { Credit } from "../credit/credit.js";
import type { ExecuteResult, ExecutionCheckpoint, ActionOutcome } from "../types/credit.types.js";
import { HttpClient } from "../transport/http.js";
import { modalStyle } from "./modal-style.js";
import { networkName, networkNotice, needsNetworkAddition, type NetworkPrompt } from "../wallet/network.js";
import { kuruLogo, termbookLogo } from "./modal-brand.js";
import { element, icon, dropdown, rows, hero, pair, context, section, explorer, compactAddress, money, amountText, parseAmount, healthText, type TokenInfo } from "./modal-ui.js";

export type OpenOptions = { action?: AppAction; tab?: "account" | "app"; creditId?: `0x${string}` };

const metadataAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
let modalCount = 0;
let previousOverflow = "";

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
  private readonly panel: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly status: HTMLDivElement;
  private readonly previousFocus: Element | null;
  private readonly keyHandler: (event: KeyboardEvent) => void;
  private readonly resizeObserver?: ResizeObserver;
  private readonly operationAbort = new AbortController();
  private readonly stopNetwork: () => void;
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
  private action?: TermAction;
  private readonly preparedAction: boolean;
  private review?: ActionReview;
  private recentAction?: { capability: string; status: ExecuteResult["status"]; tx?: `0x${string}`; checkpoint?: ExecutionCheckpoint };
  private amountText = "";
  private limitText = "";
  private durationDays = "";
  private busy = false;
  private closed = false;
  private fieldSeq = 0;
  private accountView: "overview" | "collateral" | "offer" | "setup" | "repayment" | "closure" = "overview";
  private detailsOpen = false;
  private closureMode: "unwind" | "retain" = "unwind";
  private details?: Record<string, unknown>;
  private setupStage = "reserved";
  private readonly tokens = new Map<string, TokenInfo>();
  private settlement?: TokenInfo;

  constructor(client: TermbookClient, options: OpenOptions = {}) {
    if (typeof document === "undefined" || !document.body) throw new Error("modal-dom-unavailable");
    this.client = client;
    this.stopNetwork = client.network.listen((prompt) => this.requestNetwork(prompt), this.operationAbort.signal);
    this.action = options.action ? { ...options.action, params: { ...options.action.params } } : undefined;
    this.preparedAction = !!options.action;
    this.requestedTab = options.tab;
    this.tab = options.tab ?? (options.action ? "app" : "account");
    this.previousFocus = document.activeElement;
    this.host = element("div");
    this.root = this.host.attachShadow({ mode: "open" });
    const style = element("style");
    style.textContent = modalStyle;
    const backdrop = element("div", undefined, "backdrop");
    const panel = element("section", undefined, "panel");
    this.panel = panel;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Termbook");
    const header = element("header");
    const closeButton = element("button", undefined, "close");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close modal"); closeButton.append(icon("close"));
    closeButton.addEventListener("click", () => this.close());
    const brand = element("span", undefined, "brand"); brand.innerHTML = termbookLogo;
    header.append(brand, closeButton);
    this.tabs = element("nav", undefined, "tabs"); this.tabs.setAttribute("role", "tablist"); this.tabs.setAttribute("aria-label", "Termbook");
    this.status = element("div", "Loading…", "status");
    this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.body = element("div", undefined, "body"); this.body.id = "termbook-content"; this.body.setAttribute("role", "tabpanel");
    this.footer = element("footer", undefined, "footer");
    panel.append(header, this.tabs, this.status, this.body, this.footer);
    this.root.append(style, backdrop, panel);
    document.body.append(this.host);
    if (typeof ResizeObserver !== "undefined") { this.resizeObserver = new ResizeObserver(() => this.detailHeight()); this.resizeObserver.observe(this.body); }
    if (modalCount++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    this.body.addEventListener("scroll", () => { for (const menu of Array.from(this.body.querySelectorAll<HTMLElement>(".menu:popover-open"))) menu.hidePopover(); });
    backdrop.addEventListener("click", () => this.close());
    this.keyHandler = (event) => {
      if (this.closed) return;
      if (event.key === "Escape") {
        const menu = this.root.querySelector<HTMLElement>(".menu:popover-open");
        if (menu) { event.preventDefault(); menu.hidePopover(); menu.parentElement?.querySelector("button")?.focus(); return; }
        event.preventDefault(); this.close(); return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(this.root.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]")).filter((node) => node.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && this.root.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && this.root.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", this.keyHandler);
    (header.querySelector("button") as HTMLButtonElement).focus();
    this.ready = this.load(options.creditId).catch((error: unknown) => { this.showError(error); if (!this.closed) this.footer.replaceChildren(this.button("Retry", () => this.load(options.creditId), true)); });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.operationAbort.abort();
    this.stopNetwork();
    this.resizeObserver?.disconnect();
    document.removeEventListener("keydown", this.keyHandler);
    this.host.remove();
    if (--modalCount === 0) document.body.style.overflow = previousOverflow;
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
    const focused = this.root.activeElement;
    const selectLabel = focused?.closest(".select")?.querySelector("button")?.getAttribute("aria-label");
    this.busy = true;
    this.showStatus("Please wait…");
    this.setBusy();
    try {
      await this.client.ensureNetwork(); this.operationAbort.signal.throwIfAborted();
      await action(); this.operationAbort.signal.throwIfAborted(); await this.client.ensureNetwork();
    } catch (error) { this.showError(error); }
    finally {
      this.busy = false; if (this.status.textContent === "Please wait…") this.showStatus(""); this.render();
      if (!this.closed) {
        const next = selectLabel ? Array.from(this.root.querySelectorAll<HTMLButtonElement>('button[role="combobox"]')).find((button) => button.getAttribute("aria-label") === selectLabel)
          : focused?.id ? this.root.getElementById(focused.id) : this.footer.querySelector<HTMLElement>(".primary");
        next?.focus({ preventScroll: true });
      }
    }
  }

  private requestNetwork(prompt: NetworkPrompt): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this.operationAbort.signal;
      const abort = () => reject(signal.reason);
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      const label = prompt.action === "add" ? "Add network" : "Switch network";
      const walletRow = this.body.querySelector<HTMLElement>(".wallet-row");
      if (walletRow) walletRow.hidden = true;
      this.showStatus(prompt.action === "add" ? `Add ${prompt.name} to your wallet.` : `Switch to ${prompt.name} to continue.`);
      const button = this.control(label, () => {
        if (button.disabled || this.closed) return;
        button.disabled = true; button.textContent = "Confirm in wallet…";
        this.showStatus(`Approve ${prompt.action === "add" ? "adding" : "the switch to"} ${prompt.name} in your wallet.`);
        void prompt.approve().then(() => {
          signal.removeEventListener("abort", abort);
          if (!this.closed) this.showStatus("");
          resolve();
        }).catch((error: unknown) => {
          if (signal.aborted) return;
          if (prompt.action === "switch" && needsNetworkAddition(error)) {
            signal.removeEventListener("abort", abort); reject(error); return;
          }
          button.disabled = false; button.textContent = label;
          this.showStatus(networkNotice(error, prompt));
          button.focus({ preventScroll: true });
        });
      }, "primary");
      this.footer.replaceChildren(button);
      button.focus({ preventScroll: true });
    });
  }

  private setBusy(): void {
    this.panel.setAttribute("aria-busy", String(this.busy));
    if (this.busy) for (const control of Array.from(this.root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("button:not(.close):not(.disclosure-toggle),input,select,textarea"))) control.disabled = true;
  }

  private showError(error: unknown): void {
    if (this.closed) return;
    if (error instanceof Error && error.message === "wallet-network-busy") {
      this.showStatus("Complete the pending network request in your wallet, then try again."); return;
    }
    this.status.className = "status error";
    this.status.setAttribute("role", "alert");
    const message = error instanceof Error ? error.message : "Operation failed. Please retry.";
    if (message === "action-review-stale") this.review = undefined;
    this.status.textContent = ({ "close-funding-required": "Repay the remaining debt, then continue closure.", "close-pending": "Closure is still pending. Continue closure to check its progress.", "action-review-stale": "The amounts changed. Review the action again.", "action-health-insufficient": "Insufficient health. Reduce the amount.", "source-wallet-required": "Connect your collateral wallet to continue.", "source-wallet-unavailable": "Connect your collateral wallet to continue.", "wallet-account-mismatch": "Your wallet account changed. Reconnect to continue.", "source-wallet-changed": "Your collateral wallet account changed. Reconnect to continue.", "wallet-network-unsupported": "Add the collateral network in your wallet, then try again.", "setup-checkpoint-unavailable": "Setup cannot be resumed on this device.", "offer-expired": "This offer expired. Request new offers." } as Record<string, string>)[message]
      ?? (error instanceof Error && "shortMessage" in error && typeof error.shortMessage === "string" ? error.shortMessage : message);
  }

  private showStatus(message: string): void {
    if (this.closed) return;
    this.status.className = "status";
    this.status.setAttribute("role", "status");
    this.status.textContent = message;
  }

  private control(label: string, action: () => void, className = "text-button"): HTMLButtonElement {
    const button = element("button", label, className); button.type = "button"; button.addEventListener("click", action); return button;
  }

  private asset(address?: string): TokenInfo {
    return this.tokens.get(address?.toLowerCase() ?? "") ?? { address: (address ?? zeroAddress) as `0x${string}`, decimals: 0, symbol: "units" };
  }

  private async token(value: string, decimals?: number): Promise<TokenInfo> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error("Token address unavailable.");
    const address = value as `0x${string}`;
    const cached = this.tokens.get(address.toLowerCase()); if (cached) return cached;
    if (address === zeroAddress) { const native = { address, symbol: this.client.config.chainId === 143 || this.client.config.chainId === 10143 ? "MON" : "Native", decimals: 18 }; this.tokens.set(address, native); return native; }
    const [symbol, precision] = await Promise.all([
      this.client.rpc.read<string>(address, metadataAbi, "symbol").catch(() => compactAddress(address)),
      decimals === undefined ? this.client.rpc.read<number>(address, metadataAbi, "decimals") : Promise.resolve(decimals),
    ]);
    if (!Number.isInteger(Number(precision)) || Number(precision) < 0 || Number(precision) > 36) throw new Error("Token decimals unavailable.");
    const info = { address, symbol, decimals: Number(precision) }; this.tokens.set(address.toLowerCase(), info); return info;
  }

  private detail(key: string, index: number): unknown { return Array.isArray(this.details) ? this.details[index] : this.details?.[key]; }

  private collateralMarket(): CollateralMarket | undefined {
    const asset = this.detail("collateralAsset", 7); const vault = this.detail("collateralVault", 6);
    return this.markets.find((market) => typeof asset === "string" && typeof vault === "string" && (market.kind === "evm"
      ? market.asset.toLowerCase() === asset.toLowerCase() && market.vault.toLowerCase() === vault.toLowerCase()
      : solanaAlias(market.genesis as `0x${string}`, market.asset as `0x${string}`).toLowerCase() === asset.toLowerCase()
        && solanaAlias(market.genesis as `0x${string}`, market.program as `0x${string}`).toLowerCase() === vault.toLowerCase()));
  }

  private collateralLabel(): string {
    const amount = this.detail("collateralAmount", 9); const market = this.collateralMarket();
    if (amount === undefined) return "Unavailable";
    return market ? `${amountText(BigInt(String(amount)), market.decimals)} ${market.label}` : `${String(amount)} units`;
  }

  private async refreshCredit(): Promise<void> {
    if (!this.credit) return;
    const [summary, details, health, support] = await Promise.all([
      this.credit.summary(), this.credit.details(), this.credit.account.health().catch(() => undefined), this.credit.closureSupport().catch(() => undefined),
    ]);
    if (this.closed) return;
    this.summary = summary; this.details = details; this.health = health; this.closureSupport = support;
    this.closureMode = support?.retaining ? "retain" : "unwind";
    const configured = this.client.config.settlementAsset;
    const vault = summary.vault;
    const asset = configured ?? (vault ? await this.client.rpc.read<`0x${string}`>(vault, parseAbi(["function asset() view returns (address)"]), "asset") : undefined);
    if (asset) this.settlement = await this.token(asset);
  }

  private navigate(view: typeof this.accountView): void {
    this.accountView = view; this.detailsOpen = false; this.body.scrollTop = 0; this.showStatus(""); this.render();
  }

  private disclosure(title: string, ...children: Node[]): HTMLElement {
    const wrapper = element("div", undefined, "disclosure");
    const trigger = this.control(title, () => {
      this.detailsOpen = !this.detailsOpen; trigger.setAttribute("aria-expanded", String(this.detailsOpen));
      trigger.replaceChildren(document.createTextNode(title), icon(this.detailsOpen ? "up" : "down")); panel.hidden = !this.detailsOpen;
      this.detailHeight();
      if (this.detailsOpen) this.body.scrollTop += trigger.getBoundingClientRect().top - this.body.getBoundingClientRect().top;
      else this.body.scrollTop = 0;
    }, "disclosure-toggle");
    trigger.setAttribute("aria-expanded", String(this.detailsOpen)); trigger.setAttribute("aria-controls", "termbook-details"); trigger.append(icon(this.detailsOpen ? "up" : "down"));
    const panel = element("div", undefined, "details-panel"); panel.id = "termbook-details"; panel.hidden = !this.detailsOpen; panel.append(...children);
    wrapper.append(trigger, panel); return wrapper;
  }

  private detailHeight(): void {
    this.body.style.setProperty("--detail-height", `${Math.max(0, this.body.clientHeight - (this.body.querySelector<HTMLElement>(".disclosure-toggle")?.offsetHeight ?? 0))}px`);
  }

  private houseIdentity(): HTMLElement | undefined {
    const house = this.detail("house", 3); if (typeof house !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(house)) return undefined;
    const group = element("span", "House ", "house"); group.append(explorer(house as `0x${string}`, this.client.config.chainId, "House contract")); return group;
  }

  private appBrand(): HTMLElement | undefined {
    const name = this.client.config.integration_definition?.name;
    if (!name) return undefined;
    if (!/^kuru(?:\s|$)/i.test(name)) return element("span", name, "hero-label");
    const group = element("span", undefined, "kuru"); group.setAttribute("role", "img"); group.setAttribute("aria-label", "Kuru"); group.title = "Kuru";
    const mark = element("span", undefined, "kuru-mark"); mark.innerHTML = kuruLogo; group.append(mark); return group;
  }

  private invalidateReview(): void {
    this.review = undefined;
    this.body.querySelector(".funding-review")?.remove();
    this.body.querySelector(".swap")?.remove();
    this.body.querySelector(".review-derived")?.remove();
    this.footer.replaceChildren(this.button("Review action", () => this.reviewAction(), true));
  }

  private async reviewAction(): Promise<void> {
    if (!this.credit) return;
    this.review = await this.credit.app.review(this.validatedAction());
    await Promise.all([this.token(this.review.settlementAsset), this.token(zeroAddress), ...(this.review.spending ?? []).map((spend) => this.token(spend.token))]);
    this.detailsOpen = false; this.body.scrollTop = 0; this.showStatus("");
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
    const completed = outcomes.filter((state) => state.status === "settled").length;
    this.showStatus(outcomes.length ? `Waiting for settlement. ${completed} of ${outcomes.length} complete.` : "Waiting for application settlement…");
    this.render();
  }

  private async load(preferred?: `0x${string}`): Promise<void> {
    await this.client.ready();
    if (!this.durationDays) this.durationDays = this.client.config.chainId === 10143 ? "1" : "30";
    if (this.closed) return;
    if (this.action) { assertActionUseCase(this.action, this.client.config.use_case); assertStandardAction(this.action, this.client.config.use_case); }
    const http = new HttpClient(this.client.config.apiBase!);
    const [markets, serverRows] = await Promise.all([
      this.client.catalog.collateralMarkets(),
      http.get<{ creditId: string }[]>(`/credits?borrower=${this.client.signer.address()}`).catch(() => []),
    ]);
    this.markets = markets;
    this.market = markets[0];
    const configuredMarkets = this.client.config.integration_definition?.markets ?? [];
    await Promise.all(configuredMarkets.flatMap((market) => [this.token(market.base_asset, market.base_decimals), this.token(market.quote_asset, market.quote_decimals)]));
    if (this.client.config.settlementAsset) this.settlement = await this.token(this.client.config.settlementAsset);
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
      await this.refreshCredit();
      this.loadRecentAction(this.credit.id);
    }
    if (!this.requestedTab && !this.action && this.summary?.facility === "ready") this.tab = "app";
    this.showStatus("");
    if (this.action && this.tab === "app" && this.summary?.facility === "ready" && this.recentAction?.status !== "pending") {
      try { await this.reviewAction(); } catch (error) { this.showError(error); }
    }
    this.render();
  }

  private render(): void {
    if (this.closed) return;
    const scroll = this.body.scrollTop;
    this.fieldSeq = 0;
    this.body.replaceChildren(); this.footer.replaceChildren(); this.tabs.replaceChildren();
    for (const name of ["account", "app"] as const) {
      const button = this.control(name === "account" ? "Account" : "App", () => { this.tab = name; this.detailsOpen = false; this.body.scrollTop = 0; this.showStatus(""); this.render(); }, "tab");
      button.id = `termbook-tab-${name}`; button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(this.tab === name)); button.setAttribute("aria-controls", this.body.id); this.tabs.append(button);
    }
    this.body.setAttribute("aria-labelledby", `termbook-tab-${this.tab}`);
    if (this.credits.length > 1 && this.accountView === "overview") {
      const picker = dropdown("Credit account", this.credit?.id ?? "", this.credits.map((credit) => ({ value: credit.id, label: `Credit ${compactAddress(credit.id)}` })), (id) => void this.run(async () => {
        this.credit = this.credits.find((credit) => credit.id === id); this.review = undefined; this.repaymentReview = undefined; this.detailsOpen = false;
        await this.refreshCredit(); if (this.credit) this.loadRecentAction(this.credit.id);
      }));
      picker.classList.add("credit-picker"); this.body.append(picker);
    }
    if (this.tab === "account") this.renderAccount(); else this.renderApp();
    this.detailHeight(); this.body.scrollTop = scroll; this.setBusy();
  }

  private renderAccount(): void {
    if (this.accountView === "setup" || this.credit && this.summary && ["reserved", "collateral_locking", "collateral_proving", "account_creating"].includes(this.summary.facility)) { this.renderSetup(); return; }
    if (this.accountView === "offer" && this.offers.length) { this.renderOffers(); return; }
    if (this.accountView === "repayment" && this.credit && this.repaymentReview) { this.renderRepayment(); return; }
    if (this.accountView === "closure" && this.credit && this.summary) { this.renderClosure(); return; }
    if (!this.credit || !this.summary || this.accountView === "collateral") { this.renderCollateral(); return; }
    const summary = this.summary;
    const token = this.settlement ?? this.asset();
    const used = this.detail("revolving", 26) === false ? BigInt(String(this.detail("drawn", 12) ?? summary.limit)) : summary.debt;
    const available = summary.limit > used ? summary.limit - used : 0n;
    this.body.append(context("Your credit", this.houseIdentity()), hero("Debt", summary.debt, token), pair(["Limit", summary.limit], ["Available", available], token));
    const accountData = element("div", undefined, "account-data");
    const apr = this.detail("aprBps", 30); const maturity = Number(this.detail("maturity", 13));
    accountData.append(rows([["APR", apr === undefined ? "—" : `${Number(apr) / 100}%`], ["Due", Number.isFinite(maturity) && maturity > 0 ? new Date(maturity * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"]]));
    const network = element("div", undefined, "network-row");
    network.append(element("span", this.client.config.chainId === 10143 ? "Monad testnet" : this.client.config.chainId === 143 ? "Monad" : `Chain ${this.client.config.chainId}`), healthText(summary.debt === 0n ? null : this.health?.value, this.health?.state));
    accountData.append(network); this.body.append(accountData);
    const details: [string, string | Node][] = [["Status", summary.facility.replaceAll("_", " ")], ["Collateral", this.collateralLabel()]];
    if (summary.account) details.unshift(["Credit account", explorer(summary.account, this.client.config.chainId, "Credit Account contract")]);
    const house = this.detail("house", 3); if (typeof house === "string") details.push(["House", explorer(house as `0x${string}`, this.client.config.chainId, "House contract")]);
    const refresh = this.button("Refresh account", () => this.refreshCredit()); refresh.className = "text-button";
    this.body.append(this.disclosure("Details", rows(details), refresh));
    if (["ready", "closing"].includes(summary.facility)) {
      if (summary.debt > 0n) this.footer.append(this.button("Repay", async () => { this.repaymentReview = await this.credit!.reviewRepayment({ amount: "max", from: "wallet" }); this.navigate("repayment"); }, true));
      else if (summary.facility === "ready") this.footer.append(this.button("Use in app", async () => { this.tab = "app"; if (this.action) await this.reviewAction(); this.render(); }, true));
      else this.footer.append(this.button("Continue closure", () => { this.navigate("closure"); }, true));
      const secondary = element("div", undefined, "secondary");
      if (summary.facility === "ready" || summary.debt > 0n) secondary.append(this.control(summary.facility === "closing" ? "Continue closure" : "Close credit", () => this.navigate("closure")));
      if (summary.facility === "ready") secondary.append(this.control("New credit", () => this.newCredit()));
      this.footer.append(secondary);
    } else {
      this.body.append(element("p", `Credit ${summary.facility.replaceAll("_", " ")}.`, "notice"));
      this.footer.append(["closed", "aborted", "liquidated"].includes(summary.facility) ? this.button("New credit", () => this.newCredit(), true) : this.button("Refresh account", () => this.refreshCredit(), true));
    }
  }

  private newCredit(): void {
    this.credit = undefined; this.summary = undefined; this.details = undefined; this.health = undefined; this.recentAction = undefined; this.repaymentReview = undefined; this.review = undefined; this.offer = undefined; this.offers = []; this.tab = "account"; this.navigate("collateral");
  }

  private renderCollateral(): void {
    this.body.append(context("Set up credit"));
    if (!this.market || !this.markets.length) { this.body.append(element("p", "No collateral market is available.", "notice")); this.footer.append(this.button("Retry", () => this.load(), true)); return; }
    const market = this.market;
    const walletRow = element("div", undefined, "wallet-row");
    walletRow.append(element("span", market.kind === "solana" ? "Solana" : networkName(market.chainId)));
    const sourceAccount = this.sourceWallet?.account;
    const sourceAddress = sourceAccount ? sourceAccount.namespace === "solana" ? solanaPubkeyBase58(sourceAccount.accountBytes) : sourceAccount.accountBytes : undefined;
    const connect = this.button(sourceAddress ? compactAddress(sourceAddress) : "Connect wallet", async () => { this.sourceWallet = await this.client.sourceWallet(this.market!, { signal: this.operationAbort.signal }); }); connect.className = "wallet-button"; walletRow.append(connect); this.body.append(walletRow);
    this.body.append(this.selectField("Asset", dropdown("Collateral asset", market.id, this.markets.map((item) => ({ value: item.id, label: item.label })), (id) => {
      this.market = this.markets.find((item) => item.id === id); this.sourceWallet = undefined; this.intent = undefined; this.offers = []; this.offer = undefined; this.amountText = ""; this.render();
    })));
    this.body.append(this.input("Collateral", this.amountText, (value) => { this.amountText = value; }, market.label));
    const fields = element("div", undefined, "two-fields");
    fields.append(this.input(this.action ? "Limit cap (optional)" : "Limit", this.limitText, (value) => { this.limitText = value; }, this.settlement?.symbol ?? "units"), this.input("Term", this.durationDays, (value) => { this.durationDays = value; }, "days"));
    this.body.append(fields);
    const find = this.button("Find offers", () => this.findOffers(), true); find.disabled = !this.sourceWallet; this.footer.append(find);
  }

  private selectField(label: string, select: HTMLElement): HTMLElement {
    const field = element("div", undefined, "field"); const name = element("label", label, "field-label"); const trigger = select.querySelector("button");
    if (trigger) { trigger.id = `termbook-field-${++this.fieldSeq}`; name.htmlFor = trigger.id; } field.append(name, select); return field;
  }

  private renderRepayment(): void {
    const review = this.repaymentReview!; const token = this.settlement ?? this.asset();
    this.body.append(context("Repay", this.control("Back", () => { this.repaymentReview = undefined; this.navigate("overview"); })), hero("Debt", review.debt, token));
    this.body.append(rows([["Wallet", explorer(this.client.signer.address(), this.client.config.chainId, "payment wallet")], ["Network", this.client.config.chainId === 10143 ? "Monad testnet" : this.client.config.chainId === 143 ? "Monad" : `Chain ${this.client.config.chainId}`], ["Payment cap", money(review.cap, token)]]));
    this.body.append(element("p", "Pays only the debt due.", "risk"), this.disclosure("Details", section("Payment", element("p", `The cap allows for interest accrued until ${new Date(review.deadline * 1000).toLocaleTimeString()}. Only the debt due is transferred.`, "detail-copy")), section("After repayment", element("p", "Your credit stays open. Collateral remains locked until you close the facility.", "detail-copy"))));
    this.footer.append(this.button("Confirm repayment", async () => {
      const result = await this.credit!.repay({ amount: "max", from: "wallet", maxPayment: review.cap, deadline: review.deadline });
      this.repaymentReview = undefined; await this.refreshCredit(); this.accountView = "overview"; this.detailsOpen = false; this.body.scrollTop = 0;
      this.showStatus(`Repaid ${money(result.applied, token)}. Remaining debt ${money(result.remaining, token)}.${result.approvalCleanupRequired ? " Clear the unused token approval in your wallet." : ""}`);
    }, true));
  }

  private renderClosure(): void {
    const summary = this.summary!; const retaining = this.closureSupport?.retaining === true || this.closureMode === "retain";
    this.body.append(context("Close credit", this.control("Back", () => this.navigate("overview"))), hero("Debt to settle", summary.debt, this.settlement ?? this.asset()));
    if (this.closureSupport?.retention && summary.facility === "ready") {
      const choice = element("div", undefined, "choice"); choice.setAttribute("role", "group"); choice.setAttribute("aria-label", "Position closure");
      for (const [mode, label] of [["unwind", "Sell positions"], ["retain", "Keep positions"]] as const) {
        const button = this.control(label, () => { this.closureMode = mode; this.render(); }, ""); button.setAttribute("aria-pressed", String(this.closureMode === mode)); choice.append(button);
      }
      this.body.append(choice);
    }
    const recipient = this.detail("returnRecipient", 8);
    const sourceMarket = this.collateralMarket();
    this.body.append(rows([["Collateral returned", this.collateralLabel()], ["To wallet", sourceMarket?.kind === "evm" && typeof recipient === "string" && /^0x[a-fA-F0-9]{40}$/.test(recipient) ? explorer(recipient as `0x${string}`, sourceMarket.chainId, "collateral recipient") : "Source wallet"]]), element("p", "Full repayment is required before release.", "risk"));
    const steps = element("ol", undefined, "steps");
    const text = retaining ? [["Keep positions", "Trading stops. Supported positions stay in the account."], ["Repay debt", "The full debt must be settled before release."], ["Release", "Account ownership and collateral are released after repayment."]] : [["Sell positions", "Positions are sold to settle the debt."], ["Settle the balance", "Pay any shortfall. Any surplus is returned to your wallet."], ["Release collateral", "Collateral is released after full repayment."]];
    text.forEach(([title, copy], index) => { const row = element("li"); const body = element("div"); body.append(element("h3", title), element("p", copy)); row.append(element("span", String(index + 1), "step-mark"), body); steps.append(row); });
    this.body.append(this.disclosure("Details", steps));
    this.footer.append(this.button(retaining && summary.debt > 0n ? "Repay and close" : summary.facility === "closing" ? "Continue closure" : "Close credit", () => this.closeFacility(summary.facility === "closing" ? undefined : this.closureMode), true));
    if (summary.facility === "closing" && summary.debt > 0n) {
      const secondary = element("div", undefined, "secondary"); secondary.append(this.button("Repay remaining debt", async () => { this.repaymentReview = await this.credit!.reviewRepayment({ amount: "max", from: "wallet" }); this.navigate("repayment"); })); secondary.firstElementChild!.className = "text-button"; this.footer.append(secondary);
    }
  }

  private renderSetup(): void {
    this.body.append(context("Set up credit"));
    const stage = this.credit?.setup?.snapshot().stage ?? this.setupStage;
    const names = [["reserved", "Reserve credit"], ["source_approved", "Lock collateral"], ["source_locked", "Verify collateral"], ["account_creating", "Create account"], ["ready", "Credit ready"]];
    const current = stage === "ready" ? 4 : stage.includes("account") || stage.includes("activat") || stage === "collateral_proved" ? 3 : stage.includes("prov") || stage.includes("confirm") || stage.includes("bound") || stage === "source_locked" ? 2 : stage.includes("lock") || stage.includes("approv") ? 1 : 0;
    const steps = element("ol", undefined, "steps"); names.forEach(([, title], index) => {
      const row = element("li"); row.append(element("span", index < current ? "✓" : String(index + 1), `step-mark ${index < current ? "done" : index === current ? "current" : ""}`), element("div", title)); steps.append(row);
    }); this.body.append(steps);
    if (this.credit) this.footer.append(this.button(this.busy ? "Confirming…" : "Continue setup", () => this.resumeSetup(), true));
    else { const button = this.button("Confirming…", () => {}, true); button.disabled = true; this.footer.append(button); }
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
      await this.refreshCredit();
      if (this.summary?.facility === "closed") { this.accountView = "overview"; this.detailsOpen = false; this.body.scrollTop = 0; }
      this.render();
    }
  }

  private input(label: string, value: string, update: (value: string) => void, unit?: string): HTMLDivElement {
    const wrapper = element("div", undefined, "field");
    const input = element("input");
    const id = `termbook-field-${++this.fieldSeq}`;
    input.id = id;
    input.value = value;
    input.inputMode = "decimal"; input.autocomplete = "off";
    input.addEventListener("input", () => update(input.value));
    const fieldLabel = element("label", label, "field-label");
    fieldLabel.htmlFor = id;
    const box = element("span", undefined, "input"); box.append(input); if (unit) box.append(element("span", unit));
    wrapper.append(fieldLabel, box);
    return wrapper;
  }

  private async findOffers(): Promise<void> {
    if (!this.market || !this.sourceWallet) throw new Error("source-wallet-required");
    if (!this.client.config.actions?.find((item) => item.capability === this.action?.capability) && this.action) {
      throw new Error("capability-denied");
    }
    const amount = parseAmount(this.amountText, this.market.decimals);
    const days = Number(this.durationDays);
    if (amount <= 0n || !Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error("credit-terms-invalid");
    const limit = this.limitText ? parseAmount(this.limitText, this.settlement?.decimals ?? 0) : undefined;
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
    this.intent = this.client.intent({ collateral, credit: { duration: days * 86400, limit }, action: this.action ? this.validatedAction() : undefined });
    this.offers = await this.intent.waitForOffers({ signal: this.operationAbort.signal });
    this.offer = this.offers[0];
    this.accountView = this.offer ? "offer" : "collateral"; this.detailsOpen = false; this.body.scrollTop = 0;
    this.showStatus(this.offers.length ? "" : "No compatible House offer is available.");
    this.render();
  }

  private renderOffers(): void {
    const offer = this.offer ?? this.offers[0]; if (!offer) { this.navigate("collateral"); return; }
    this.offer = offer;
    const token = this.settlement ?? this.asset(offer.settlementAsset);
    const house = element("div", "House ", "house");
    if (this.offers.length > 1) house.append(dropdown("House offer", offer.id, this.offers.map((value) => ({ value: value.id, label: `${compactAddress(value.house)} · ${value.aprBps / 100}%` })), (id) => { this.offer = this.offers.find((value) => value.id === id); this.detailsOpen = false; this.render(); }, true));
    house.append(explorer(offer.house, this.client.config.chainId, "House contract", false, this.offers.length > 1));
    this.body.append(context("Offer", house), hero("Credit limit", offer.limit, token));
    const strip = element("div", undefined, "terms"); strip.append(element("span", `${offer.aprBps / 100}% APR`), element("span", `${this.durationDays} days`)); this.body.append(strip);
    const collateral = this.market ? `${amountText(offer.collateralAmount ?? parseAmount(this.amountText, this.market.decimals), this.market.decimals)} ${this.market.label}` : "Unavailable";
    const collateralValue = element("span", collateral);
    const edit = this.control("Edit", () => this.navigate("collateral")); edit.setAttribute("aria-label", "Edit collateral");
    const collateralRow = rows([["Collateral", collateralValue]]); collateralRow.querySelector("dd")!.append(edit);
    this.body.append(collateralRow, rows([["Fees", money(offer.originationFee + (offer.reservationTerms?.readyFee ?? 0n), token)], ["Bond", money(offer.reservationBond, token)]]));
    const costs: [string, string | Node][] = [["Origination fee", money(offer.originationFee, token)], ["Charged", "Once, on first borrowing"]];
    if (offer.reservationTerms) costs.push(["Setup fee", money(offer.reservationTerms.readyFee, token)], ["Reservation rate", `${offer.reservationTerms.annualRateBps / 100}% APR`], ["Abandonment fee", money(offer.reservationTerms.abandonFee + offer.reservationTerms.repeatCharge, token)], ["Expiry fee", money(offer.reservationTerms.expiryFee + offer.reservationTerms.repeatCharge, token)]);
    if (offer.estimatedTotalCost !== undefined) costs.push(["Estimated cost", money(offer.estimatedTotalCost, token)]);
    const costSection = section("Costs", rows(costs));
    if (offer.costAssumptions) costSection.append(element("p", `Estimate assumes ${money(offer.costAssumptions.draw, token)} drawn for ${offer.costAssumptions.durationSeconds / 86400} days.`, "detail-copy"));
    if (offer.reservationTerms) costSection.append(element("p", "Reservation charges run until credit is ready or the setup deadline. Unused bond returns to the authorized payer; an attested protocol setup failure refunds the full bond.", "detail-copy"));
    const risks: [string, string | Node][] = [];
    if (offer.riskTerms) for (const [label, value] of [["Required health", offer.riskTerms.initialBps], ["Maintenance", offer.riskTerms.maintenanceBps], ["Watch", offer.riskTerms.watchBps], ["Freeze", offer.riskTerms.freezeBps], ["Recovery below", offer.riskTerms.liquidationBps]] as const) risks.push([label, `${(Number(value) / 10000).toFixed(2)}×`]);
    risks.push(["Due", new Date(offer.maturity * 1000).toLocaleDateString()], ["Offer expires", new Date(offer.expiry * 1000).toLocaleString()]);
    const riskSection = section("Terms", rows(risks), element("p", offer.retentionSupported ? "Repay and sell positions, or repay fully and keep supported positions." : "Sell positions and repay fully before closure.", "detail-copy"));
    this.body.append(this.disclosure("Terms & risk", costSection, riskSection));
    const risk = element("p", undefined, "risk"); const warning = element("span", "!", "warning-mark"); warning.setAttribute("aria-hidden", "true"); risk.append(warning, element("span", "Recovery can sell your positions and collateral.")); this.body.append(risk);
    this.footer.append(this.button("Accept offer", () => this.acceptOffer(), true));
  }

  private async acceptOffer(): Promise<void> {
    if (!this.intent || !this.offer || !this.sourceWallet) throw new Error("offer-required");
    this.accountView = "setup"; this.setupStage = "reserved"; this.detailsOpen = false; this.body.scrollTop = 0;
    this.showStatus("Confirm the request in your wallet."); this.render();
    try {
      this.credit = await this.intent.accept({ offer_id: this.offer.id, reviewedOffer: this.offer, source_wallet: this.sourceWallet,
        on_progress: (checkpoint, binding) => {
          this.setupStage = checkpoint.stage;
          this.saveId(binding.creditId);
          this.showStatus(checkpoint.stage.replaceAll("_", " ")); this.render();
          try { localStorage.setItem(`${this.storageKey()}:setup:${binding.creditId}`, stringify({ binding, checkpoint })); } catch { /* storage is optional */ }
        } });
    } catch (error) {
      if (error instanceof Error && ["offer-review-stale", "offer-not-found"].includes(error.message)) {
        this.offers = await this.intent.offers();
        this.offer = undefined;
        this.accountView = "offer";
        this.showStatus("House terms changed. Review the current offers.");
        this.render();
        return;
      }
      if (!(error instanceof CollateralSetupInterruptedError)) { this.accountView = "offer"; throw error; }
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
    await this.refreshCredit();
    this.offers = []; this.offer = undefined;
    this.accountView = "overview";
    if (this.summary?.facility === "ready" && this.action) { this.tab = "app"; await this.reviewAction(); }
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
        this.sourceWallet = await this.client.sourceWallet(market, { signal: this.operationAbort.signal });
      }
      this.credit.setup = await this.client.collateral_setup(saved, { sourceWallet: this.sourceWallet,
        onProgress: (checkpoint, binding) => {
          this.setupStage = checkpoint.stage; this.showStatus(checkpoint.stage.replaceAll("_", " ")); this.render();
          try { localStorage.setItem(`${this.storageKey()}:setup:${binding.creditId}`, stringify({ binding, checkpoint })); } catch { /* storage is optional */ }
        } });
    }
    const checkpoint = await this.credit.setup.resume();
    this.showStatus(`Collateral setup: ${checkpoint.stage.replaceAll("_", " ")}.`);
    await this.refreshCredit();
    if (checkpoint.stage === "ready") { this.accountView = "overview"; this.showStatus(""); if (this.action) { this.tab = "app"; await this.reviewAction(); } }
    this.render();
  }

  private spotMarket() {
    return this.client.config.use_case === "spot" ? this.client.config.integration_definition?.markets.find((market) => market.market_id === String(this.action?.params.market_id)) : undefined;
  }

  private actionTitle(): string {
    const market = this.spotMarket();
    if (market && this.action?.capability === "place_order") return `${this.action.params.direction === "sell" ? "Sell" : "Buy"} ${this.asset(market.base_asset).symbol}`;
    return this.client.config.actions?.find((item) => item.capability === this.action?.capability)?.label ?? "Application action";
  }

  private renderSpotFields(container: HTMLElement): void {
    const action = this.action!; const market = this.spotMarket()!;
    const amount = action.params.amount as Record<string, unknown>;
    const mode = amount && "receive" in amount ? "receive" : "spend";
    const buy = action.params.direction !== "sell";
    const token = this.asset(mode === "spend" ? buy ? market.quote_asset : market.base_asset : buy ? market.base_asset : market.quote_asset);
    const raw = amount?.[mode]; const text = /^\d+$/.test(String(raw)) ? formatUnits(BigInt(String(raw)), token.decimals) : String(raw ?? "");
    const fields = element("div", undefined, "two-fields");
    fields.append(this.input(mode === "spend" ? "Spend amount" : "Receive amount", text, (value) => {
      let next: string; try { next = parseAmount(value, token.decimals).toString(); } catch { next = value; }
      this.action = { ...this.action!, params: setValue(this.action!.params, `amount.${mode}`, next) }; this.invalidateReview();
    }, token.symbol));
    if (action.params.order_type === "market") {
      const slippage = String(action.params.slippage_bps ?? 50);
      const values = [...new Set(["50", "100", slippage])];
      fields.append(this.selectField("Slippage", dropdown("Slippage", slippage, values.map((value) => ({ value, label: `${Number(value) / 100}%` })), (value) => {
        this.action = { ...this.action!, params: setValue(this.action!.params, "slippage_bps", value) }; this.invalidateReview();
      })));
    } else fields.append(this.input("Limit price", /^\d+$/.test(String(action.params.limit_price)) ? formatUnits(BigInt(String(action.params.limit_price)), 18) : String(action.params.limit_price ?? ""), (value) => {
      let next: string; try { next = parseAmount(value, 18).toString(); } catch { next = value; }
      this.action = { ...this.action!, params: setValue(this.action!.params, "limit_price", next) }; this.invalidateReview();
    }, `${this.asset(market.quote_asset).symbol}/${this.asset(market.base_asset).symbol}`));
    container.append(fields);
  }

  private renderApp(): void {
    if (this.recentAction && (this.recentAction.status === "pending" || !this.review)) {
      const recent = this.recentAction;
      this.body.append(context(recent.status === "settled" ? "Action complete" : recent.status === "pending" ? "Action pending" : `Action ${recent.status}`), rows([["Action", this.client.config.actions?.find((item) => item.capability === recent.capability)?.label ?? recent.capability.replaceAll("_", " ")], ["Status", recent.status]]));
      if (recent.tx) this.body.append(rows([["Transaction", explorer(recent.tx, this.client.config.chainId, "transaction", true)]]));
      if (recent.status === "pending" && this.credit) {
        this.body.append(element("p", "Waiting for the application to settle.", "notice"));
        this.footer.append(this.button("Resume action", async () => { const result = await this.credit!.app.resumeExecution({ checkpoint: recent.checkpoint, signal: this.operationAbort.signal, onProgress: (checkpoint, outcomes) => this.executionProgress(checkpoint, outcomes) }); this.saveRecentAction(result); await this.refreshCredit(); this.showStatus(`Action ${result.status}.`); }, true));
      } else {
        this.footer.append(this.button("View account", () => { this.tab = "account"; this.navigate("overview"); }, true));
        const secondary = element("div", undefined, "secondary"); secondary.append(this.button("New action", async () => { this.recentAction = undefined; if (this.action && this.summary?.facility === "ready") await this.reviewAction(); })); secondary.firstElementChild!.className = "text-button"; this.footer.append(secondary);
      }
      return;
    }
    if (!this.credit || !this.summary || this.summary.facility !== "ready") {
      this.body.append(context(this.action ? this.actionTitle() : "Application credit", this.appBrand()), element("p", "Set up credit to continue.", "notice"));
      this.footer.append(this.button("Set up credit", () => { this.tab = "account"; this.navigate(this.credit ? "overview" : "collateral"); }, true)); return;
    }
    const definitions = this.client.config.actions ?? [];
    if (!definitions.length) { this.body.append(context("App"), element("p", "No application action is available.", "notice")); return; }
    if (!this.preparedAction) {
      const choices = definitions.filter((item, index) => definitions.findIndex((entry) => entry.capability === item.capability) === index).map((item) => ({ value: item.capability, label: item.label }));
      this.body.append(this.selectField("Action", dropdown("Application action", this.action?.capability ?? "", [{ value: "", label: "Select an action" }, ...choices], (value) => { this.action = value ? { use_case: this.client.config.use_case, capability: value, params: {} } : undefined; this.review = undefined; this.detailsOpen = false; this.render(); })));
    }
    if (!this.action) return;
    const definition = definitions.find((item) => matchesAction(item, this.action!)) ?? definitions.find((item) => item.capability === this.action!.capability);
    if (!definition) { this.body.append(element("p", "This action is no longer available.", "notice error")); return; }
    this.body.append(context(this.actionTitle(), this.appBrand()));
    const market = this.spotMarket(); const simpleSpot = !!market && this.action.capability === "place_order" && this.preparedAction;
    const review = this.review;
    if (review && market && this.action.capability === "place_order") {
      const amount = this.action.params.amount as Record<string, unknown>; const buy = this.action.params.direction === "buy";
      const input = this.asset(buy ? market.quote_asset : market.base_asset); const output = this.asset(buy ? market.base_asset : market.quote_asset);
      const spend = amount?.spend !== undefined ? BigInt(String(amount.spend)) : review.boundKind === "max_input" && review.price ? review.price.bound : undefined;
      const receive = amount?.receive !== undefined ? BigInt(String(amount.receive)) : review.boundKind === "min_output" && review.price ? review.price.bound * 10000n / BigInt(10000 - review.price.slippageBps) : undefined;
      const swap = element("div", undefined, "swap");
      for (const [value, token, approximate] of [[spend, input, false], [receive, output, amount?.receive === undefined]] as const) {
        const display = value === undefined ? "—" : amountText(value, token.decimals);
        const side = element("div"); side.append(element("span", approximate && value !== undefined && !/^[≈<>]/.test(display) ? `≈ ${display}` : display, "swap-number"), element("span", token.symbol, "swap-symbol"));
        if (token === output && review.price && review.boundKind === "min_output") side.append(element("span", `Min. ${money(review.price.bound, output)}`, "swap-min"));
        else if (token === input && review.price && review.boundKind === "max_input") side.append(element("span", `Max. ${money(review.price.bound, input)}`, "swap-min"));
        swap.append(side);
      }
      const arrow = element("span", undefined, "swap-arrow"); arrow.append(icon("arrow")); swap.append(arrow); this.body.append(swap);
    }
    const fields = element("div");
    if (simpleSpot) this.renderSpotFields(fields); else this.renderActionFields(fields, definition);
    if (!review && !simpleSpot) this.body.append(fields);
    if (review) {
      const token = this.asset(review.settlementAsset); const funding = pair(["New borrowing", review.draw, `Borrow fee ${money(review.draw > 0n ? review.originationFee : 0n, token)}`], ["Debt after", review.projectedDebt, healthText(review.projectedDebt === 0n ? null : review.projectedHealthBps, review.canExecute ? "healthy" : "frozen")], token); funding.classList.add("funding-review"); this.body.append(funding);
      if (!review.canExecute) this.body.append(element("p", "Insufficient health. Reduce the amount.", "notice error"));
    }
    const tradeDetails = section("Trade"); if (simpleSpot || review) tradeDetails.append(fields);
    if (review) {
      const token = this.asset(review.settlementAsset); const derived = rows([["From account", money(review.requiredInput < review.freeAssets ? review.requiredInput : review.freeAssets, token)], ["Current debt", money(review.currentDebt, token)], ["Required input", money(review.requiredInput, token)]]); derived.classList.add("review-derived"); tradeDetails.append(derived);
      const creditDetails: [string, string | Node][] = [["Credit limit", money(this.summary.limit, token)], ["Min. health", `${(Number(review.initialHealthBps) / 10000).toFixed(2)}×`], ["Recoverable value", money(review.projectedRecoveryValue, token)]];
      if (this.summary.account) creditDetails.push(["Credit account", explorer(this.summary.account, this.client.config.chainId, "Credit Account contract")]);
      creditDetails.push(["Settlement asset", explorer(review.settlementAsset, this.client.config.chainId, "settlement asset")]);
      if (review.nativeValue) creditDetails.push(["Native value", money(review.nativeValue, this.asset(zeroAddress))]);
      for (const spend of review.spending ?? []) creditDetails.push(["Token spending", money(spend.amount, this.asset(spend.token))]);
      if (review.price && review.boundKind !== "min_output" && review.boundKind !== "max_input") creditDetails.push(["Execution price", amountText(review.price.bound, 18)]);
      this.body.append(this.disclosure("Details", tradeDetails, section("Credit", rows(creditDetails))));
    } else if (simpleSpot) this.body.append(this.disclosure("Details", tradeDetails));
    if (!review) { this.footer.append(this.button("Review action", () => this.reviewAction(), true)); return; }
    const confirm = this.button(market && this.action.capability === "place_order" ? this.action.params.direction === "sell" ? "Confirm sell" : "Confirm buy" : "Confirm action", async () => {
      if (!this.review) throw new Error("action-review-required");
      const result = await this.credit!.app.execute(this.validatedAction(), this.review, undefined, { signal: this.operationAbort.signal, onProgress: (checkpoint, outcomes) => this.executionProgress(checkpoint, outcomes) });
      this.saveRecentAction(result); this.review = undefined; this.detailsOpen = false; this.body.scrollTop = 0; await this.refreshCredit(); this.showStatus(`Action ${result.status}.`);
    }, true); confirm.disabled = !review.canExecute; this.footer.append(confirm);
  }

  private renderActionFields(container: HTMLElement, definition: CapabilityDefinition): void {
    if (this.client.config.use_case) { this.renderStandardFields(container); return; }
    const fields = capabilityCalls(definition).flatMap((call) => {
      const item = parseAbiItem(call.signature);
      return item.type !== "function" ? [] : call.arguments.map((argument, index) => ({ argument, type: item.inputs[index]?.type }));
    });
    const addField = (path: string | undefined, label: string, max?: string) => {
      if (path) fields.push({ argument: { source: "input", path, label, ...(max ? { min: "0", max } : {}) } as CapabilityCall["arguments"][number], type: "uint256" });
    };
    for (const call of capabilityCalls(definition)) { addField(call.valuePath, "Native value (wei)"); addField(call.spendPath, "Token units"); }
    addField(definition.price?.slippagePath, "Slippage (basis points)", "5000"); addField(definition.exposurePath, "Exposure (units)");
    const shown = new Set<string>();
    for (const { argument, type } of fields) {
      if (argument.source !== "input" || !argument.path || shown.has(argument.path)) continue;
      shown.add(argument.path); const path = argument.path; const current = valueAt(this.action!.params, path); const label = argument.label ?? path.replaceAll("_", " ");
      const change = (next: unknown) => { this.action = { ...this.action!, params: setValue(this.action!.params, path, next) }; this.invalidateReview(); };
      if (argument.choices) container.append(this.selectField(label, dropdown(label, String(current ?? ""), [{ value: "", label: "Select" }, ...Object.keys(argument.choices).map((value) => ({ value, label: value }))], change)));
      else if (type === "bool") container.append(this.selectField(label, dropdown(label, current === undefined ? "" : String(current), [{ value: "", label: "Select" }, { value: "true", label: "Yes" }, { value: "false", label: "No" }], (value) => change(value === "true" ? true : value === "false" ? false : value))));
      else if (type === "tuple" || type?.endsWith("]")) {
        const field = element("div", undefined, "field"); const name = element("label", label, "field-label"); const input = element("textarea"); input.id = `termbook-field-${++this.fieldSeq}`; name.htmlFor = input.id; input.value = current === undefined ? "" : stringify(current);
        input.addEventListener("input", () => { let value: unknown; try { value = JSON.parse(input.value); } catch { value = input.value; } change(value); }); field.append(name, input); container.append(field);
      } else container.append(this.input(label, current === undefined ? "" : String(current), change));
    }
  }

  private renderStandardFields(container: HTMLElement): void {
    const category = this.client.config.use_case!; const capability = this.action!.capability;
    const routes = this.client.config.actions!.filter((route) => route.capability === capability);
    const paths = routes.flatMap((route) => capabilityCalls(route).flatMap((call) => call.arguments.filter((argument) => argument.source === "input").map((argument) => argument.path!)));
    const change = (path: string, next: unknown, rerender = false) => {
      this.action = { ...this.action!, params: setValue(this.action!.params, path, next) }; this.invalidateReview(); if (rerender) this.render();
    };
    const publishedMarkets = this.client.config.integration_definition?.markets ?? [];
    const exposed = standardActionFields(category, capability, this.action!.params).map((field) => field.path);
    for (const key of ["market_id", "direction", "order_type"] as const) {
      if (!exposed.includes(key)) continue;
      const values = key === "market_id" ? publishedMarkets.map((market) => market.market_id) : [...new Set(routes.map((route) => route.when?.[key]).filter((value): value is NonNullable<typeof value> => !!value))];
      if (values.length === 1 && this.action!.params[key] === undefined) this.action = { ...this.action!, params: setValue(this.action!.params, key, values[0]) };
    }
    const fields = standardActionFields(category, capability, this.action!.params).filter((field) => !field.optional || paths.some((path) => path === field.path || path.startsWith(`${field.path}.`)));
    for (const field of fields) {
      let path = field.path;
      if (path === "market_id" && publishedMarkets.length) {
        if (publishedMarkets.length > 1) container.append(this.selectField("Market", dropdown("Market", String(this.action!.params.market_id ?? ""), publishedMarkets.map((market) => ({ value: market.market_id, label: market.market_id })), (value) => change(path, value, true))));
        continue;
      }
      if (field.choices) {
        const key = path as "direction" | "order_type";
        const choices = field.choices.filter((value) => routes.some((route) => !route.when?.[key] || route.when[key] === value));
        if (choices.length > 1) container.append(this.selectField(path === "direction" ? "Side" : "Order", dropdown(path === "direction" ? "Side" : "Order", String(valueAt(this.action!.params, path) ?? ""), [{ value: "", label: "Select" }, ...choices.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))], (value) => {
          if (path === "order_type") { const params = { ...this.action!.params }; delete params.slippage_bps; delete params.limit_price; delete params.expires_at; this.action = { ...this.action!, params }; }
          if (path === "direction" && category === "spot") { const params = { ...this.action!.params }; delete params.amount; this.action = { ...this.action!, params }; }
          change(path, value, true);
        })));
        continue;
      }
      if (category === "spot" && path === "amount") {
        const action = this.action!; const eligible = routes.filter((route) => ["direction", "order_type"].every((key) => !action.params[key] || !route.when?.[key as "direction" | "order_type"] || route.when[key as "direction" | "order_type"] === action.params[key]));
        const modes = [...new Set(eligible.map((route) => route.when?.sizing).filter((mode): mode is "spend" | "receive" => !!mode))];
        const amount = this.action!.params.amount as Record<string, unknown> | undefined;
        const mode = amount && "receive" in amount ? "receive" : amount && "spend" in amount ? "spend" : modes.length === 1 ? modes[0]! : "";
        if (modes.length > 1) container.append(this.selectField("Amount type", dropdown("Amount type", mode, modes.map((value) => ({ value, label: value === "spend" ? "Spend" : "Receive" })), (value) => change("amount", { [value]: "" }, true))));
        if (!mode) continue; path = `amount.${mode}`;
      }
      const label = ({ "amount.spend": "Spend amount", "amount.receive": "Receive amount", "amount.margin": "Margin", "amount.notional": "Notional", slippage_bps: "Slippage", limit_price: "Limit price", expires_at: "Expiry" } as Record<string, string>)[path] ?? path.replaceAll("_", " ").replaceAll(".", " ");
      const current = valueAt(this.action!.params, path);
      if (field.type === "json" && path === field.path) {
        const wrapper = element("div", undefined, "field"); const name = element("label", label, "field-label"); const input = element("textarea"); input.id = `termbook-field-${++this.fieldSeq}`; name.htmlFor = input.id; input.value = current === undefined ? "" : stringify(current);
        input.addEventListener("input", () => { let next: unknown; try { next = JSON.parse(input.value); } catch { next = input.value; } change(path, next); }); wrapper.append(name, input); container.append(wrapper); continue;
      }
      const market = this.spotMarket(); const buy = this.action!.params.direction !== "sell";
      const token = category === "spot" && market && path.startsWith("amount.") ? this.asset(path.endsWith("spend") ? buy ? market.quote_asset : market.base_asset : buy ? market.base_asset : market.quote_asset)
        : category === "perps" && path.startsWith("amount") ? this.settlement : undefined;
      const decimals = path === "slippage_bps" ? 2 : path === "limit_price" ? 18 : token?.decimals;
      const text = current === undefined ? "" : decimals !== undefined && /^\d+$/.test(String(current)) ? formatUnits(BigInt(String(current)), decimals) : String(current);
      const unit = path === "slippage_bps" ? "%" : path === "limit_price" && market ? `${this.asset(market.quote_asset).symbol}/${this.asset(market.base_asset).symbol}` : token?.symbol ?? (field.type === "integer" && path !== "expires_at" && !path.startsWith("tick_") ? "units" : undefined);
      container.append(this.input(label, text, (value) => {
        if (field.optional && !value) { const params = { ...this.action!.params }; delete params[path]; this.action = { ...this.action!, params }; this.invalidateReview(); return; }
        let next: unknown = value;
        if (decimals !== undefined) { try { next = parseAmount(value, decimals).toString(); } catch { next = value; } }
        else if (path === "expires_at" || path.startsWith("tick_")) next = Number(value);
        change(path, next);
      }, unit));
    }
  }

  private validatedAction(): AppAction {
    if (!this.action) throw new Error("action-input-required");
    assertStandardAction(this.action, this.client.config.use_case);
    return this.action as AppAction;
  }
}
