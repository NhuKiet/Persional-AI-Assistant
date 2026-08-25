import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewsPage } from "./NewsPage";

const SAMPLE_ITEM = {
  url: "https://example.com/a",
  title: "Original Title",
  title_vi: "Tiêu đề dịch",
  summary_vi: "Tóm tắt dịch",
  source: "OpenAI Blog",
  topic: "model_release",
  published_at: new Date().toISOString(),
  fetched_at: new Date().toISOString(),
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <NewsPage />
    </MemoryRouter>,
  );
}

async function openGlassPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Tinh chỉnh vật liệu kính" }));
}

describe("NewsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders items from the initial fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
    renderPage();
    expect(await screen.findByText("Tiêu đề dịch")).toBeInTheDocument();
    expect(screen.getByText("Tóm tắt dịch")).toBeInTheDocument();
  });

  it("keeps the tuning panel closed until the wrench button opens it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
    const user = userEvent.setup();
    const { container } = renderPage();

    expect(screen.queryByRole("slider", { name: "Refraction" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Tinh chỉnh vật liệu kính" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.textContent).toBe("");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("slider", { name: "Refraction" })).toBeInTheDocument();
    // Panel sống trong shell chứ không trong thanh lệnh (thanh bị overflow:hidden).
    const panel = container.querySelector("#news-glass-panel");
    expect(panel?.parentElement).toHaveClass("news-command-shell");
    expect(screen.getByRole("banner")).not.toContainElement(panel as HTMLElement);
  });

  it("closes the tuning panel on Escape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }),
    ));
    const user = userEvent.setup();
    renderPage();

    await openGlassPanel(user);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("slider", { name: "Refraction" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tinh chỉnh vật liệu kính" })).toHaveFocus();
  });

  it("drops the demo scaffolding above the live feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
    const { container } = renderPage();

    expect(screen.queryByRole("heading", { name: /Bốn lớp.*Một mặt kính/i })).toBeNull();
    expect(screen.queryByText("Nhìn xuyên qua khối kính")).toBeNull();
    expect(container.querySelector(".news-scene-word")).toBeNull();
    expect(container.querySelector(".news-glass-comparison")).toBeNull();

    const article = await screen.findByRole("link", { name: "Tiêu đề dịch" });
    const controls = container.querySelector(".news-controls");
    expect(
      (controls?.compareDocumentPosition(article) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("loads every value when the user selects a glass preset", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }),
    ));
    const user = userEvent.setup();
    const { container } = renderPage();
    await openGlassPanel(user);

    expect(screen.getByRole("button", { name: "Nguyên bản" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Tinh chỉnh" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider", { name: "Refraction" })).toHaveValue("74");
    expect(container.querySelector("#news-glass-displacement")).toHaveAttribute("scale", "74");

    await user.click(screen.getByRole("button", { name: "Nguyên bản" }));

    expect(screen.getByRole("spinbutton", { name: "Góc sáng" })).toHaveValue(111);
    expect(screen.getByRole("slider", { name: "Refraction" })).toHaveValue("77");
    expect(screen.getByRole("slider", { name: "Frost" })).toHaveValue("50");
    expect(container.querySelector("#news-glass-displacement")).toHaveAttribute("scale", "77");
  });

  it("updates the shared glass material while a control moves", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }),
    ));
    const user = userEvent.setup();
    const { container } = renderPage();
    const main = screen.getByRole("main");

    await screen.findByText(/Chưa có tin nào/i);
    await openGlassPanel(user);

    act(() => {
      fireEvent.change(screen.getByRole("slider", { name: "Dispersion" }), {
        target: { value: "80" },
      });
      fireEvent.change(screen.getByRole("slider", { name: "Frost" }), {
        target: { value: "60" },
      });
    });

    expect(screen.getByRole("slider", { name: "Dispersion" })).toHaveValue("80");
    expect(main).toHaveStyle({
      "--news-dispersion-left": "-6.60px",
      "--news-dispersion-right": "6.60px",
      "--news-blur": "3.45px",
    });
    expect(container.querySelectorAll(".news-glass-effect").length).toBeGreaterThan(0);
  });

  it("shows the empty state when there are no items", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }),
    ));
    renderPage();
    expect(await screen.findByText(/Chưa có tin nào/i)).toBeInTheDocument();
  });

  it("renders a scrollable main region and falls back to the original title for legacy empty summaries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({
        items: [{ ...SAMPLE_ITEM, title: "Original fallback", title_vi: "", summary_vi: "" }],
        limit: 20, offset: 0, has_more: false,
      }),
    ));
    renderPage();
    expect(await screen.findByRole("main")).toHaveClass("news-page");
    expect(screen.getByRole("link", { name: "Original fallback" })).toBeInTheDocument();
  });

  it("renders the liquid-glass ambient layer behind the digest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
    const { container } = renderPage();

    await screen.findByRole("link");
    expect(container.querySelector(".news-liquid-ambient")).not.toBeNull();
  });

  it("renders a decorative topic visual and a non-interactive external-link cue for every article", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
    const { container } = renderPage();

    await screen.findByRole("link");
    const visual = container.querySelector(".news-card-visual");
    expect(visual).toHaveAttribute("aria-hidden", "true");
    expect(visual?.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.querySelector(".news-card-link-cue")).toHaveAttribute("aria-hidden", "true");
  });

  it("marks the digest as a theme-independent white liquid canvas", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
    renderPage();

    expect(await screen.findByRole("main")).toHaveClass("news-white-liquid-page");
  });

  it("groups the command controls and topic controls into independent liquid-bar shells", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
    const { container } = renderPage();

    await screen.findByRole("button", { name: /Làm mới/i });
    expect(container.querySelector(".news-command-shell > .news-command-bar")).not.toBeNull();
    expect(container.querySelector(".news-tab-shell > .news-tab-row")).not.toBeNull();
    expect(container.querySelectorAll(".news-tab-row .news-tab")).toHaveLength(5);
  });

  it("draws the bar controls with stroked icons instead of text glyphs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
    const { container } = renderPage();

    const back = await screen.findByRole("button", { name: "Về trang chủ" });
    const backIcon = back.querySelector(".news-back-icon");
    expect(backIcon).not.toBeNull();
    expect(back.textContent).toBe("");
    expect(backIcon).toHaveAttribute("aria-hidden", "true");
    expect(backIcon).toHaveAttribute("focusable", "false");
    expect(backIcon?.querySelectorAll("path")).toHaveLength(1);
    const backPath = backIcon?.querySelector("path");
    expect(backPath).toHaveAttribute("fill", "none");
    expect(backPath).toHaveAttribute("stroke", "currentColor");
    // Two-stroke circular arrow: the open arc plus its arrowhead.
    const refreshIcon = container.querySelector(".news-refresh-icon");
    expect(refreshIcon).toHaveAttribute("aria-hidden", "true");
    expect(refreshIcon).toHaveAttribute("focusable", "false");
    const refreshPaths = refreshIcon?.querySelectorAll("path");
    expect(refreshPaths).toHaveLength(2);
    refreshPaths?.forEach(path => {
      expect(path).toHaveAttribute("fill", "none");
      expect(path).toHaveAttribute("stroke", "currentColor");
    });
  });

  it("hides the decorative refraction filters from assistive technology", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
    const { container } = renderPage();

    await screen.findByRole("button", { name: /Làm mới/i });
    const defs = container.querySelector(".news-liquid-defs");
    expect(defs).toHaveAttribute("aria-hidden", "true");
    expect(defs).toHaveAttribute("focusable", "false");
    expect(defs?.querySelector("#news-liquid-refraction")).not.toBeNull();
    expect(defs?.querySelector("#news-liquid-refraction-soft")).not.toBeNull();
  });

  it("keeps the refresh label fixed while loading and announces the busy state", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }))
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const refresh = screen.getByRole("button", { name: /Làm mới/i });
    await waitFor(() => expect(refresh).toBeEnabled());
    await user.click(refresh);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(refresh).toBeDisabled();
    expect(container.querySelector(".news-refresh-label")?.textContent).toBe("Làm mới");
    const status = screen.getByText("Đang làm mới…");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("Đang làm mới…");
    expect(refresh).not.toContainElement(status);
  });

  it("identifies the header as the dedicated command glass bar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
    renderPage();

    expect(await screen.findByRole("banner")).toHaveClass("news-command-bar");
  });

  it("moves the liquid active state between standalone topic capsules", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }),
    ));
    const user = userEvent.setup();
    renderPage();

    const robotics = await screen.findByRole("button", { name: "Robotics" });
    const allTopics = screen.getByRole("button", { name: /Tất cả/i });
    expect(allTopics).toHaveClass("news-tab-active");
    expect(allTopics).toHaveAttribute("aria-pressed", "true");
    expect(robotics).toHaveAttribute("aria-pressed", "false");
    await user.click(robotics);
    expect(robotics).toHaveClass("news-tab-active");
    expect(robotics).toHaveAttribute("aria-pressed", "true");
    expect(allTopics).toHaveAttribute("aria-pressed", "false");
  });

  it("switching topic tabs re-fetches with the right query param", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Robotics/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondCallUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondCallUrl).toContain("topic=robotics");
  });

  it("refresh button shows loading state then refetches", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ new_count: 1 }))
      .mockResolvedValueOnce(jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Làm mới/i }));
    expect(await screen.findByText("Tiêu đề dịch")).toBeInTheDocument();
  });

  it("shows a distinct message on 429 cooldown", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ detail: "cooldown" }, 429));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Làm mới/i }));
    expect(await screen.findByText(/Vừa mới cập nhật/i)).toBeInTheDocument();
  });
});
