// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EditedCommentPair, type EditedCommentPairData } from "./EditedCommentPair";

const pair: EditedCommentPairData = {
  commentId: "c1",
  section: "Roof",
  yours: "Roof shows granule loss consistent with age — normal weathering for this climate.",
  editedAt: Date.UTC(2026, 2, 12),
  published: { kind: "changed", text: "Roof shows granule loss; remaining service life is limited." },
};

function renderPair(overrides: Partial<Parameters<typeof EditedCommentPair>[0]> = {}) {
  return render(
    <ul>
      <EditedCommentPair pair={pair} toSemver="2.0.0" doomed={false} locale="en-US" {...overrides} />
    </ul>,
  );
}

afterEach(cleanup);

describe("EditedCommentPair", () => {
  it("shows the inspector's words and the publisher's beside them", () => {
    renderPair();
    expect(screen.getByText(pair.yours)).toBeInTheDocument();
    expect(screen.getByText(pair.published.text!)).toBeInTheDocument();
  });

  // The signature interaction: the page shows the bill instead of asking
  // "are you sure" afterwards. If this stops striking through, the destructive
  // option becomes a choice made against a count again.
  it("strikes the inspector's text through once the destructive option is chosen", () => {
    const { container } = renderPair({ doomed: true });
    const mine = screen.getByText(pair.yours);
    expect(mine.className).toContain("line-through");
    expect(mine.className).toContain("text-ih-bad-fg");
    expect(container.innerHTML).toContain("bg-ih-bad-bg");
  });

  // The danger colour follows the choice rather than sitting there permanently.
  it("uses no danger colour at all until then", () => {
    const { container } = renderPair({ doomed: false });
    expect(screen.getByText(pair.yours).className).not.toContain("line-through");
    expect(container.innerHTML).not.toContain("ih-bad");
  });

  it("says so plainly when the entry is gone from the new pack", () => {
    renderPair({ pair: { ...pair, published: { kind: "removed", text: null } } });
    expect(screen.getByText(/Not in 2\.0\.0/)).toBeInTheDocument();
  });

  it("labels an entry the publisher left alone rather than implying a change", () => {
    renderPair({ pair: { ...pair, published: { kind: "unchanged", text: "Roof shows granule loss consistent with age." } } });
    expect(screen.getByText(/Unchanged in 2\.0\.0/)).toBeInTheDocument();
  });
});
