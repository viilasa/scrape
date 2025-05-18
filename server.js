const express = require('express');
const puppeteer = require('puppeteer');
const { URL } = require('url'); // For URL validation

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies for POST requests

const PORT = process.env.PORT || 3000;

// Concurrency limit for batch scraping. Using the default from your original code.
// Adjust based on your Render instance resources.
const MAX_CONCURRENT_SCRAPES = parseInt(process.env.MAX_CONCURRENT_SCRAPES || "100");

// Recommended Puppeteer launch arguments from your original code
const PUPPETEER_LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--single-process', // From your original code
    '--disable-features=site-per-process', // From your original code
];

async function scrapeArticle(scrapeUrl, { disableJavaScript = false } = {}) {
    let browser;
    console.log(`[${scrapeUrl}] Starting scrape. JS Disabled: ${disableJavaScript}`);
    const startTime = Date.now();

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: PUPPETEER_LAUNCH_ARGS,
        });
        const page = await browser.newPage();

        // Optional: Disable JavaScript if requested
        // if (disableJavaScript) {
        //     await page.setJavaScriptEnabled(false);
        //     console.log(`[${scrapeUrl}] JavaScript disabled.`);
        // }

        // Resource Blocking
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (request.isInterceptResolutionHandled()) return;

            const resourceType = request.resourceType();
            const requestUrl = request.url();

            const blockedResourceTypes = ['image', 'media', 'font', 'stylesheet'];
            const blockedDomains = [
                'googlesyndication.com', 'googleadservices.com', 'doubleclick.net', 'google-analytics.com',
                'connect.facebook.net', 'platform.twitter.com', 'https://www.youtube.com/watch?v=F3pWmvCdrx4', 'criteo.com', 'adsrvr.org',
                'scorecardresearch.com', 'adservice.google.com', 'pubmatic.com', 'rubiconproject.com',
                'outbrain.com', 'taboola.com', 'track.hubspot.com', '.hotjar.com', '.inspectlet.com',
            ];

            if (blockedResourceTypes.includes(resourceType) ||
                blockedDomains.some(domain => requestUrl.includes(domain))) {
                request.abort().catch(e => console.warn(`[${scrapeUrl}] Failed to abort request: ${e.message.substring(0,100)}`));
            } else {
                request.continue().catch(e => console.warn(`[${scrapeUrl}] Failed to continue request: ${e.message.substring(0,100)}`));
            }
        });

        console.log(`[${scrapeUrl}] Navigating (waitUntil: domcontentloaded)...`);
        await page.goto(scrapeUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000 // Original timeout
        });
        let currentUrl = page.url();
        console.log(`[${scrapeUrl}] Initial navigation complete. Current URL: ${currentUrl}`);

        // Handle potential Google News client-side redirect (if scrapeUrl was a Google News link)
        // Added check for /rss/articles/ as well
        if (currentUrl.includes('news.google.com/articles/') || currentUrl.includes('news.google.com/rss/articles/')) {
            try {
                console.log(`[${scrapeUrl}] Google News intermediate page detected. Waiting for redirect (waitUntil: 'load', timeout: 60000ms)...`);
                await page.waitForNavigation({
                    waitUntil: 'load', // MODIFIED: Changed from 'domcontentloaded' for better redirect handling
                    timeout: 60000    // MODIFIED: Increased timeout from 20000ms (original) to 30000ms
                });
                currentUrl = page.url(); // Get the URL after navigation has completed
                console.log(`[${scrapeUrl}] Google News redirect complete. New URL: ${currentUrl}`);
            } catch (e) {
                // Log more detailed error if redirect times out or fails
                console.warn(`[${scrapeUrl}] Warning/timeout on Google News redirect. Message: ${e.message}. Current URL remains: ${currentUrl}. Stack: ${e.stack}`);
                // The script will continue, and the check below will throw the specific error if still on a Google News URL.
            }
        }

        const finalUrl = currentUrl;
        console.log(`[${scrapeUrl}] Landed on article URL: ${finalUrl}. Extracting data...`);

        // Check if redirection failed and we're still on a Google News URL
        if (finalUrl.includes('google.com/rss/articles') || (finalUrl.includes('google.com/articles') && !scrapeUrl.startsWith(finalUrl))) {
            throw new Error('Failed to redirect from Google News to the actual article page.');
        }

        const articleData = await page.evaluate(() => {
            let data = { title: null, image: null, publishDate: null, content: null };
            // Title
            data.title = (() => {
                const ogTitle = document.querySelector('meta[property="og:title"]');
                if (ogTitle && ogTitle.content) return ogTitle.content.trim();
                const twitterTitle = document.querySelector('meta[name="twitter:title"]');
                if (twitterTitle && twitterTitle.content) return twitterTitle.content.trim();
                const docTitle = document.title;
                if (docTitle) return docTitle.trim();
                const h1 = document.querySelector('h1');
                if (h1) return h1.innerText.trim();
                return null;
            })();
            // Image
            data.image = (() => {
                const ogImage = document.querySelector('meta[property="og:image"]');
                if (ogImage && ogImage.content) return ogImage.content;
                const twitterImage = document.querySelector('meta[name="twitter:image"]');
                if (twitterImage && twitterImage.content) return twitterImage.content;
                const articleImg = document.querySelector('article img');
                if (articleImg && articleImg.src) return articleImg.src;
                return null;
            })();
            // Publish Date
            data.publishDate = (() => {
                const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
                if (jsonLdScript) {
                    try {
                        const jsonData = JSON.parse(jsonLdScript.innerText);
                        if (jsonData) {
                            if (jsonData.datePublished) return jsonData.datePublished;
                            if (jsonData.uploadDate) return jsonData.uploadDate;
                            if (Array.isArray(jsonData['@graph'])) {
                                const articleGraph = jsonData['@graph'].find(item => item['@type'] === 'Article' || item['@type'] === 'NewsArticle' || item['@type'] === 'WebPage');
                                if (articleGraph && articleGraph.datePublished) return articleGraph.datePublished;
                            }
                            if (jsonData.dateModified) return jsonData.dateModified; // Fallback to modified
                        }
                    } catch (e) {/* ignore JSON parse errors */}
                }
                const metaTime = document.querySelector('meta[property="article:published_time"]');
                if (metaTime && metaTime.content) return metaTime.content;
                const timeEl = document.querySelector('time[datetime]');
                if (timeEl && timeEl.getAttribute('datetime')) return timeEl.getAttribute('datetime');
                return null;
            })();
            // Content
            data.content = (() => {
                let contentElement;
                const selectors = [
                    'article .entry-content', 'article .post-content', 'article .td-post-content',
                    'article .story-content', 'article .article__content', 'article .content',
                    'div[class*="article-body"]', 'div[class*="ArticleBody"]', 'div[class*="article-content"]',
                    'div[itemprop="articleBody"]', 'article' // 'article' as a last resort
                ];
                for (let selector of selectors) {
                    contentElement = document.querySelector(selector);
                    if (contentElement) break;
                }
                if (contentElement) {
                    // Remove common unwanted elements before extracting text
                    contentElement.querySelectorAll('script, style, aside, .ads, .ad, [class*="related"], [id*="related"], figure figcaption, .caption, .meta, .author, .timestamp, .share, .social-share, .comments-area, #comments, noscript, iframe, form, button, input, .header, .footer, .nav, .sidebar, [aria-hidden="true"]').forEach(el => el.remove());
                    return contentElement.innerText.trim().replace(/\s\s+/g, ' '); // Normalize whitespace
                }
                return null;
            })();
            return data;
        });

        articleData.url = finalUrl;
        const duration = (Date.now() - startTime) / 1000;
        console.log(`[${scrapeUrl}] Successfully scraped in ${duration.toFixed(2)}s. Title: ${articleData.title ? articleData.title.substring(0, 50) + '...' : 'N/A'}`);
        return { success: true, data: articleData, originalUrl: scrapeUrl };

    } catch (error) {
        const duration = (Date.now() - startTime) / 1000;
        console.error(`[${scrapeUrl}] Error after ${duration.toFixed(2)}s: ${error.message}`);
        return { success: false, error: error.message, originalUrl: scrapeUrl, details: error.stack };
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log(`[${scrapeUrl}] Browser closed.`);
            } catch (closeError) {
                console.error(`[${scrapeUrl}] Error closing browser: ${closeError.message}`);
            }
        }
    }
}

// --- API Endpoints ---
app.get('/', (req, res) => {
    res.send(`Puppeteer scraping service is running. Use GET /api/scrape?url=<URL> for single or POST /api/scrape-batch for multiple URLs. Max concurrent for batch: ${MAX_CONCURRENT_SCRAPES}`);
});

// Single URL scraping endpoint (existing)
app.get('/api/scrape', async (req, res) => {
    const urlToScrape = req.query.url;
    // You might want to pass disableJavaScript option from query params too if needed
    // const options = { disableJavaScript: req.query.disableJavaScript === 'true' };

    if (!urlToScrape) return res.status(400).json({ error: 'URL query parameter is required.' });

    let validatedUrl;
    try {
        validatedUrl = new URL(urlToScrape);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format provided.' });
    }

    console.log(`[API /api/scrape] Received single URL: ${validatedUrl.href}`);
    const result = await scrapeArticle(validatedUrl.href); // Pass options here if you add them

    if (!result.success) {
        return res.status(500).json({
            message: "Failed to scrape the article.",
            error: result.error,
            originalUrl: result.originalUrl,
            details: result.details // Ensure details (stack trace) are passed back
        });
    }
    res.json(result.data);
});

// Batch URL scraping endpoint (NEW)
app.post('/api/scrape-batch', async (req, res) => {
    const urls = req.body.urls;
    const options = req.body.options || {}; // e.g., { disableJavaScript: true }

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'An array of "urls" is required in the request body.' });
    }
    if (urls.length > 200) { // Safety limit for a single batch request
        return res.status(400).json({ error: `Too many URLs. Max 200 per batch, got ${urls.length}.` });
    }

    console.log(`[API /api/scrape-batch] Received ${urls.length} URLs. Max concurrency: ${MAX_CONCURRENT_SCRAPES}. Options: ${JSON.stringify(options)}`);

    const pLimitModule = await import('p-limit'); // Dynamic import for p-limit
    const limit = pLimitModule.default(MAX_CONCURRENT_SCRAPES);

    const promises = urls.map(url => {
        let validatedUrl;
        try {
            if (typeof url !== 'string') { // Basic check that URL is a string
                throw new Error('URL must be a string.');
            }
            validatedUrl = new URL(url); // Validate URL format
            if (!validatedUrl.protocol.startsWith('http')) { // Ensure http or https
                 throw new Error('URL must start with http or https');
            }
            return limit(() => scrapeArticle(validatedUrl.href, options));
        } catch (e) {
            console.error(`[API /api/scrape-batch] Invalid URL in batch: "${url}". Error: ${e.message}`);
            // Return a promise that resolves to an error object, consistent with scrapeArticle's resolved errors
            return Promise.resolve({ success: false, error: `Invalid URL format: ${url} (${e.message})`, originalUrl: url });
        }
    });

    const results = await Promise.allSettled(promises);

    // Process results:
    const response = results.map(result => {
        if (result.status === 'fulfilled') {
            return result.value; // This is the { success: true/false, data/error, originalUrl, details? } object
        } else {
            // This case should ideally be minimized by how promises are constructed above,
            // ensuring scrapeArticle and invalid URL handling both resolve.
            console.error(`[API /api/scrape-batch] Unexpected promise rejection: ${result.reason}`);
            let originalUrl = 'unknown';
            // Attempt to extract originalUrl if the rejection reason is an error object with it
            if (result.reason && result.reason.originalUrl) {
                originalUrl = result.reason.originalUrl;
            }
            return {
                success: false,
                error: 'Unexpected error processing this URL during batch.',
                originalUrl: originalUrl, // Try to preserve original URL
                details: result.reason ? result.reason.toString() : 'No details on rejection.'
            };
        }
    });

    console.log(`[API /api/scrape-batch] Batch processing complete. Total results: ${response.length}. Successes: ${response.filter(r => r.success).length}. Failures: ${response.filter(r => !r.success).length}`);
    res.json(response);
});


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}. Max concurrent scrapes: ${MAX_CONCURRENT_SCRAPES}`);
});
