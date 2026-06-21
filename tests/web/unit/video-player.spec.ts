// Plan 7 — VideoPlayer provider branch: 'stream' renders an <iframe>;
// 'r2' renders a native <video>. Uses react-dom/client + happy-dom.
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VideoPlayer, streamIframeSrc } from '~/components/media-studio/VideoPlayer';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

// ── streamIframeSrc helper ───────────────────────────────────────────────────

describe('streamIframeSrc', () => {
  it('builds the correct Cloudflare Stream iframe URL', () => {
    expect(streamIframeSrc('customer-abc', 'uid-123')).toBe(
      'https://customer-abc.cloudflarestream.com/uid-123/iframe',
    );
  });
});

// ── Stream provider ──────────────────────────────────────────────────────────

describe('VideoPlayer: provider=stream', () => {
  it('renders an <iframe> when subdomain and uid are present', () => {
    mount(
      createElement(VideoPlayer, {
        provider: 'stream',
        streamUid: 'abc123',
        streamCustomerSubdomain: 'customer-xyz',
        readyToStream: true,
      }),
    );
    const iframe = container!.querySelector('[data-testid="video-player"] iframe');
    expect(iframe).not.toBeNull();
    expect((iframe as HTMLIFrameElement).src).toContain('cloudflarestream.com');
    expect((iframe as HTMLIFrameElement).src).toContain('abc123');
  });

  it('renders processing state when readyToStream is false', () => {
    mount(
      createElement(VideoPlayer, {
        provider: 'stream',
        streamUid: 'abc123',
        streamCustomerSubdomain: 'customer-xyz',
        readyToStream: false,
        pctComplete: 42,
      }),
    );
    expect(container!.querySelector('[data-testid="video-processing"]')).not.toBeNull();
    expect(container!.textContent).toContain('42%');
    expect(container!.querySelector('iframe')).toBeNull();
  });

  it('renders unavailable when subdomain is absent', () => {
    mount(
      createElement(VideoPlayer, {
        provider: 'stream',
        streamUid: 'abc123',
        streamCustomerSubdomain: null,
      }),
    );
    expect(container!.querySelector('[data-testid="video-unavailable"]')).not.toBeNull();
    expect(container!.querySelector('iframe')).toBeNull();
  });

  it('renders unavailable when streamUid is absent', () => {
    mount(
      createElement(VideoPlayer, {
        provider: 'stream',
        streamCustomerSubdomain: 'customer-xyz',
      }),
    );
    expect(container!.querySelector('[data-testid="video-unavailable"]')).not.toBeNull();
  });
});

// ── R2 provider ──────────────────────────────────────────────────────────────

describe('VideoPlayer: provider=r2', () => {
  it('renders a native <video> element with r2-object src and poster', () => {
    mount(
      createElement(VideoPlayer, {
        provider: 'r2',
        inspectionId: 'insp-1',
        mediaId: 'media-1',
      }),
    );
    const wrapper = container!.querySelector('[data-testid="video-player-r2"]');
    expect(wrapper).not.toBeNull();

    const video = wrapper!.querySelector('video') as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    // src attribute contains the r2-object path
    const srcAttr = video!.getAttribute('src') ?? '';
    expect(srcAttr).toContain('/api/inspections/insp-1/media/video/r2-object/media-1');
    // poster attribute (happy-dom may surface it via getAttribute)
    const posterAttr = video!.getAttribute('poster') ?? '';
    expect(posterAttr).toContain('/api/inspections/insp-1/media/video/r2-object/media-1/poster');
    // controls attribute is present
    expect(video!.hasAttribute('controls')).toBe(true);
  });

  it('renders unavailable when inspectionId or mediaId is absent', () => {
    mount(
      createElement(VideoPlayer, {
        provider: 'r2',
        inspectionId: 'insp-1',
        // mediaId omitted
      }),
    );
    expect(container!.querySelector('[data-testid="video-unavailable"]')).not.toBeNull();
    expect(container!.querySelector('video')).toBeNull();
  });

  it('does NOT render an <iframe> for r2 provider', () => {
    mount(
      createElement(VideoPlayer, {
        provider: 'r2',
        inspectionId: 'insp-1',
        mediaId: 'media-2',
      }),
    );
    expect(container!.querySelector('iframe')).toBeNull();
  });
});
