import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.locator('button[data-sound="off"]').click().catch(() => {});
await page.waitForTimeout(1500);

// RESET -> bare terrain
await page.getByRole('button', { name: 'RESET' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/step_00_reset.png' });

// step through layers
const labels = ['Color grade', 'Lighting', 'Fog', 'Sky', 'Water'];
for (let i = 0; i < labels.length; i++) {
  await page.getByRole('button', { name: '▶ NEXT' }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `/tmp/step_${String(i + 1).padStart(2, '0')}_${labels[i].replace(/\W/g, '')}.png` });
}

console.log('errors:', errs.length ? errs.slice(0, 5).join(' | ') : 'none');
await browser.close();
