import { test, expect, chromium } from '@playwright/test';

test('2-tab mesh semantics: no self discovery/errors and clean disconnect events', async ({ baseURL }, testInfo) => {
  const budgetMs = Math.max(20_000, testInfo.timeout - 2_000);
  const connectTimeoutMs = Math.min(30_000, Math.floor(budgetMs * 0.7));

  const testId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const sessionId = `__test_semantics_${testId}`;
  const url = `${baseURL}/?autostart=1&maxPeers=2&minPeers=1&sessionId=${encodeURIComponent(sessionId)}`;

  const browser = await chromium.launch({
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns']
  });

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  const installProbe = async (page: any) => {
    const hasMesh = await page.evaluate(() => typeof (window as any).__mesh?.getClientId === 'function');
    if (!hasMesh) {
      const startButton = page.getByTestId('start-mesh');
      if (await startButton.isVisible()) {
        if (await startButton.isEnabled()) {
          await startButton.click();
        }
      }
    }

    await expect
      .poll(async () => {
        return await page.evaluate(() => typeof (window as any).__mesh?.getClientId === 'function');
      }, { timeout: connectTimeoutMs, intervals: [200, 500, 1000] })
      .toBe(true);

    await page.evaluate(() => {
      const w = window as any;
      if (w.__meshProbeInstalled) return;
      const mesh = w.__mesh;
      if (!mesh) return;

      w.__meshProbeInstalled = true;
      w.__meshProbe = {
        errors: [] as Array<{ peerId: string; message: string }> ,
        connected: [] as string[],
        disconnected: [] as string[]
      };

      mesh.on('peer:error', (data: any) => {
        w.__meshProbe.errors.push({
          peerId: String(data?.peerId ?? ''),
          message: String(data?.error?.message ?? data?.error ?? '')
        });
      });

      mesh.on('peer:connected', (peerId: string) => {
        w.__meshProbe.connected.push(String(peerId ?? '').trim());
      });

      mesh.on('peer:disconnected', (peerId: string) => {
        w.__meshProbe.disconnected.push(String(peerId ?? '').trim());
      });
    });
  };

  try {
    await Promise.all([pageA.goto(url), pageB.goto(url)]);
    await Promise.all([installProbe(pageA), installProbe(pageB)]);

    try {
      await expect
        .poll(async () => {
          const [a, b] = await Promise.all([
            pageA.locator('[data-testid="connected-peers"]').innerText(),
            pageB.locator('[data-testid="connected-peers"]').innerText()
          ]);
          const toCount = (text: string) => Number((text.trim().match(/^(\d+)\s*\//)?.[1] ?? '0'));
          return [toCount(a), toCount(b)];
        }, { timeout: connectTimeoutMs, intervals: [250, 500, 1000] })
        .toEqual([1, 1]);
    } catch (err) {
      const dumpPageState = async (page: any, name: string) => {
        const state = await page.evaluate(() => {
          const w = window as any;
          const mesh = w.__mesh;
          const logs = (w.__app?.messageLog ?? []).map((e: any) => `${e?.timestamp || ''} | ${e?.sender || ''} | ${e?.text || ''}`);
          return {
            clientId: String(mesh?.getClientId?.() ?? ''),
            discovered: mesh?.getDiscoveredPeers?.() ?? [],
            connected: mesh?.getConnectedPeers?.() ?? [],
            logs: logs.slice(-12)
          };
        });
        // eslint-disable-next-line no-console
        console.log(`\n[${name}] state`, JSON.stringify(state, null, 2));
      };

      await dumpPageState(pageA, 'A');
      await dumpPageState(pageB, 'B');
      throw err;
    }

    // Pass condition: local id never appears in discovered peers.
    await expect
      .poll(async () => {
        return await pageA.evaluate(() => {
          const mesh = (window as any).__mesh;
          const self = String(mesh?.getClientId?.() ?? '').trim();
          const discovered = (mesh?.getDiscoveredPeers?.() ?? []).map((p: string) => String(p ?? '').trim());
          return !!self && !discovered.includes(self);
        });
      }, { timeout: 5_000, intervals: [200, 500, 1000] })
      .toBe(true);

    await expect
      .poll(async () => {
        return await pageB.evaluate(() => {
          const mesh = (window as any).__mesh;
          const self = String(mesh?.getClientId?.() ?? '').trim();
          const discovered = (mesh?.getDiscoveredPeers?.() ?? []).map((p: string) => String(p ?? '').trim());
          return !!self && !discovered.includes(self);
        });
      }, { timeout: 5_000, intervals: [200, 500, 1000] })
      .toBe(true);

    // Pass condition: no peer:error for local id.
    const noLocalErrorA = await pageA.evaluate(() => {
      const w = window as any;
      const mesh = w.__mesh;
      const self = String(mesh?.getClientId?.() ?? '').trim();
      const errors = (w.__meshProbe?.errors ?? []) as Array<{ peerId: string; message: string }>;
      return !errors.some((e) => String(e.peerId ?? '').trim() === self);
    });
    expect(noLocalErrorA).toBe(true);

    const noLocalErrorB = await pageB.evaluate(() => {
      const w = window as any;
      const mesh = w.__mesh;
      const self = String(mesh?.getClientId?.() ?? '').trim();
      const errors = (w.__meshProbe?.errors ?? []) as Array<{ peerId: string; message: string }>;
      return !errors.some((e) => String(e.peerId ?? '').trim() === self);
    });
    expect(noLocalErrorB).toBe(true);

    // Pass condition: no peer:disconnected for never-connected attempts.
    const disconnectedSubsetConnectedA = await pageA.evaluate(() => {
      const probe = (window as any).__meshProbe;
      const connected = new Set((probe?.connected ?? []).map((p: string) => String(p ?? '').trim()));
      const disconnected = (probe?.disconnected ?? []).map((p: string) => String(p ?? '').trim());
      return disconnected.every((p: string) => connected.has(p));
    });
    expect(disconnectedSubsetConnectedA).toBe(true);

    const disconnectedSubsetConnectedB = await pageB.evaluate(() => {
      const probe = (window as any).__meshProbe;
      const connected = new Set((probe?.connected ?? []).map((p: string) => String(p ?? '').trim()));
      const disconnected = (probe?.disconnected ?? []).map((p: string) => String(p ?? '').trim());
      return disconnected.every((p: string) => connected.has(p));
    });
    expect(disconnectedSubsetConnectedB).toBe(true);

    // Additional stability signal: no recurring timeout loops on 2-tab session.
    const timeoutErrorsA = await pageA.evaluate(() => {
      const errors = ((window as any).__meshProbe?.errors ?? []) as Array<{ peerId: string; message: string }>;
      return errors.filter((e) => /connection timeout/i.test(String(e.message ?? ''))).length;
    });
    const timeoutErrorsB = await pageB.evaluate(() => {
      const errors = ((window as any).__meshProbe?.errors ?? []) as Array<{ peerId: string; message: string }>;
      return errors.filter((e) => /connection timeout/i.test(String(e.message ?? ''))).length;
    });

    expect(timeoutErrorsA + timeoutErrorsB).toBe(0);
  } finally {
    await browser.close();
  }
});
