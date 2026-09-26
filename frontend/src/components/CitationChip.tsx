import { useState, type SyntheticEvent } from "react";

/** Half the card's width plus a margin: closer than this to a viewport edge,
 *  a card centred on the chip would stick out past it. */
const HALF_CARD_PX = 160;

type Align = "center" | "left" | "right";

interface CitationChipProps {
  /** Text on the chip: "2" for a research source, "tr.12" for a PDF page. */
  label: string;
  /** Accessible name of the chip. */
  name: string;
  /** Hover card: small line on top, bold title, optional passage. */
  meta: string;
  title: string;
  snippet?: string;
  /** Research: open the source site in a new tab. */
  href?: string;
  /** PDF: jump to the page inside the app. */
  onOpen?: () => void;
}

/** An inline citation in an answer: a small chip that opens its source,
 *  with a card on hover/focus saying what the source is — enough to judge
 *  the claim without leaving the answer. */
export function CitationChip({ label, name, meta, title, snippet, href, onOpen }: CitationChipProps) {
  const [align, setAlign] = useState<Align>("center");

  // Measured when the card is about to show, so a chip near either edge of
  // the window opens its card inward instead of off-screen.
  const place = (event: SyntheticEvent<HTMLElement>) => {
    const { left, right } = event.currentTarget.getBoundingClientRect();
    const middle = (left + right) / 2;
    setAlign(
      middle + HALF_CARD_PX > window.innerWidth ? "right" : middle - HALF_CARD_PX < 0 ? "left" : "center",
    );
  };

  let chip;
  if (onOpen) {
    chip = <button type="button" className="cite-num" onClick={onOpen} aria-label={name}>{label}</button>;
  } else if (href) {
    chip = <a className="cite-num" href={href} target="_blank" rel="noopener noreferrer" aria-label={name}>{label}</a>;
  } else {
    chip = <span className="cite-num" title={name}>{label}</span>;
  }

  return (
    <span className="cite" onPointerEnter={place} onFocus={place}>
      {chip}
      {/* Repeats the chip's own name, so screen readers skip it. */}
      <span className={`cite-card cite-card--${align}`} aria-hidden="true">
        {meta && <span className="cite-card-meta">{meta}</span>}
        <span className="cite-card-title">{title}</span>
        {snippet && <span className="cite-card-snippet">{snippet}</span>}
      </span>
    </span>
  );
}
