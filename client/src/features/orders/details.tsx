import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { explorer } from "@/lib/explorers";
import { dateTime, money, short } from "@/lib/format";
import { apr, collateral, term } from "./format";
import type { Order } from "./types";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="order-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Address({
  value,
  label,
  href,
  external = false,
}: {
  value: string;
  label: string;
  href?: string;
  external?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-start gap-1">
      {href ? (
        <Link
          href={href}
          title={value}
          aria-label={`View ${label} ${value}`}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          className="min-w-0 pt-1 text-foreground underline decoration-line underline-offset-4 wrap-anywhere hover:text-accent"
        >
          {value}
          {external && (
            <ArrowUpRight size={12} aria-hidden="true" className="ml-1 inline-block align-middle" />
          )}
        </Link>
      ) : (
        <span className="min-w-0 pt-1 wrap-anywhere">{value}</span>
      )}
      <CopyButton value={value} label={label} />
    </span>
  );
}

export function Details({ order }: { order: Order }) {
  const transactions = new Map<string, { block: number; events: string[] }>();
  for (const event of order.events) {
    const transaction = transactions.get(event.transactionHash) ?? {
      block: event.blockNumber,
      events: [],
    };
    transaction.events.push(event.event.replace(/([a-z])([A-Z])/g, "$1 $2"));
    transactions.set(event.transactionHash, transaction);
  }
  return (
    <>
      <dl className="order-metrics">
        <div>
          <dt>{order.kind === "request" ? "Requested limit" : "Credit limit"}</dt>
          <dd>
            {money(order.limit)} <span>USDC</span>
          </dd>
        </div>
        <div>
          <dt>Debt</dt>
          <dd>
            {order.debt === null ? (
              "—"
            ) : (
              <>
                {money(order.debt)} <span>USDC</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>APR</dt>
          <dd>{apr(order)}</dd>
        </div>
        <div>
          <dt>Term</dt>
          <dd>{term(order)}</dd>
        </div>
      </dl>
      <div className="order-sections">
        <section className="order-section" aria-labelledby="overview-title">
          <h2 id="overview-title">Overview</h2>
          <dl className="m-0">
            <Field label="Borrower">
              <Address
                value={order.borrower}
                label="borrower address"
                href={explorer.address(order.borrower)}
                external
              />
            </Field>
            <Field label="House">
              {order.house ? (
                <Address
                  value={order.house}
                  label="House address"
                  href={`/houses/${order.house}`}
                />
              ) : (
                "Not selected"
              )}
            </Field>
            <Field label="Lend asset">
              <Link
                href={explorer.address(order.settlementAsset)}
                title={order.settlementAsset}
                aria-label="View lending asset on explorer"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-accent"
              >
                USDC
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            </Field>
            {order.creditId && (
              <Field label="Intent ID">
                <Address value={order.intentId} label="intent ID" />
              </Field>
            )}
            <Field label="Created">
              <time dateTime={new Date(order.createdAt).toISOString()}>
                {dateTime(order.createdAt)}
              </time>
            </Field>
            {order.kind === "request" && order.expiresAt !== null && (
              <Field label="Request expiry">
                <time dateTime={new Date(order.expiresAt * 1000).toISOString()}>
                  {dateTime(order.expiresAt * 1000)}
                </time>
              </Field>
            )}
            {order.kind === "credit" && (
              <Field label="Maturity">
                {order.maturity === null ? (
                  "—"
                ) : (
                  <time dateTime={new Date(order.maturity * 1000).toISOString()}>
                    {dateTime(order.maturity * 1000)}
                  </time>
                )}
              </Field>
            )}
          </dl>
        </section>
        <section className="order-section" aria-labelledby="collateral-title">
          <h2 id="collateral-title">
            {order.kind === "request" ? "Requested collateral" : "Collateral"}
          </h2>
          <p className="mt-5 mb-6 font-mono text-[28px] tracking-[-1px] tabular-nums">
            {collateral(order)}
          </p>
          <dl className="m-0">
            <Field label="Source chain">{order.collateral.chain.label}</Field>
            <Field label="Asset">{order.collateral.symbol}</Field>
            <Field label="Asset ID">
              <Address value={order.collateral.asset} label="collateral asset ID" />
            </Field>
          </dl>
        </section>
      </div>
      <section className="order-section mt-5" aria-labelledby="transactions-title">
        <div className="flex items-center gap-2">
          <h2 id="transactions-title">Transactions</h2>
          <span className="rounded bg-background px-[6px] py-[2px] font-mono text-[11px] text-muted">
            {transactions.size}
          </span>
        </div>
        {transactions.size ? (
          <div className="mt-5 overflow-x-auto">
            <table className="order-transactions" aria-label="Order transactions">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Transaction</th>
                  <th>Block</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(transactions, ([hash, transaction]) => (
                  <tr key={hash}>
                    <td>{transaction.events.join(" · ")}</td>
                    <td>
                      <span className="inline-flex items-center gap-1">
                        <Link
                          href={explorer.transaction(hash)}
                          title={hash}
                          aria-label={`View transaction ${hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs hover:text-accent"
                        >
                          {short(hash)}
                          <ArrowUpRight size={12} aria-hidden="true" />
                        </Link>
                        <CopyButton value={hash} label="transaction hash" />
                      </span>
                    </td>
                    <td>
                      <Link
                        href={explorer.block(transaction.block)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-foreground"
                      >
                        {transaction.block.toLocaleString("en-US")}
                        <ArrowUpRight size={12} aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-5 mb-1 text-[13px] text-muted">No onchain transactions yet.</p>
        )}
      </section>
    </>
  );
}
