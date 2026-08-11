// @vitest-environment happy-dom
/**
 * Portal #98 §3.4, said at the moment it changes an expectation.
 *
 * The account-wide banner answers "does this company have a window"; it does
 * not answer "is the thing I am about to press going to land in it". An
 * inspector presses Publish believing the client now has their report, and
 * inside the window that belief is wrong by up to a day — so the correction
 * belongs on this button, not only on the page behind it.
 *
 * The two failure modes worth holding down are opposite: saying NOTHING inside
 * the window (the inspector tells the client to check their inbox), and saying
 * something to a company that is not in one (a permanent scary notice on the
 * most-used button in the product).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PublishModal } from './PublishModal';

let unlockAtMs: number | null = null;

vi.mock('~/hooks/useSessionContext', () => ({
  useSessionContext: () => ({ outboundCoolingWindow: unlockAtMs === null ? null : { unlockAtMs } }),
  useDisplayTimeZone: () => 'America/New_York',
  useChromeDateTimeFormat: () => ({ locale: 'en-US', dateFormat: 'us', timeFormat: '12h' }),
}));

const props = {
  open: true,
  progress: { rated: 10, total: 10, pct: 100 },
  status: 'completed',
  publishError: null,
  isSubmitting: false,
  onClose: () => {},
  onPublish: () => {},
  autoSign: false,
  onAutoSignToggle: () => {},
};

describe('PublishModal — outbound cooling window', () => {
  it('says nothing when the company is not in a window', () => {
    unlockAtMs = null;
    render(<PublishModal {...props} />);
    expect(screen.queryByText(/less than a day old/i)).toBeNull();
  });

  it('names the instant the client email will go, not a relative duration', () => {
    // 2026-08-11 14:00 UTC -> 10:00 AM EDT
    unlockAtMs = Date.UTC(2026, 7, 11, 14, 0, 0);
    render(<PublishModal {...props} />);
    const notice = screen.getByText(/less than a day old/i);
    expect(notice.textContent).toMatch(/Aug 11, 2026/);
    expect(notice.textContent).toMatch(/10:00\s?AM/);
  });

  it('promises a delay, never a loss, and says publishing itself still works', () => {
    // The inspector's real question is "did I just break the delivery, and do
    // I have to come back and press something again". Both answers are load
    // bearing: the send re-schedules itself, and the report is live now.
    unlockAtMs = Date.now() + 3_600_000;
    render(<PublishModal {...props} />);
    const notice = screen.getByText(/less than a day old/i);
    expect(notice.textContent).toMatch(/sends itself/i);
    expect(notice.textContent).toMatch(/nothing to redo/i);
    expect(notice.textContent).toMatch(/goes live now/i);
  });

  it('does not block or reword the publish action', () => {
    // A notice that disabled the button would be a gate nobody asked for: the
    // window holds one email, not the publish.
    unlockAtMs = Date.now() + 3_600_000;
    render(<PublishModal {...props} />);
    expect(screen.getByRole('button', { name: /publish/i })).not.toBeDisabled();
  });
});
