import { readFileSync } from 'fs';
import { join } from 'path';

describe('App system notification placement', () => {
  const template = readFileSync(join(__dirname, 'app.component.html'), 'utf8');

  it('renders the banner in the replay/print exclusion block, outside the loading block', () => {
    const banner = '<coding-box-system-notification-banner>';
    const exclusionBlockStart = template.indexOf("@if (!url.path().includes('replay')");
    const exclusionBlockEnd = template.indexOf('\n  }\n  <div class="app-main">', exclusionBlockStart);

    expect(exclusionBlockStart).toBeGreaterThanOrEqual(0);
    expect(exclusionBlockEnd).toBeGreaterThan(exclusionBlockStart);
    expect(template.slice(0, exclusionBlockStart)).not.toContain(banner);
    expect(template.slice(exclusionBlockStart, exclusionBlockEnd)).toContain(banner);
  });
});
