// @vitest-environment happy-dom
/**
 * The progress strip and the section donut colour their marks with theme custom properties. A name that the theme
 * does not define resolves to nothing at all (no error, no warning), which left the dots and the ring uncoloured.
 * This reads the names back out of what is rendered and checks each against the theme file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgressStripText } from './ProgressStripText';
import { SectionDonut } from './SectionDonut';

afterEach(cleanup);

const THEME = readFileSync(join(__dirname, '../../theme.css'), 'utf8');
const defined = (name: string) => new RegExp(`${name}\\s*:`).test(THEME);
const varsIn = (html: string) => Array.from(html.matchAll(/var\((--[a-z0-9-]+)\)/g), (m) => m[1]);

describe('status colours resolve against the theme', () => {
  it('the progress strip dots use defined properties, one per kind', () => {
    const { container } = render(<ProgressStripText rated={2} total={9} defects={1} monitor={1} etaMinutes={5} />);
    const names = varsIn(container.innerHTML);
    expect(names).toHaveLength(3);
    for (const name of names) expect(defined(name), name).toBe(true);
  });

  it('the donut ring uses a defined property in each of its three states', () => {
    for (const props of [{ rated: 1, total: 3, hasDefect: true }, { rated: 3, total: 3, hasDefect: false }, { rated: 1, total: 3, hasDefect: false }]) {
      const { container, unmount } = render(<SectionDonut {...props} />);
      const names = varsIn(container.innerHTML);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(defined(name), name).toBe(true);
      unmount();
    }
  });

  it('CONTROL - the check does catch a name the theme lacks', () => {
    expect(defined('--ih-ok')).toBe(false);
  });
});
