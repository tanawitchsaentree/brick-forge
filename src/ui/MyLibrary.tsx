import { useMemo, useState } from "react";
import { PARTS } from "../engine/parts";
import { colorOf } from "../engine/colors";
import { parseInventory, parseKey, sampleBucket, totalPieces, type Inventory } from "../engine/inventory";
import { usableStock } from "../engine/generate";
import { PartThumb } from "./PartThumb";
import { Button, Textarea } from "pane-react";

interface Props {
  inventory: Inventory;
  used: Inventory; // pieces the current model uses
  selected: string; // invKey of the part being built with
  onChange: (next: Inventory) => void;
  onPick: (partId: string, color: number) => void;
  onIdeas: () => void;
}

const EXAMPLE = `Paste a Rebrickable CSV, or one part per line:
3001 red 10
3003,4,12
10x 3024 white`;

/** The user's own pieces: add, import, adjust counts, and ask what they can build. */
export function MyLibrary({ inventory, used, selected, onChange, onPick, onIdeas }: Props) {
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      Object.entries(inventory)
        .filter(([k, q]) => q > 0 && PARTS[parseKey(k).partId])
        .map(([k, qty]) => ({ key: k, qty, ...parseKey(k) }))
        .sort((a, b) => {
          const pa = PARTS[a.partId], pb = PARTS[b.partId];
          return pa.category.localeCompare(pb.category) || pa.name.localeCompare(pb.name) || a.color - b.color;
        }),
    [inventory],
  );
  const total = totalPieces(inventory);
  const { unusable } = useMemo(() => usableStock(inventory), [inventory]);

  const setQty = (key: string, qty: number) => {
    const next = { ...inventory };
    if (qty <= 0) delete next[key];
    else next[key] = qty;
    onChange(next);
  };

  const merge = (add: Inventory) => {
    const next = { ...inventory };
    for (const [k, q] of Object.entries(add)) next[k] = (next[k] ?? 0) + q;
    onChange(next);
  };

  const runImport = () => {
    const { inv, added, unknown } = parseInventory(text);
    merge(inv);
    setNote(
      `Added ${added} piece${added === 1 ? "" : "s"}.` +
        (unknown.length ? ` Unknown part numbers: ${unknown.slice(0, 6).join(", ")}${unknown.length > 6 ? "…" : ""}` : ""),
    );
    if (added) {
      setText("");
      setImporting(false);
    }
  };

  return (
    <div className="mylib">
      <div className="mylib-summary">
        <div>
          <b>{total.toLocaleString()}</b> pieces · {rows.length} kinds
          {unusable > 0 && <div className="hint">{unusable} can't be used by Ideas yet (slopes, Technic…)</div>}
        </div>
        <Button variant="accent" onClick={onIdeas}>
          ✦ What can I build?
        </Button>
      </div>

      <div className="mylib-actions">
        <Button variant="glass" size="sm" onClick={() => setImporting((v) => !v)}>
          {importing ? "Cancel" : "Import list"}
        </Button>
        <Button variant="glass" size="sm" onClick={() => merge(sampleBucket())} title="Add a made-up bucket of classic bricks to try things out">
          Sample bucket
        </Button>
        <Button variant="glass" size="sm" onClick={() => onChange({})} disabled={total === 0}>
          Clear
        </Button>
      </div>

      {importing && (
        <div className="import">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} rows={5} aria-label="Parts list to import" />
          <Button variant="accent" size="sm" onClick={runImport} disabled={!text.trim()}>
            Add to My pieces
          </Button>
        </div>
      )}
      {note && <p className="hint note">{note}</p>}

      {rows.length === 0 ? (
        <div className="empty">
          <p>Your library is empty.</p>
          <p className="hint">
            Hover any part in the Catalog and press <b>+</b>, import a list, or start from a sample bucket.
          </p>
        </div>
      ) : (
        <ul className="inv">
          {rows.map((r) => {
            const part = PARTS[r.partId];
            const c = colorOf(r.color);
            const inUse = used[r.key] ?? 0;
            return (
              <li key={r.key} className={r.key === selected ? "on" : ""}>
                <button className="inv-pick" onClick={() => onPick(r.partId, r.color)} title={`Build with ${part.name}`}>
                  <PartThumb part={part} hex={c.hex} size={36} />
                  <span className="inv-name">
                    {part.name}
                    <span className="hint">
                      <i className="dot" style={{ background: c.hex }} /> {c.name}
                      {inUse > 0 && <> · {inUse} in model{inUse > r.qty && <b className="bad"> (+{inUse - r.qty})</b>}</>}
                    </span>
                  </span>
                </button>
                <span className="stepper">
                  <button onClick={() => setQty(r.key, r.qty - 1)} aria-label="One fewer">−</button>
                  <input
                    value={r.qty}
                    inputMode="numeric"
                    onChange={(e) => setQty(r.key, Number(e.target.value.replace(/\D/g, "")) || 0)}
                  />
                  <button onClick={() => setQty(r.key, r.qty + 1)} aria-label="One more">+</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

