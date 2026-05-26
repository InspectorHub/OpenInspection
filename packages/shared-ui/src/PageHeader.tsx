import React from "react";
import { Eyebrow, type EyebrowColor } from "./Eyebrow";

interface PageHeaderProps {
  eyebrow?: string;
  eyebrowColor?: EyebrowColor;
  title: string | React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, eyebrowColor = "slate", title, meta, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        {eyebrow && <Eyebrow color={eyebrowColor}>{eyebrow}</Eyebrow>}
        <h1 className="text-[26px] font-bold tracking-tight text-ih-fg-1 mt-1">{title}</h1>
        {meta && <p className="text-[13px] text-ih-fg-3 mt-1">{meta}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
