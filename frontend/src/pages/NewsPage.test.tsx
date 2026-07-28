import { render, screen, waitFor } from "@testing-library/react";
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
