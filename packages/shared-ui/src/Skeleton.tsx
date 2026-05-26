import React from "react";

interface SkeletonProps {
  variant?: "text" | "block";
  width?: string;
  className?: string;
}

export function Skeleton({ variant = "text", width, className = "" }: SkeletonProps) {
  const base = "animate-pulse bg-ih-bg-muted rounded";
  const variantClass = variant === "text" ? "h-3.5 rounded-sm" : "h-full min-h-6";
  return <div className={`${base} ${variantClass} ${className}`} style={width ? { width } : undefined} />;
}
