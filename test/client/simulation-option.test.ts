import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../src/client/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/client/styles.css', import.meta.url), 'utf8');

function ruleBody(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('Simulation mode controls', () => {
  it('starts the checkbox, the Simulate buttons and the SIMULATION flag hidden', () => {
    expect(html).toMatch(/id="simulation-option"[^>]*\shidden>/);
    expect(html).toMatch(/id="simulate"[^>]*\shidden>/);
    expect(html).toMatch(/id="simulate-all-clear"[^>]*\shidden>/);
    expect(html).toMatch(/id="sim-flag"[^>]*\shidden>/);
  });

  it('keeps a hidden Settings row hidden, since display:flex on labels beats the hidden attribute', () => {
    const labelDisplay = css.indexOf('.settings-form label {');
    const hide = css.indexOf('.settings-footer [hidden]');
    expect(labelDisplay).toBeGreaterThan(-1);
    expect(hide).toBeGreaterThan(labelDisplay);
    expect(ruleBody('.settings-form label {')).toMatch(/display:\s*flex/);
    expect(ruleBody('.settings-footer [hidden]')).toMatch(/display:\s*none/);
  });

  it('keeps hidden Simulate buttons and the SIMULATION flag hidden', () => {
    expect(css.indexOf('.topbar-actions [hidden]')).toBeGreaterThan(css.indexOf('.topbar-actions .icon-button'));
    expect(ruleBody('.topbar-actions [hidden]')).toMatch(/display:\s*none/);
    expect(css.indexOf('.sim-flag[hidden]')).toBeGreaterThan(css.indexOf('.sim-flag {'));
    expect(ruleBody('.sim-flag[hidden]')).toMatch(/display:\s*none/);
  });
});
