import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** Anchor id, for in-page scroll targets (e.g. a remedy button elsewhere
   *  scrolling to this card). */
  id?: string;
  /**
   * Test handle, forwarded to the rendered element.
   *
   * It has to be declared to arrive. TypeScript does NOT check a JSX attribute
   * whose name contains a hyphen against the component's props type -- so a
   * `<Card data-testid="...">` on a Card that did not accept one compiled
   * clean, rendered nothing, and left a selector that could never match. That
   * is worse than having no handle at all: `queryByTestId(...)` asserting the
   * card is ABSENT would have passed with the card on screen.
   */
  "data-testid"?: string;
}

export function Card({ children, className = "", id, "data-testid": testId }: CardProps) {
  return (
    <div
      id={id}
      data-testid={testId}
      className={`bg-ih-bg-card border border-ih-border rounded-ih-card shadow-ih-card ${className}`}
    >
      {children}
    </div>
  );
}
