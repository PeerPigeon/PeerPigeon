const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = new Map();

    const addError = (msg, stack) => {
        const topStack = stack ? stack.split('\n')[0] : 'no stack';
        const key = `${msg} | ${topStack}`;
        if (!errors.has(key)) {
            errors.set(key, { msg, topStack });
            console.log(`ERROR: ${msg} (${topStack})`);
        }
    };

    page.on('console', msg => {
        if (msg.type() === 'error') {
            addError(msg.text(), msg.location().url + ':' + msg.location().lineNumber);
        }
    });

    page.on('pageerror', err => {
        addError(err.message, err.stack);
    });

    try {
        console.log('Navigating to http://localhost:5173/?autostart=1&runtime=go-wasm');
        await page.goto('http://localhost:5173/?autostart=1&runtime=go-wasm', { waitUntil: 'networkidle', timeout: 30000 });
        console.log('Waiting for 20 seconds...');
        await new Promise(resolve => setTimeout(resolve, 20000));
    } catch (e) {
        console.error('Wait failed:', e.message);
    } finally {
        await browser.close();
        console.log('Finished.');
    }
})();
