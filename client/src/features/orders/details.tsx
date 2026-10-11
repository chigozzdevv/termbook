import Link from "next/link";
import { Fact } from "@/components/table/facts";
import { explorer } from "@/lib/explorers";
import { dateTime, money, short, statusLabel } from "@/lib/format";
import { apr, collateral, term } from "./format";
import type { Order } from "./types";

export function Details({ order }: { order: Order }) {
  return (
    <>
      <dl className="facts">
        <Fact label="Record">{order.kind === "request" ? "Request" : "Credit facility"}</Fact>
        <Fact label="Status">{statusLabel(order.status)}</Fact>
        <Fact label="Limit">{money(order.limit)} USDC</Fact>
        <Fact label="Debt">{order.debt === null ? "—" : `${money(order.debt)} USDC`}</Fact>
        <Fact label="APR">{apr(order)}</Fact>
        <Fact label="Term">{term(order)}</Fact>
        <Fact label="Lend asset">USDC</Fact>
        <Fact label="Maturity">
          {order.maturity === null ? "—" : dateTime(order.maturity * 1000)}
        </Fact>
        <Fact label="Collateral">{collateral(order)}</Fact>
        <Fact label="Collateral chain">{order.collateral.chain.label}</Fact>
        <Fact label="Borrower" wide>
          {order.borrower}
        </Fact>
        <Fact label="House" wide>
          {order.house ?? "Not selected"}
        </Fact>
        <Fact label="Intent ID" wide>
          {order.intentId}
        </Fact>
        {order.creditId && (
          <Fact label="Credit ID" wide>
            {order.creditId}
          </Fact>
        )}
        <Fact label="Created">{dateTime(order.createdAt)}</Fact>
      </dl>
      <h3 className="mb-3 text-[13px] font-medium">Transactions</h3>
      {order.events.length ? (
        <ul className="m-0 grid list-none gap-3 p-0">
          {order.events.map((event) => (
            <li key={`${event.transactionHash}-${event.logIndex}`} className="transaction">
              <span>{event.event}</span>
              <Link
                href={explorer.transaction(event.transactionHash)}
                title={event.transactionHash}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] leading-[1.5] text-[#adb4bd] underline underline-offset-4 wrap-anywhere"
              >
                {event.transactionHash}
              </Link>
              <span className="font-mono text-muted">
                Block {event.blockNumber.toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-xs text-muted">This request has no onchain transactions.</p>
      )}
    </>
  );
}

export const detailTitle = (order: Order) =>
  `${order.kind === "request" ? "Borrowing request" : "Credit"} ${short(order.id)}`;
