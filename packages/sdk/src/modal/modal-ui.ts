import { formatUnits, parseUnits } from "viem";
import { monad, monadTestnet, mainnet, sepolia, base, baseSepolia } from "viem/chains";

export type TokenInfo = { address: `0x${string}`; symbol: string; decimals: number };

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}

export function icon(name: "close" | "up" | "down" | "arrow" | "external"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", { close: "M18 6 6 18M6 6l12 12", up: "m6 15 6-6 6 6", down: "m6 9 6 6 6-6", arrow: "M5 12h14m-6-6 6 6-6 6", external: "M7 17 17 7M7 7h10v10" }[name]);
  svg.append(path); return svg;
}

export function compactAddress(value: string): string { return `${value.slice(0, 6)}…${value.slice(-4)}`; }

export function explorer(value: `0x${string}`, chainId: number, label: string, tx = false, iconOnly = false): HTMLElement {
  const chain = [monad, monadTestnet, mainnet, sepolia, base, baseSepolia].find((entry) => entry.id === chainId);
  if (!chain) return element("span", compactAddress(value));
  const link = element("a", undefined, "explorer");
  link.href = `${chain.blockExplorers.default.url}/${tx ? "tx" : "address"}/${value}`;
  link.target = "_blank"; link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `View ${label} ${value} on explorer (opens in a new tab)`);
  link.title = value;
  if (!iconOnly) link.append(element("span", compactAddress(value)));
  link.append(icon("external")); return link;
}

export function amountText(value: bigint, decimals: number): string {
  const full = formatUnits(value, decimals);
  const [whole, fraction = ""] = full.split(".");
  const short = fraction.slice(0, 6).replace(/0+$/, "");
  if ((whole === "0" || whole === "-0") && !short && /[1-9]/.test(fraction)) return value < 0n ? "> -0.000001" : "< 0.000001";
  return `${/[1-9]/.test(fraction.slice(6)) ? "≈ " : ""}${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${short ? `.${short}` : ""}`;
}

export function money(value: bigint, token: TokenInfo): string { return `${amountText(value, token.decimals)} ${token.symbol}`; }

export function parseAmount(value: string, decimals: number): bigint {
  if (value.length > 80 || !new RegExp(`^\\d+(?:\\.\\d{1,${decimals || 1}})?$`).test(value) || decimals === 0 && value.includes(".")) throw new Error("Enter a valid amount within the token's decimal precision.");
  return parseUnits(value, decimals);
}

export function healthText(value: bigint | null | undefined, state?: string): HTMLElement {
  const text = value === null ? "No debt" : value === undefined ? "Health unavailable" : `Health ${(Number(value) / 10_000).toFixed(2)}×`;
  const node = element("span", text, `health${state && ["frozen", "liquidatable"].includes(state) ? " error" : ""}`);
  node.title = "Recoverable value divided by debt plus recovery costs."; return node;
}

export function rows(values: [string, string | Node][]): HTMLDListElement {
  const list = element("dl", undefined, "facts");
  for (const [label, value] of values) {
    const row = element("div", undefined, "fact"); const data = element("dd");
    data.append(typeof value === "string" ? document.createTextNode(value) : value);
    row.append(element("dt", label), data); list.append(row);
  }
  return list;
}

export function hero(label: string, value: bigint, token: TokenInfo): HTMLDivElement {
  const hero = element("div", undefined, "hero"); const number = element("div", amountText(value, token.decimals), "hero-number");
  number.append(element("small", token.symbol)); hero.append(element("span", label, "hero-label"), number); return hero;
}

export function pair(left: [string, bigint, (string | Node)?], right: [string, bigint, (string | Node)?], token: TokenInfo): HTMLDivElement {
  const result = element("div", undefined, "pair");
  for (const [label, amount, note] of [left, right]) {
    const column = element("div"); const value = element("span", amountText(amount, token.decimals), "money-value");
    value.append(document.createTextNode(" "), element("small", token.symbol));
    column.append(element("span", label, "money-label"), value);
    if (note) { const line = element("span", undefined, "money-note"); line.append(note); column.append(line); }
    result.append(column);
  }
  return result;
}

export function context(title: string, trailing?: Node): HTMLDivElement {
  const row = element("div", undefined, "context"); row.append(element("h2", title)); if (trailing) row.append(trailing); return row;
}

export function section(title: string, ...children: Node[]): HTMLElement {
  const result = element("section", undefined, "detail-section"); result.append(element("h3", title), ...children); return result;
}

let dropdownSequence = 0;
export function dropdown(label: string, value: string, choices: { value: string; label: string }[], change: (value: string) => void, compact = false): HTMLElement {
  const wrapper = element("span", undefined, `select${compact ? " compact" : ""}`);
  const select = element("select"); select.hidden = true;
  const trigger = element("button", undefined, "select-trigger"); trigger.type = "button";
  trigger.setAttribute("role", "combobox"); trigger.setAttribute("aria-label", label); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-haspopup", "listbox");
  const text = element("span", choices.find((choice) => choice.value === value)?.label ?? "Select", "select-label");
  trigger.append(text, icon("down"));
  const menu = element("div", undefined, "menu"); menu.setAttribute("popover", "auto"); menu.setAttribute("role", "listbox"); menu.setAttribute("aria-label", label);
  menu.id = `termbook-menu-${++dropdownSequence}`; trigger.setAttribute("aria-controls", menu.id);
  for (const choice of choices) {
    const option = element("option", choice.label); option.value = choice.value; option.selected = choice.value === value; select.append(option);
    const button = element("button", undefined, "menu-option"); button.type = "button"; button.setAttribute("role", "option"); button.setAttribute("aria-selected", String(option.selected));
    button.append(element("span", choice.label), element("span", option.selected ? "✓" : "", "menu-check"));
    button.addEventListener("click", () => {
      const root = wrapper.getRootNode();
      menu.hidePopover(); select.value = choice.value; text.textContent = choice.label; change(choice.value);
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
      else if (root instanceof ShadowRoot) Array.from(root.querySelectorAll<HTMLButtonElement>('button[role="combobox"]')).find((button) => button.getAttribute("aria-label") === label)?.focus({ preventScroll: true });
    });
    menu.append(button);
  }
  const open = (keyboard = false) => {
    if (menu.matches(":popover-open")) { menu.hidePopover(); return; }
    menu.showPopover(); const bounds = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(160, bounds.width), window.innerWidth - 16);
    menu.style.width = `${width}px`;
    const height = menu.getBoundingClientRect().height;
    menu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`;
    menu.style.top = `${bounds.bottom + height + 6 > window.innerHeight - 8 && bounds.top > height + 14 ? bounds.top - height - 6 : bounds.bottom + 6}px`;
    if (keyboard) (menu.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? menu.querySelector("button"))?.focus();
  };
  trigger.addEventListener("click", () => open());
  trigger.addEventListener("keydown", (event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); open(true); } });
  menu.addEventListener("toggle", (event) => trigger.setAttribute("aria-expanded", String((event as ToggleEvent).newState === "open")));
  menu.addEventListener("keydown", (event) => {
    const options = Array.from(menu.querySelectorAll("button")); const index = options.indexOf(menu.getRootNode() instanceof ShadowRoot ? (menu.getRootNode() as ShadowRoot).activeElement as HTMLButtonElement : document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length; options[next]?.focus();
    } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); menu.hidePopover(); trigger.focus(); }
    else if (event.key === "Tab") { menu.hidePopover(); trigger.focus(); }
  });
  wrapper.append(select, trigger, menu); return wrapper;
}
