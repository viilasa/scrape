const express = require('express');
const puppeteer = require('puppeteer');
const { URL } = require('url'); // For URL validation

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies for POST requests

const PORT = process.env.PORT || 3000;

const MAX_CONCURRENT_SCRAPES = parseInt(process.env.MAX_CONCURRENT_SCRAPES || "100");

const PUPPETEER_LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--single-process',
    '--disable-features=site-per-process',
];

async function resolveRedirect(scrapeUrl) {
    let browser;
    console.log(`[${scrapeUrl}] Starting to resolve redirect.`);
    const startTime = Date.now();

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: PUPPETEER_LAUNCH_ARGS,
        });
        const page = await browser.newPage();

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (request.isInterceptResolutionHandled()) return;

            const resourceType = request.resourceType();
            const requestUrl = request.url();

            // MODIFIED: Removed 'script' from blockedResourceTypes to allow redirect scripts to run
            const blockedResourceTypes = ['image', 'media', 'font', 'stylesheet'];
            const blockedDomains = [
                'googlesyndication.com', 'googleadservices.com', 'doubleclick.net', 'google-analytics.com',
                'connect.facebook.net', 'platform.twitter.com', /* 'https://www.youtube.com/watch?v=F3pWmvCdrx4', */ // Potentially problematic
                'criteo.com', 'adsrvr.org', 'scorecardresearch.com', 'adservice.google.com',
                'pubmatic.com', 'rubiconproject.com', 'outbrain.com', 'taboola.com',
                'track.hubspot.com', '.hotjar.com', '.inspectlet.com',
            ];

            // Allow scripts, unless they are from explicitly blocked domains.
            if ( (blockedResourceTypes.includes(resourceType) && resourceType !== 'script') ||
                 blockedDomains.some(domain => requestUrl.includes(domain))) {
                request.abort().catch(e => console.warn(`[${scrapeUrl}] Failed to abort request: ${e.message.substring(0,100)}`));
            } else {
                request.continue().catch(e => console.warn(`[${scrapeUrl}] Failed to continue request: ${e.message.substring(0,100)}`));
            }
        });

        console.log(`[${scrapeUrl}] Navigating (waitUntil: domcontentloaded)...`);
        await page.goto(scrapeUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        let currentUrl = page.url();
        console.log(`[${scrapeUrl}] Initial navigation complete. Current URL: ${currentUrl}`);

        if (currentUrl.includes('news.google.com/articles/') || currentUrl.includes('news.google.com/rss/articles/')) {
            try {
                console.log(`[${scrapeUrl}] Google News intermediate page detected. Waiting for redirect (waitUntil: 'load', timeout: 60000ms)...`);
                await page.waitForNavigation({ // Waits for the next navigation to complete
                    waitUntil: 'load',         // 'load' is generally good for JS-driven redirects
                    timeout: 60000
                });
                currentUrl = page.url();
                console.log(`[${scrapeUrl}] Google News redirect complete. New URL: ${currentUrl}`);
            } catch (e) {
                console.warn(`[${scrapeUrl}] Warning/timeout on Google News redirect. Message: ${e.message}. Current URL remains: ${currentUrl}. Stack: ${e.stack}`);
                // If timeout, currentUrl will be the Google News URL itself.
            }
        }

        const finalUrl = currentUrl;
        const duration = (Date.now() - startTime) / 1000;

        // Check if we're still on a Google News URL that isn't the final article page
        // This check might be too simplistic, as some "final" URLs could still be on google.com if it's a direct Google hosted article or error.
        // The primary goal is to get where Puppeteer lands.
        if ((finalUrl.includes('google.com/rss/articles') || finalUrl.includes('google.com/articles')) &&
            (scrapeUrl.includes('news.google.com/articles') || scrapeUrl.includes('news.google.com/rss/articles')) && // Original was a GNews link
            finalUrl === scrapeUrl) { // And the URL hasn't changed
            console.warn(`[${scrapeUrl}] Ended on the same Google News URL. Redirect might have failed or this is the intended page.`);
        }

        console.log(`[${scrapeUrl}] Successfully resolved in ${duration.toFixed(2)}s. Final URL: ${finalUrl}`);
        return { success: true, originalUrl: scrapeUrl, finalUrl: finalUrl, duration: duration.toFixed(2) };

    } catch (error) {
        const duration = (Date.now() - startTime) / 1000;
        console.error(`[${scrapeUrl}] Error resolving redirect after ${duration.toFixed(2)}s: ${error.message}`);
        return { success: false, originalUrl: scrapeUrl, error: error.message, details: error.stack, duration: duration.toFixed(2) };
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log(`[${scrapeUrl}] Browser closed for ${scrapeUrl}.`);
            } catch (closeError) {
                console.error(`[${scrapeUrl}] Error closing browser: ${closeError.message}`);
            }
        }
    }
}

// --- API Endpoints ---
app.get('/', (req, res) => {
    res.send(`Puppeteer URL resolving service is running. Use GET /api/resolve?url=<URL> for single or POST /api/resolve-batch for multiple URLs. Max concurrent for batch: ${MAX_CONCURRENT_SCRAPES}`);
});

app.get('/api/resolve', async (req, res) => {
    const urlToResolve = req.query.url;
    if (!urlToResolve) return res.status(400).json({ error: 'URL query parameter is required.' });

    let validatedUrl;
    try {
        validatedUrl = new URL(urlToResolve);
        if (!validatedUrl.protocol.startsWith('http')) {
             throw new Error('URL must start with http or https');
        }
    } catch (e) {
        return res.status(400).json({ error: `Invalid URL format provided: ${e.message}` });
    }

    console.log(`[API /api/resolve] Received single URL: ${validatedUrl.href}`);
    const result = await resolveRedirect(validatedUrl.href);

    if (!result.success) {
        return res.status(500).json({ // Internal server error for puppeteer failures
            message: "Failed to resolve the URL.",
            error: result.error,
            originalUrl: result.originalUrl,
            details: result.details
        });
    }
    res.json(result); // Expected: { success: true, originalUrl, finalUrl, duration }
});

app.post('/api/resolve-batch', async (req, res) => {
    const urls = req.body.urls;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'An array of "urls" is required in the request body.' });
    }
    if (urls.length > 200) {
        return res.status(400).json({ error: `Too many URLs. Max 200 per batch, got ${urls.length}.` });
    }

    console.log(`[API /api/resolve-batch] Received ${urls.length} URLs. Max concurrency: ${MAX_CONCURRENT_SCRAPES}.`);

    const pLimitModule = await import('p-limit');
    const limit = pLimitModule.default(MAX_CONCURRENT_SCRAPES);

    const promises = urls.map(urlInput => {
        let validatedUrlString;
        try {
            if (typeof urlInput !== 'string') {
                throw new Error('URL must be a string.');
            }
            const tempUrl = new URL(urlInput);
            if (!tempUrl.protocol.startsWith('http')) {
                throw new Error('URL must start with http or https');
            }
            validatedUrlString = tempUrl.href;
            return limit(() => resolveRedirect(validatedUrlString));
        } catch (e) {
            console.error(`[API /api/resolve-batch] Invalid URL in batch: "${urlInput}". Error: ${e.message}`);
            return Promise.resolve({ success: false, error: `Invalid URL format: ${urlInput} (${e.message})`, originalUrl: urlInput });
        }
    });

    const results = await Promise.allSettled(promises);
    const response = results.map(result => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            console.error(`[API /api/resolve-batch] Unexpected promise rejection: ${result.reason}`);
            let originalUrl = 'unknown';
            if (result.reason && typeof result.reason === 'object' && result.reason.originalUrl) {
                originalUrl = result.reason.originalUrl;
            }
            return {
                success: false,
                error: 'Unexpected error processing this URL during batch.',
                originalUrl: originalUrl,
                details: result.reason ? String(result.reason) : 'No details on rejection.'
            };
        }
    });

    console.log(`[API /api/resolve-batch] Batch processing complete. Total results: ${response.length}. Successes: ${response.filter(r => r.success).length}. Failures: ${response.filter(r => !r.success).length}`);
    res.json(response);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}. Max concurrent resolves: ${MAX_CONCURRENT_SCRAPES}`);
});
