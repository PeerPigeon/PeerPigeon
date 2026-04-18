import { test, expect, chromium } from '@playwright/test';

test('4-peer saturation rebalance: a late joiner gets admitted when maxPeers=2', async ({ baseURL }, testInfo) => {
  const budgetMs = Math.max(20_000, testInfo.timeout - 2_000);
  const fillWaitMs = Math.min(20_000, Math.floor(budgetMs * 0.5));
  const rebalanceWaitMs = Math.min(25_000, Math.floor(budgetMs * 0.7));

  const testId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const sessionId = `__test_saturation_${testId}`;
  const url = `${baseURL}/?autostart=1&maxPeers=2&minPeers=1&sessionId=${encodeURIComponent(sessionId)}`;

  const browser = await chromium.launch({
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns']
  });

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const pages: any[] = [];

  const getConnected = async (page: any): Promise<number> => {
    const text = ((await page.locator('[data-testid="connected-peers"]').innerText()) || '').trim();
    const match = text.match(/^(\d+)\s*\//);
    return match ? Number(match[1]) : 0;
  };

  const getMeshSnapshot = async (page: any) => {
    return await page.evaluate(() => {
      const mesh = (window as any).__mesh;
      return {
        clientId: String(mesh?.getClientId?.() ?? ''),
        connected: (mesh?.getConnectedPeers?.() ?? []).length,
        discovered: (mesh?.getDiscoveredPeers?.() ?? []).length
      };
    });
  };

  try {
    for (let i = 0; i < 3; i++) {
      const page = await context.newPage();
      await page.goto(url);
      pages.push(page);
    }

    await expect
      .poll(async () => {
        const counts = await Promise.all(pages.map((page) => getConnected(page)));
        const saturatedPeers = counts.filter((count) => count >= 2).length;
        return saturatedPeers;
      }, { timeout: fillWaitMs, intervals: [250, 500, 1000] })
      .toBeGreaterThanOrEqual(2);

    const latePeer = await context.newPage();
    await latePeer.goto(url);
    pages.push(latePeer);

    await expect
      .poll(async () => await getConnected(latePeer), { timeout: rebalanceWaitMs, intervals: [250, 500, 1000, 2000] })
      .toBeGreaterThan(0);

    await expect
      .poll(async () => {
        const snapshots = await Promise.all(pages.map((page) => getMeshSnapshot(page)));
        return snapshots.every((snapshot) => snapshot.connected >= 1);
      }, { timeout: rebalanceWaitMs, intervals: [250, 500, 1000, 2000] })
      .toBe(true);
  } catch (error) {
    const snapshots = await Promise.all(pages.map((page) => getMeshSnapshot(page)));
    // eslint-disable-next-line no-console
    console.log('saturation snapshots', JSON.stringify(snapshots, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
});
