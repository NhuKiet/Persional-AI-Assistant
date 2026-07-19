import type { Pin } from "./SelectionLayer";

interface ContextPinsProps {
  pins: Pin[];
  onRemove: (index: number) => void;
}

export default function ContextPins({ pins, onRemove }: ContextPinsProps) {
  if (!pins.length) return null;
  return (
    <div className="context-pins">
      {pins.map((p, i) => (
        <span className="pin-chip" key={i}>
          {p.type === "image"
            ? <img className="pin-thumb" src={p.data_url} alt={`trang ${p.page}`} />
            : <span className="pin-text">"{p.text.slice(0, 40)}{p.text.length > 40 ? "…" : ""}"</span>}
          <span className="pin-page">tr.{p.page}</span>
          <button
            aria-label={`Bỏ ghim trang ${p.page}`}
            className="pin-x"
            onClick={() => onRemove(i)}
            type="button"
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}
