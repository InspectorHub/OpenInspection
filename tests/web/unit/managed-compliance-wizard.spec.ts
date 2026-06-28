/**
 * ManagedComplianceWizard render tests — Plan 2 Task 5 (review fix).
 *
 * Asserts that the managed carrier selector renders both options (Twilio and
 * Telnyx) and that the managedProvider prop sets the correct initial
 * aria-pressed state.
 *
 * Separate from the BFF-seam tests in settings-communication-managed.spec.ts,
 * which cover loader + action only and explicitly exclude component render.
 *
 * Router wrapper: createMemoryRouter + RouterProvider (react-router v7) —
 * required because ManagedComplianceWizard renders <Form> from react-router,
 * which needs a data-router context to avoid a runtime invariant violation.
 * No existing spec in this repo wraps a <Form>-bearing component; this is the
 * first to introduce the pattern.
 *
 * Precedent for the createRoot + act harness:
 *   tests/web/unit/version-history-panel.spec.ts
 *   tests/web/unit/media-viewer.spec.ts
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import {
  ManagedComplianceWizard,
  type ManagedComplianceData,
} from '~/components/settings/ManagedComplianceWizard';

// ---------------------------------------------------------------------------
// Minimal fixture
// ---------------------------------------------------------------------------

// complianceStatus === 'not_started' means the StatusTimeline sub-component
// is NOT rendered (guarded by `!== 'not_started'`), keeping the render surface
// narrow: just the carrier selector Form + the business-info Form.
const BASE_COMPLIANCE: ManagedComplianceData = {
  complianceStatus: 'not_started',
  rejectionReason: null,
  customerProfileStatus: null,
  brandStatus: null,
  campaignStatus: null,
  tfvStatus: null,
  messagingServiceSid: null,
  provisionedNumber: null,
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(managedProvider?: 'twilio' | 'telnyx'): void {
  const router = createMemoryRouter([
    {
      path: '/',
      element: createElement(ManagedComplianceWizard, {
        compliance: BASE_COMPLIANCE,
        managedProvider,
      }),
    },
  ]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(RouterProvider, { router }));
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Returns the first <button> whose trimmed text content exactly equals `text`. */
function buttonByText(text: string): HTMLButtonElement | null {
  const all = Array.from(document.body.querySelectorAll('button')) as HTMLButtonElement[];
  return all.find((b) => b.textContent?.trim() === text) ?? null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ManagedComplianceWizard render — carrier selector (Task 5)', () => {
  it('renders both Twilio and Telnyx selector buttons', () => {
    mount('twilio');
    expect(buttonByText('Twilio')).not.toBeNull();
    expect(buttonByText('Telnyx')).not.toBeNull();
  });

  it('Twilio button is aria-pressed="true" and Telnyx is aria-pressed="false" when managedProvider="twilio"', () => {
    mount('twilio');
    expect(buttonByText('Twilio')?.getAttribute('aria-pressed')).toBe('true');
    expect(buttonByText('Telnyx')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('Telnyx button is aria-pressed="true" and Twilio is aria-pressed="false" when managedProvider="telnyx"', () => {
    mount('telnyx');
    expect(buttonByText('Twilio')?.getAttribute('aria-pressed')).toBe('false');
    expect(buttonByText('Telnyx')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('defaults to Twilio pressed (aria-pressed="true") when managedProvider is omitted', () => {
    mount(undefined);
    expect(buttonByText('Twilio')?.getAttribute('aria-pressed')).toBe('true');
    expect(buttonByText('Telnyx')?.getAttribute('aria-pressed')).toBe('false');
  });
});
