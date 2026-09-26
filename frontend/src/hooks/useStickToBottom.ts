import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Within this many pixels of the end still counts as "at the bottom", so a
 *  reader a line or two up keeps following the stream. */
const NEAR_BOTTOM_PX = 80;

/** Keep a scroll box pinned to its end while new content streams in — but
 *  only while the reader is there. Scrolling up to reread lets go; new
 *  content then raises `showJump` instead of yanking the view back down.
 *
 *  `ref` is a callback ref, so the box may mount later (the chat area only
 *  exists once the first message is sent). A change of `turn` (e.g. the id
 *  of the last message) re-pins: sending, editing or regenerating is the
 *  reader's own action and should always bring the view to the end. */
export function useStickToBottom<T extends HTMLElement>(content: unknown, turn?: unknown) {
  const [box, setBox] = useState<T | null>(null);
  const pinned = useRef(true);
  const lastTurn = useRef(turn);
  const [showJump, setShowJump] = useState(false);

  useLayoutEffect(() => {
    if (!box) return;
    const onScroll = () => {
      const near = box.scrollHeight - box.scrollTop - box.clientHeight <= NEAR_BOTTOM_PX;
      pinned.current = near;
      if (near) setShowJump(false);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, [box]);

  useLayoutEffect(() => {
    if (!box) return;
    if (turn !== lastTurn.current) {
      lastTurn.current = turn;
      pinned.current = true;
      setShowJump(false);
    }
    if (pinned.current) box.scrollTop = box.scrollHeight;
    else setShowJump(true);
  }, [box, content, turn]);

  const jumpToBottom = useCallback(() => {
    pinned.current = true;
    setShowJump(false);
    box?.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [box]);

  return { ref: setBox, showJump, jumpToBottom };
}
