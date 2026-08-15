const { chromium } = require('playwright');

(async () => {
    let devServer;
    // We'll check if port 5183 is already open, if not we'll try to start npm run dev in background
    // However, the prompt says "Start dev server if needed using existing playwright web server behavior is optional"
    // For simplicity in a one-off script, I'll assume I should try to hit the URL.
    
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', msg => {
        const text = msg.text();
        if (/parse|SyntaxError|Unexpected token/i.test(text)) {
            console.log(`CONSOLE: ${text}`);
        }
    });

    page.on('pageerror', err => {
        console.log(`PAGE ERROR: ${err.message}`);
    });

    try {
        console.log('Navigating to https://localhost:5173/?autostart=1 ...');
        await page.goto('https://localhost:5173/?autostart=1', { timeout: 30000 });
        console.log('Page loaded, waiting 15 seconds for logs...');
        await new Promise(resolve => setTimeout(resolve, 15000));
    } catch (e) {
        console.error('Error during navigation or wait:', e.message);
    } finally {
        await browser.close();
    }
})();
