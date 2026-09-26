import { useCallback, useEffect, useRef, useState } from "react";

import { PORTFOLIO_PAGES, type Lang, type PortfolioPage } from "../config/portfolio";

/** Portfolio ở trang chủ, trình bày dạng carousel: các thẻ xếp thành một hàng
 *  ngang, thẻ đang xem nằm giữa, hai thẻ bên cạnh ló ra một mép để người xem
 *  thấy ngay là còn nội dung ở hai bên, không cần đọc hàng chấm mới biết.
 *
 *  Vì sao phân thẻ chứ không phải danh sách cuộn: nội dung CV dài hơn nhiều so
 *  với khoảng trống còn lại trong hero, mà hero thì bị kẹp giữa nav và dải CTA
 *  (xem .atom-hero trong landing.css). Phân thẻ cho chiều cao CỐ ĐỊNH — thêm
 *  bao nhiêu kinh nghiệm nữa cũng không đẩy vỡ layout, chỉ là thêm một thẻ.
 *
 *  Trượt bằng cuộn ngang gốc của trình duyệt + scroll-snap, không tự tính
 *  translateX: vuốt trên điện thoại, vuốt hai ngón trên trackpad, quán tính và
 *  hít vào thẻ đều do trình duyệt lo, mượt hơn mọi thứ tự viết. JS chỉ làm ba
 *  việc: đọc vị trí cuộn ra thẻ nào đang ở giữa, cuộn tới thẻ khi bấm nút/chấm/
 *  phím mũi tên, và cho chuột kéo được (chuột không có cử chỉ cuộn ngang).
 *
 *  Không tự chạy: đây là CV để đọc, thẻ tự trôi đi giữa lúc đang đọc dở là
 *  cách chắc chắn nhất để người ta bỏ đọc.
 */

const LANGS: { id: Lang; label: string }[] = [
  { id: "vi", label: "VI" },
  { id: "en", label: "EN" },
];

const UI = {
  vi: { prev: "Thẻ trước", next: "Thẻ sau", of: "trên", label: "Portfolio của Kiệt", role: "băng trượt", slide: "thẻ", item: "Thẻ" },
  en: { prev: "Previous slide", next: "Next slide", of: "of", label: "Kiet's portfolio", role: "carousel", slide: "slide", item: "Slide" },
} as const;

/** Kéo chuột dưới ngưỡng này thì vẫn là một cú bấm: tay rung nhẹ lúc bấm
 *  đường link không được tính là kéo. */
const DRAG_START_PX = 6;
/** Kéo chưa quá nửa thẻ thì thẻ gần tâm nhất vẫn là thẻ cũ, nhưng kéo được
 *  chừng này là ý muốn sang thẻ đã rõ — cho sang luôn, như hất trên điện thoại. */
const FLICK_PX = 40;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Máy bật "giảm chuyển động" thì nhảy thẳng tới thẻ, không trượt. */
const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export interface PortfolioCarouselProps {
  /** Ngôn ngữ do trang chủ giữ: mấy dòng năng lực NGOÀI carousel cũng phải
   *  đổi theo nút VI/EN này, nên state không thể nằm trong component. */
  lang: Lang;
  onLangChange: (lang: Lang) => void;
}

export function PortfolioCarousel({ lang, onLangChange }: PortfolioCarouselProps) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const tabsRef = useRef<HTMLOListElement>(null);
  /** Thẻ đích khi JS đang tự trượt tới (bấm nút/chấm/phím). Trong lúc trượt,
   *  các thẻ đi ngang qua không được chiếm `active`: bấm chấm 1 → 8 mà để vậy
   *  thì tiêu đề nháy qua cả sáu thẻ ở giữa, và vùng aria-live đọc lên đủ sáu
   *  cái tên. */
  const targetRef = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; dx: number; left: number; from: number; moved: boolean } | null>(null);
  /** Vừa kéo xong: nuốt cú click trình duyệt bắn ra lúc nhả chuột, nếu không
   *  thì kéo qua một đường link là mở luôn link đó. */
  const suppressClickRef = useRef(false);

  const total = PORTFOLIO_PAGES.length;
  const t = UI[lang];

  /** Thẻ có tâm gần tâm khung nhìn nhất. Tính theo tâm chứ không chia
   *  scrollLeft cho bề rộng thẻ, để không phụ thuộc gap hay khoảng đệm hai đầu. */
  const nearest = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 0;
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    slideRefs.current.forEach((el, i) => {
      if (!el) return;
      const dist = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }, []);

  const goTo = useCallback((i: number) => {
    const to = Math.min(total - 1, Math.max(0, i));
    const track = trackRef.current;
    const el = slideRefs.current[to];
    if (!track || !el) return;
    targetRef.current = to;
    setActive(to);
    track.scrollTo({
      left: el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2,
      behavior: scrollBehavior(),
    });
  }, [total]);

  const onScroll = () => {
    const i = nearest();
    if (targetRef.current !== null) {
      if (i !== targetRef.current) return;
      targetRef.current = null;
    }
    setActive(i);
  };

  // Chốt thẻ đang xem khi cuộn dừng hẳn — kể cả khi người dùng chen tay vào
  // giữa lúc JS đang tự trượt, khiến thẻ đích không bao giờ tới được tâm.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const settle = () => { targetRef.current = null; setActive(nearest()); };
    track.addEventListener("scrollend", settle);
    return () => track.removeEventListener("scrollend", settle);
  }, [nearest]);

  // Thẻ đang xem luôn nằm trong tầm nhìn của dải thẻ (dải tràn ngang ở khổ
  // hẹp). Tự tính scrollLeft chứ không dùng scrollIntoView: scrollIntoView cuộn
  // luôn cả TRANG theo chiều dọc khi dải thẻ đang nằm ngoài màn hình — người
  // đang đọc la bàn ở dưới sẽ bị kéo giật lên mỗi lần thẻ đổi.
  useEffect(() => {
    const strip = tabsRef.current;
    const item = strip?.children[active] as HTMLElement | undefined;
    if (!strip || !item) return;
    strip.scrollTo({
      left: item.offsetLeft - (strip.clientWidth - item.offsetWidth) / 2,
      behavior: scrollBehavior(),
    });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); goTo(active + 1); }
    if (e.key === "ArrowLeft")  { e.preventDefault(); goTo(active - 1); }
  };

  // ── Kéo bằng chuột. Cảm ứng và trackpad đã có cuộn ngang gốc, không đụng. ──

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Người dùng tự cầm lái: bỏ thẻ đích của lần trượt tự động đang dở.
    targetRef.current = null;
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    dragRef.current = { x: e.clientX, dx: 0, left: e.currentTarget.scrollLeft, from: active, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const track = e.currentTarget;
    if (!d.moved) {
      // Nhả chuột ở ngoài cửa sổ trước khi kịp thành cú kéo: không có pointerup
      // nào về đây, nên phải tự nhận ra là nút đã nhả.
      if (!(e.buttons & 1)) { dragRef.current = null; return; }
      if (Math.abs(e.clientX - d.x) < DRAG_START_PX) return;
      d.moved = true;
      track.setPointerCapture(e.pointerId);
      // Tắt snap trong lúc kéo để thẻ bám theo chuột từng pixel, không bị
      // trình duyệt giật về thẻ gần nhất sau mỗi lần dịch.
      track.classList.add("is-dragging");
      window.getSelection()?.removeAllRanges();
    }
    d.dx = e.clientX - d.x;
    track.scrollLeft = d.left - d.dx;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d?.moved) return;
    const track = e.currentTarget;
    suppressClickRef.current = true;
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);

    let to = nearest();
    if (to === d.from && Math.abs(d.dx) > FLICK_PX) to = d.from + (d.dx < 0 ? 1 : -1);
    // Bật lại snap ngay lúc này thì trình duyệt hít tức thì về thẻ gần nhất,
    // cắt ngang đoạn trượt mượt tới thẻ đích — đợi trượt xong mới bật. Hẹn giờ
    // là lưới an toàn khi không có scrollend (đã đứng đúng chỗ, hoặc trình
    // duyệt chưa hỗ trợ sự kiện này).
    const resnap = () => track.classList.remove("is-dragging");
    track.addEventListener("scrollend", resnap, { once: true });
    window.setTimeout(resnap, 700);
    goTo(to);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const p = PORTFOLIO_PAGES[active];

  return (
    <section
      className="pf-carousel"
      /* roledescription là VAI TRÒ ("băng trượt"), label là TÊN ("Portfolio
         của Kiệt"). Đặt cùng một chuỗi cho cả hai thì trình đọc màn hình xướng
         tên hai lần liên tiếp. */
      aria-roledescription={t.role}
      aria-label={t.label}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <header className="pf-bar">
        <span className="pf-bar-title">
          {/* Vùng aria-live bên dưới đã đọc số thứ tự, đây chỉ để mắt nhìn. Tên
              thẻ đang xem đã sáng trong dải thẻ ở đáy, nên đầu khay ghi tên
              cả bộ portfolio thay vì lặp lại tên thẻ. */}
          <span className="pf-bar-count" aria-hidden="true">{pad2(active + 1)} / {pad2(total)}</span>
          {t.label}
        </span>
        <div className="pf-lang" role="group" aria-label={lang === "vi" ? "Ngôn ngữ" : "Language"}>
          {LANGS.map(l => (
            <button
              key={l.id}
              type="button"
              className={`pf-lang-btn${lang === l.id ? " is-on" : ""}`}
              aria-pressed={lang === l.id}
              onClick={() => onLangChange(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </header>

      <div className="pf-viewport">
        <div
          className="pf-track"
          ref={trackRef}
          onScroll={onScroll}
          onWheel={() => { targetRef.current = null; }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={onClickCapture}
        >
          {PORTFOLIO_PAGES.map((pg, i) => {
            const isActive = i === active;
            return (
              <div
                key={pg.id}
                ref={el => { slideRefs.current[i] = el; }}
                className={`pf-slide${isActive ? " is-active" : i < active ? " is-before" : ""}`}
                role="group"
                aria-roledescription={t.slide}
                aria-label={`${i + 1} ${t.of} ${total}`}
                /* Bấm vào mép thẻ đang ló ra thì trượt tới nó; Tab vào một
                   đường link trong thẻ bên cạnh cũng vậy, để thứ đang có focus
                   luôn nằm ở thẻ giữa chứ không bị che nửa. */
                onClick={isActive ? undefined : () => goTo(i)}
                onFocus={isActive ? undefined : () => goTo(i)}
              >
                <SlideCard page={pg} lang={lang} />
              </div>
            );
          })}
        </div>
      </div>

      <footer className="pf-nav">
        <button
          type="button" className="pf-nav-btn" onClick={() => goTo(active - 1)}
          disabled={active === 0} aria-label={t.prev}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 2.5 4.5 7 9 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Dải thẻ: số thứ tự + tên từng thẻ, bấm để nhảy thẳng — vừa là mục
            lục vừa là thanh tiến độ cho biết còn bao nhiêu thẻ phía sau. */}
        <ol className="pf-tabs" ref={tabsRef}>
          {PORTFOLIO_PAGES.map((pg, i) => (
            <li key={pg.id}>
              <button
                type="button"
                className={`pf-tab${i === active ? " is-on" : ""}`}
                aria-label={`${t.item} ${i + 1}: ${pg.tab[lang]}`}
                aria-current={i === active ? "true" : undefined}
                onClick={() => goTo(i)}
              >
                <span className="pf-tab-num">{pad2(i + 1)}</span>
                <span className="pf-tab-label">{pg.tab[lang]}</span>
              </button>
            </li>
          ))}
        </ol>

        <button
          type="button" className="pf-nav-btn" onClick={() => goTo(active + 1)}
          disabled={active === total - 1} aria-label={t.next}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="m5 2.5 4.5 4.5L5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </footer>

      {/* Người dùng screen reader không thấy thẻ trượt, nên phải nói ra thẻ
          vừa đổi. polite: không cắt ngang thứ đang đọc dở. */}
      <p className="pf-sr" aria-live="polite">
        {t.item} {active + 1} {t.of} {total} — {p.tab[lang]}
      </p>
    </section>
  );
}

/** Nội dung một thẻ. Tách riêng vì mỗi thẻ tự đo xem chữ có tràn khung không:
 *  carousel trượt QUA các thẻ chứ không dựng lại, mọi thẻ nằm sẵn trong DOM,
 *  nên mỗi thẻ giữ trạng thái "còn chữ bên dưới" của riêng nó. */
function SlideCard({ page: p, lang }: { page: PortfolioPage; lang: Lang }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Thẻ có dài hơn khung không. Phải đo bằng JS: CSS không có cách nào hỏi
   *  "phần tử này có đang tràn không", mà thanh cuộn ở đây là loại overlay
   *  (chiếm 0px bề rộng) nên tự nó không nói lên điều gì. */
  const [clipped, setClipped] = useState(false);

  const measure = useCallback(() => {
    const el = bodyRef.current;
    if (el) setClipped(el.scrollHeight - el.clientHeight - el.scrollTop > 1);
  }, []);

  // Đo lại khi đổi tiếng hoặc đổi kích thước khung: cùng một thẻ mà hẹp lại
  // là chữ xuống dòng nhiều hơn và có thể tràn.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lang, measure]);

  return (
    <article className={`pf-card${clipped ? " is-clipped" : ""}`}>
      <div className="pf-card-body" ref={bodyRef} onScroll={measure}>
        {/* Lớp bọc để canh giữa theo chiều dọc bằng margin auto (xem
            .pf-card-inner): thẻ ngắn chữ nằm giữa khay như một tấm hero, thẻ
            dài thì margin về 0, bám đỉnh và cuộn được — justify-content:center
            sẽ cắt mất phần đầu của thẻ dài. */}
        <div className="pf-card-inner">
          {/* Dòng vai trò · thời gian đứng TRÊN tiêu đề, như dòng nhãn nhỏ phía
              trên tiêu đề lớn của tấm hero. */}
          {p.meta && <p className="pf-meta">{p.meta[lang]}</p>}
          <h2 className="pf-title">{p.title[lang]}</h2>
          {p.body && <p className="pf-body">{p.body[lang]}</p>}
          {p.bullets && (
            <ul className="pf-list">
              {p.bullets[lang].map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          )}
          {p.links && (
            <p className="pf-links">
              {p.links.map(l => (
                <a
                  key={l.href}
                  href={l.href}
                  target={l.href.startsWith("mailto:") ? undefined : "_blank"}
                  rel="noopener noreferrer"
                >
                  {l.label}
                </a>
              ))}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
