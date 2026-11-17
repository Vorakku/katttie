import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const sdk = readFileSync(new URL('./fake-youtube.js', import.meta.url), 'utf8');
async function contextWithPlayer(browser: Browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: sdk }));
  return context;
}
async function createRoom(page: Page) {
  await page.goto('/');
  await page.getByLabel('What should we call you?').fill('Moon');
  await page.getByRole('button', { name: 'Create our room' }).click();
  await expect(page.getByText('Room connected', { exact: true })).toBeVisible();
  return page.getByLabel('Guest invitation link').inputValue();
}
async function joinGuest(context: BrowserContext, invite: string) {
  const page = await context.newPage();
  await page.goto(invite);
  expect(page.url().includes('#')).toBe(false);
  await page.getByLabel('What should we call you?').fill('Star');
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(page.getByText('Room connected', { exact: true })).toBeVisible();
  return page;
}
async function addSong(page: Page, id = 'dQw4w9WgXcQ') {
  await page.getByLabel('YouTube video link').fill(`https://youtu.be/${id}`);
  await page.getByRole('button', { name: 'Add a song', exact: true }).click();
  await expect(page.getByLabel('YouTube video link')).toHaveValue('');
}

test('two isolated participants share queue, controls, refresh and single-role takeover', async ({ browser }) => {
  const hostContext = await contextWithPlayer(browser);
  const guestContext = await contextWithPlayer(browser);
  const host = await hostContext.newPage();
  try {
    const invite = await createRoom(host);
    const guest = await joinGuest(guestContext, invite);
    await expect(host.getByText('Star', { exact: true })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Copy guest invitation' })).toHaveCount(0);
    await addSong(host);
    await expect(guest.getByText('1 / 50')).toBeVisible();
    await addSong(guest, 'jfKfPfyJRdk');
    await expect(host.getByText('2 / 50')).toBeVisible();
    await host.getByRole('button', { name: /Enable listening|Start listening|Tap to start listening/ }).click();
    await guest.getByRole('button', { name: /Enable listening|Start listening|Tap to start listening/ }).click();
    await host.getByRole('button', { name: 'Play for both', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Pause for both', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Pause for both', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Play for both', exact: true })).toBeVisible();
    await guest.reload();
    await expect(guest.getByText('Room connected', { exact: true })).toBeVisible();
    await expect(guest.getByText('2 / 50')).toBeVisible();
    const replacement = await guestContext.newPage();
    await replacement.goto(guest.url());
    await expect(replacement.getByText('Room connected', { exact: true })).toBeVisible();
    await expect(guest.getByText('Opened in another tab', { exact: true })).toBeVisible();
    await expect(host.getByText('Room connected', { exact: true })).toBeVisible();
  } finally { await hostContext.close(); await guestContext.close(); }
});

test('320px layout preserves a visible compliant player, labels and invalid-link recovery', async ({ browser }) => {
  const context = await contextWithPlayer(browser, { width: 320, height: 800 });
  const page = await context.newPage();
  try {
    await createRoom(page);
    await addSong(page);
    const iframe = page.getByTitle('YouTube shared listening player');
    await expect(iframe).toBeVisible();
    const bounds = await iframe.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(200);
    expect(bounds?.height).toBeGreaterThanOrEqual(200);
    await page.screenshot({ path: 'test-results/mobile-room.png', fullPage: true, mask: [page.getByLabel('Guest invitation link')] });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > 321).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })));
    expect(overflow).toEqual([]);
    await page.getByLabel('YouTube video link').fill('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ');
    await page.getByRole('button', { name: 'Add a song', exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByText('1 / 50')).toBeVisible();
    const add = await page.getByRole('button', { name: 'Add a song', exact: true }).boundingBox();
    expect(add?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: 'test-results/mobile-room.png', fullPage: true, mask: [page.getByLabel('Guest invitation link')] });
  } finally { await context.close(); }
});
