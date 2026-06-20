import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:5173/';
const OUT = process.argv[3] || '/tmp/shot.png';
const HOVER = process.argv[4]; // optional: project link text to hover

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// click ENTER (without sound) if present
const enter = page.locator('button[data-sound="off"]');
if (await enter.count()) {
  await enter.click({ timeout: 2000 }).catch(() => {});
}
await page.waitForTimeout(2500);

if (HOVER) {
  await page.getByText(HOVER, { exact: false }).first().hover().catch(() => {});
  await page.waitForTimeout(2500);
}

await page.screenshot({ path: OUT });
console.log('=== SCREENSHOT:', OUT, '===');
console.log('=== CONSOLE (' + logs.length + ') ===');
console.log(logs.slice(0, 40).join('\n'));

await browser.close();
