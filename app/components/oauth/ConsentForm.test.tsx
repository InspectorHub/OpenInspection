// @vitest-environment happy-dom
/**
 * The consent screen records a decision. A fast double click on Allow, or on
 * Cancel and then Allow, must post one decision, not two.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ConsentForm } from "./ConsentForm";

afterEach(cleanup);

function countPosts() {
  const state = { posted: 0 };
  const onSubmit = (e: Event) => {
    if (!e.defaultPrevented) state.posted += 1;
    e.preventDefault();
  };
  document.addEventListener("submit", onSubmit);
  return { state, stop: () => document.removeEventListener("submit", onSubmit) };
}

describe("ConsentForm", () => {
  it("posts once when Allow is clicked twice in one frame", () => {
    const { state, stop } = countPosts();
    try {
      render(<ConsentForm clientName="Acme" role="admin" modules={[]} canWrite oauthReqJson="{}" />);
      const allow = screen.getByTestId("oauth-authorize-submit");
      act(() => { allow.click(); allow.click(); });
      expect(state.posted).toBe(1);
    } finally {
      stop();
    }
  });

  it("posts once when Cancel and Allow land in one frame", () => {
    const { state, stop } = countPosts();
    try {
      render(<ConsentForm clientName="Acme" role="admin" modules={[]} canWrite oauthReqJson="{}" />);
      const allow = screen.getByTestId("oauth-authorize-submit");
      const cancel = screen.getByRole("button", { name: "Cancel" });
      act(() => { cancel.click(); allow.click(); });
      expect(state.posted).toBe(1);
    } finally {
      stop();
    }
  });
});
