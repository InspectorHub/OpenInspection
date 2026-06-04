/** Email-template Phase 2 — shared types for the registry + renderer. */

/** One editable text block in a template (heading / paragraph / button label). */
export interface Block {
  key: string;            // stable key (override storage + editor)
  label: string;          // editor display label
  default: string;        // default value; may contain {{var}} tokens
  multiline: boolean;     // editor renders a textarea vs an input
}

export interface Variable {
  name: string;           // {{name}} token
  desc: string;           // editor help text
}

/** System (non-editable, data-driven) block kinds the layout can render. */
export type SystemBlockKind = 'auditMetadata' | 'attachmentManifest' | 'icsHint';

export interface EmailTemplateDescriptor {
  trigger: string;
  name: string;
  category: 'client' | 'agent' | 'concierge' | 'system';
  editable: boolean;
  required: boolean;
  brand: 'tenant' | 'platform';
  defaultSubject: string;
  blocks: Block[];
  variables: Variable[];
  cta?: { labelBlockKey: string; urlVar: string };
  systemBlocks?: SystemBlockKind[];
}

/** Tenant or platform brand the layout paints with. */
export interface TemplateBrand {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
}

export interface RenderResult {
  subject: string;
  html: string;
  enabled: boolean;
}

/** A tenant's sparse override for one trigger (Phase 3). */
export interface TemplateOverride {
  trigger: string;
  subject: string | null;                 // null → registry default
  blocks: Record<string, string> | null;  // partial blockKey→value; null → all defaults
  enabled: boolean;
}
