import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`bg-ih-bg-card border border-ih-border rounded-ih-card shadow-ih-card ${className}`}>
      {children}
    </div>
  );
}
