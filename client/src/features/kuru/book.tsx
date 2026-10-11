import { cumulative } from "./amount";
import { number, type Market } from "./data";

export function Book({ market }: { market?: Market }) {
  const bids = cumulative(market?.bids ?? []), asks = cumulative(market?.asks ?? []);
  const maximum = Math.max(...bids.map((row) => row.total), ...asks.map((row) => row.total), 1);
  const bid = market?.bids[0], ask = market?.asks[0];
  return <section className="kuru-book" aria-labelledby="book-title">
    <h2 id="book-title">Order book</h2>
    <div className="kuru-book-head"><span>Price (USDC)</span><span>Size (MON)</span><span>Total</span></div>
    <div className="kuru-book-levels asks">
      {asks.slice(0, 8).reverse().map((row) => <div className="kuru-book-row" key={row.price}>
        <span className="kuru-depth" style={{ width: `${row.total / maximum * 100}%` }} /><span>{number(row.price)}</span><span>{number(row.size, 4)}</span><span>{number(row.total, 4)}</span>
      </div>)}
      {!asks.length && <p className="kuru-empty">No asks</p>}
    </div>
    <div className="kuru-spread"><strong>{bid && ask ? number((Number(bid.price) + Number(ask.price)) / 2) : "—"}</strong><span>Spread {bid && ask ? `${number((Number(ask.price) - Number(bid.price)) / Number(ask.price) * 100, 2)}%` : "—"}</span></div>
    <div className="kuru-book-levels bids">
      {bids.slice(0, 8).map((row) => <div className="kuru-book-row" key={row.price}>
        <span className="kuru-depth" style={{ width: `${row.total / maximum * 100}%` }} /><span>{number(row.price)}</span><span>{number(row.size, 4)}</span><span>{number(row.total, 4)}</span>
      </div>)}
      {!bids.length && <p className="kuru-empty">No bids</p>}
    </div>
    <p className="kuru-book-note">Finalized order book</p>
  </section>;
}
