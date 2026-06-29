/**
 * E2E smoke + screenshots for deployment verification.
 * Usage: node scripts/e2e-screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import path from 'path';

const base = process.env.BASE_URL || 'http://localhost:3000';
const outDir = path.join(process.cwd(), 'docs', 'screenshots', 'deployment');

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Opening', base);
  await page.goto(base, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(3000);

  const loginVisible = await page.getByText('Sign in to LumiSec').isVisible().catch(() => false);
  const checking = await page.getByText('Checking session').isVisible().catch(() => false);

  if (checking) {
    console.log('Waiting for auth (max 20s)...');
    await page.waitForTimeout(20_000);
  }

  if (await page.getByText('Sign in to LumiSec').isVisible().catch(() => false)) {
    console.log('Logging in as admin@soar.local');
    await page.fill('input[type="email"], input[name="email"]', 'admin@soar.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.getByRole('button', { name: /sign in|login/i }).click();
    await page.waitForTimeout(5000);
  }

  await page.screenshot({ path: path.join(outDir, '01-home.png'), fullPage: true });
  console.log('Screenshot: 01-home.png');

  const hasSoar = await page.getByText('LumiSec SOAR').first().isVisible().catch(() => false);
  if (hasSoar) {
    for (const [name, label] of [
      ['02-dashboard', 'Dashboard'],
      ['03-incidents', 'Incidents'],
      ['04-alerts', 'Alerts'],
      ['05-connectors', 'Connectors'],
      ['06-vault', 'Vault'],
    ]) {
      const link = page.getByRole('button', { name: label }).or(page.getByText(label, { exact: true }));
      if (await link.first().isVisible().catch(() => false)) {
        await link.first().click();
        await page.waitForTimeout(2500);
        await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
        console.log('Screenshot:', `${name}.png`);
      }
    }
  }

  await browser.close();
  console.log('Done — screenshots in', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
