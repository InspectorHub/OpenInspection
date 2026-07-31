import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** Anchor id, for in-page scroll targets (e.g. a remedy button elsewhere
   *  scrolling to this card). */
  id?: string;
}

export function Card({ children, className = "", id }: CardProps) {
  return (
    <div id={id} className={`bg-ih-bg-card border border-ih-border rounded-ih-card shadow-ih-card ${className}`}>
      {children}
    </div>
  );
}
