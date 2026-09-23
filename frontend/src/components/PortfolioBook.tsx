import { useCallback, useEffect, useRef, useState } from "react";

import { PORTFOLIO_PAGES, type Lang } from "../config/portfolio";

/** Portfolio ở trang chủ, trình bày như một quyển sách lật được.
 *
 *  Vì sao là sách chứ không phải danh sách cuộn: nội dung CV dài hơn nhiều so
 *  với khoảng trống còn lại trong hero, mà hero thì bị kẹp giữa nav và dải CTA
 *  (xem .atom-hero trong landing.css). Phân trang cho chiều cao CỐ ĐỊNH — thêm
 *  bao nhiêu kinh nghiệm nữa cũng không đẩy vỡ layout, chỉ là thêm một trang.
 *
 *  Hoạt ảnh lật: trang mới được remount qua `key` nên CSS animation chạy lại
 *  từ đầu mỗi lần đổi trang; `data-dir` cho biết lật tới hay lật lui để bản lề
 *  (transform-origin) đổi bên cho đúng chiều. Máy bật "giảm chuyển động" thì
 *  landing.css tắt hẳn phần xoay 3D, chỉ còn một nhịp mờ dần.
 */

const LANGS: { id: Lang; label: string }[] = [
  { id: "vi", label: "VI" },
  { id: "en", label: "EN" },
];

const UI = {
  vi: { prev: "Trang trước", next: "Trang sau", of: "trên", book: "Portfolio của Kiệt", role: "quyển sách lật", page: "Trang" },
  en: { prev: "Previous page", next: "Next page", of: "of", book: "Kiet's portfolio", role: "flip book", page: "Page" },
} as const;

export interface PortfolioBookProps {
  /** Ngôn ngữ do trang chủ giữ: mấy dòng năng lực NGOÀI quyển sách cũng phải
   *  đổi theo nút VI/EN này, nên state không thể nằm trong component. */
  lang: Lang;
  onLangChange: (lang: Lang) => void;
}

export function PortfolioBook({ lang, onLangChange }: PortfolioBookProps) {
  const [page, setPage] = useState(0);
  /** "next" | "prev" — quyết định bản lề nằm bên nào khi lật. */
  const [dir, setDir] = useState<"next" | "prev">("next");
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Trang hiện tại có dài hơn khung không. Phải đo bằng JS: CSS không có
   *  cách nào hỏi "phần tử này có đang tràn không", mà thanh cuộn ở đây là
   *  loại overlay (chiếm 0px bề rộng) nên tự nó không nói lên điều gì. */
  const [clipped, setClipped] = useState(false);

  const total = PORTFOLIO_PAGES.length;
  const t = UI[lang];

  const go = useCallback((delta: number) => {
    setPage(p => {
      const next = Math.min(total - 1, Math.max(0, p + delta));
      if (next !== p) setDir(delta > 0 ? "next" : "prev");
      return next;
    });
  }, [total]);

  // Trang mới luôn bắt đầu từ đầu nội dung: trang trước cuộn xuống giữa chừng
  // rồi lật sang mà giữ nguyên scrollTop thì trang mới hiện ra ở khúc giữa.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [page]);

  // Đo lại mỗi khi đổi trang, đổi tiếng, hoặc đổi kích thước khung: cùng một
  // trang mà hẹp lại là chữ xuống dòng nhiều hơn và có thể tràn.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollHeight - el.clientHeight > 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page, lang]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft")  { e.preventDefault(); go(-1); }
  };

  const p = PORTFOLIO_PAGES[page];

  return (
    <section
      className="pf-book"
      /* roledescription là VAI TRÒ ("quyển sách lật"), label là TÊN
         ("Portfolio của Kiệt"). Đặt cùng một chuỗi cho cả hai thì trình đọc
         màn hình xướng tên hai lần liên tiếp. */
      aria-roledescription={t.role}
      aria-label={t.book}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <header className="pf-bar">
        <span className="pf-bar-title">{p.tab[lang]}</span>
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

      <div className={`pf-stage${clipped ? " is-clipped" : ""}`}>
        <article className="pf-leaf" key={`${page}-${lang}`} data-dir={dir}>
          <div
            className="pf-leaf-body"
            ref={bodyRef}
            onScroll={e => {
              const el = e.currentTarget;
              setClipped(el.scrollHeight - el.clientHeight - el.scrollTop > 1);
            }}
          >
            <h2 className="pf-title">{p.title[lang]}</h2>
            {p.meta && <p className="pf-meta">{p.meta[lang]}</p>}
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
        </article>
      </div>

      <footer className="pf-nav">
        <button
          type="button" className="pf-nav-btn" onClick={() => go(-1)}
          disabled={page === 0} aria-label={t.prev}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 2.5 4.5 7 9 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Chấm trang: bấm được để nhảy thẳng, và cũng là thanh tiến độ cho
            biết quyển sách còn dày bao nhiêu. */}
        <ol className="pf-dots">
          {PORTFOLIO_PAGES.map((pg, i) => (
            <li key={pg.id}>
              <button
                type="button"
                className={`pf-dot${i === page ? " is-on" : ""}`}
                aria-label={`${t.page} ${i + 1}: ${pg.tab[lang]}`}
                aria-current={i === page ? "true" : undefined}
                onClick={() => { setDir(i > page ? "next" : "prev"); setPage(i); }}
              />
            </li>
          ))}
        </ol>

        <button
          type="button" className="pf-nav-btn" onClick={() => go(1)}
          disabled={page === total - 1} aria-label={t.next}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="m5 2.5 4.5 4.5L5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </footer>

      {/* Người dùng screen reader không thấy hoạt ảnh lật, nên phải nói ra
          trang vừa đổi. polite: không cắt ngang thứ đang đọc dở. */}
      <p className="pf-sr" aria-live="polite">
        {t.page} {page + 1} {t.of} {total} — {p.tab[lang]}
      </p>
    </section>
  );
}
