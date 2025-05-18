const express = require('express');
const puppeteer = require('puppeteer');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json()); // Important for handling POST requests with JSON payload

// Puppeteer launch arguments for Render/Linux environments
const PUPPETEER_LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    // '--single-process', // Disables site isolation, can reduce memory but use with caution
    '--disable-gpu'
];

// --- Your existing scrapeArticle function (remains largely the same) ---
async function scrapeArticle(googleNewsUrl) {
    let browser;
    console.log(`Scraping process started for URL: ${googleNewsUrl}`);
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: PUPPETEER_LAUNCH_ARGS,
            // executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        });
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        console.log(`Navigating to initial Google News redirect URL: ${googleNewsUrl}`);
        await page.goto(googleNewsUrl, {
            waitUntil: 'load', // Start with 'load' for the initial redirect page
            timeout: 60000
        });
        console.log(`Initial navigation complete. Current URL after page.goto: ${page.url()}`);

        // Google News often has a client-side redirect or a link that needs clicking.
        // The first page.goto might land on a Google page. We need to ensure we get to the *actual* article.
        // Sometimes, waitForNavigation is enough if there's an immediate client-side redirect.
        // Other times, Google might show an interstitial.
        let finalUrl = page.url();

        // If still on a Google domain after the first goto, try to wait for a further navigation
        // that might be triggered by client-side JavaScript.
        if (finalUrl.includes('google.com/url') || finalUrl.includes('news.google.com/rss/articles') || finalUrl.includes('google.com/search')) {
            console.log(`Still on a Google URL: ${finalUrl}. Attempting to wait for further navigation to actual article.`);
            try {
                // Increased timeout for this crucial step.
                // 'networkidle0' can be more reliable for final page load if resources are heavy.
                await page.waitForNavigation({
                    waitUntil: 'networkidle2', // Wait for network to be relatively idle
                    timeout: 75000 // Longer timeout for the redirect to complete
                });
                finalUrl = page.url(); // Update finalUrl after navigation
                console.log('Further navigation detected. New URL:', finalUrl);
            } catch (e) {
                console.warn(`Timeout or error during waitForNavigation for ${googleNewsUrl}: ${e.message}. Current URL: ${page.url()}. Will attempt to scrape current page.`);
                finalUrl = page.url(); // Use the current URL if waitForNavigation fails
            }
        }


        // Check if we successfully navigated away from Google
        if (finalUrl.includes('google.com') || finalUrl.includes('googleusercontent.com')) {
            // Sometimes, Google News links might point to an AMP page hosted on googleusercontent.com
            // which IS the article content, or it could be a consent page.
            // A more robust check might be needed here depending on what you consider "still on Google".
            // For now, we'll proceed if it's not a generic google.com search/redirector.
            // However, if it's clearly not an article page, flag it.
            if (finalUrl.startsWith('https://news.google.com/') && !finalUrl.includes('/articles/')) { // Example, might need refinement
                 console.error(`Failed to redirect to the final article. Still on a generic Google URL: ${finalUrl}`);
                 await browser.close();
                 return {
                     error: 'Failed to redirect from Google News to the actual article page.',
                     originalUrl: googleNewsUrl,
                     finalUrlAttempted: finalUrl
                 };
            }
            console.warn(`Potentially still on a Google-related URL: ${finalUrl}. Proceeding with scraping attempt.`);
        } else {
            console.log(`Landed on actual article URL: ${finalUrl}`);
        }


        let articleData = {};

        // 1. Title
        articleData.title = await page.evaluate(() => {
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle && ogTitle.content) return ogTitle.content.trim();
            const twitterTitle = document.querySelector('meta[name="twitter:title"]');
            if (twitterTitle && twitterTitle.content) return twitterTitle.content.trim();
            const docTitle = document.title;
            if (docTitle) return docTitle.trim();
            const h1 = document.querySelector('h1');
            if (h1) return h1.innerText.trim();
            return null;
        });

        // 2. Image
        articleData.image = await page.evaluate((pageUrl) => {
            let imageUrl = null;
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage && ogImage.content) imageUrl = ogImage.content;
            
            if (!imageUrl) {
                const twitterImage = document.querySelector('meta[name="twitter:image"]');
                if (twitterImage && twitterImage.content) imageUrl = twitterImage.content;
            }
            if (!imageUrl) {
                const articleElement = document.querySelector('article img');
                if (articleElement && articleElement.src) imageUrl = articleElement.src;
            }
             // Resolve relative URL to absolute
            if (imageUrl && !imageUrl.startsWith('http')) {
                try {
                    imageUrl = new URL(imageUrl, pageUrl).href;
                } catch (e) {
                    // console.warn('Invalid base URL for relative image path:', pageUrl, imageUrl);
                    return null; // Or handle as an invalid image URL
                }
            }
            return imageUrl;
        }, finalUrl); // Pass finalUrl to resolve relative image URLs

        // 3. Publish Date
        articleData.publishDate = await page.evaluate(() => {
            const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
            if (jsonLdScript) {
                try {
                    const jsonData = JSON.parse(jsonLdScript.innerText);
                    if (jsonData && jsonData.datePublished) return jsonData.datePublished;
                    if (jsonData && jsonData.uploadDate) return jsonData.uploadDate; // Common in VideoObject
                    if (jsonData && Array.isArray(jsonData['@graph'])) {
                        const articleGraph = jsonData['@graph'].find(item => ['Article', 'NewsArticle', 'WebPage', 'BlogPosting'].includes(item['@type']));
                        if (articleGraph && articleGraph.datePublished) return articleGraph.datePublished;
                        if (articleGraph && articleGraph.dateModified) return articleGraph.dateModified; // Fallback to modified
                    }
                    if (jsonData && jsonData.dateModified) return jsonData.dateModified; // General fallback
                } catch (e) { /* ignore parsing errors */ }
            }
            const metaPublishedTime = document.querySelector('meta[property="article:published_time"]');
            if (metaPublishedTime && metaPublishedTime.content) return metaPublishedTime.content;
            
            const metaDate = document.querySelector('meta[name="date"]'); // Some sites use this
            if (metaDate && metaDate.content) return metaDate.content;

            const timeElement = document.querySelector('time[datetime]');
            if (timeElement && timeElement.getAttribute('datetime')) return timeElement.getAttribute('datetime');
            
            // Less reliable, try to find text patterns (use with caution)
            // const bodyText = document.body.innerText;
            // const dateRegex = /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2},\s\d{4}\b)/i;
            // const match = bodyText.match(dateRegex);
            // if (match) return match[0];

            return null;
        });

        // 4. Content
        articleData.content = await page.evaluate(() => {
            let contentElement;
            const selectors = [
                'article .entry-content', 'article .post-content', 'article .td-post-content',
                'article .story-content', 'article .article__content', 'article .content',
                'div[class*="article-body"]', 'div[class*="ArticleBody"]', 'div[class*="article-content"]',
                'div[itemprop="articleBody"]', 'div.main-content', 'div.articletext', // Added more generic ones
                'section[class*="article-content"]', 'div[class*="wysiwyg"]', // Common in CMS
                'article' // Last resort
            ];
            for (let selector of selectors) {
                contentElement = document.querySelector(selector);
                if (contentElement) break;
            }
            if (contentElement) {
                // Remove common non-content elements more aggressively
                contentElement.querySelectorAll('script, style, aside, .ads, .ad, [class*="related"], [id*="related"], figure figcaption, .caption, .meta, .author, .timestamp, .share, .comments, #comments, .sidebar, .footer, .header, nav, form, button, input, .social-share, [role="navigation"], [role="banner"], [role="complementary"], [role="contentinfo"], noscript').forEach(el => el.remove());
                
                // Get paragraphs, join them, and clean up
                let texts = [];
                contentElement.querySelectorAll('p, h1, h2, h3, h4, li').forEach(el => {
                    const text = el.innerText?.trim();
                    if (text && text.length > 20) { // Only include meaningful text blocks
                         // Avoid including text that looks like navigation or boilerplate
                        if (!['advertisement', 'related posts', 'share this article', 'comments', 'leave a reply'].some(phrase => text.toLowerCase().includes(phrase))) {
                            texts.push(text);
                        }
                    }
                });
                let combinedText = texts.join('\n\n'); // Join paragraphs with double newlines
                if (combinedText.length < 100 && contentElement.innerText) { // Fallback if P selection fails
                    combinedText = contentElement.innerText.trim();
                }

                return combinedText.replace(/\s\s+/g, ' ').replace(/\n\s*\n/g, '\n\n'); // Clean multiple spaces and excessive newlines
            }
            return null;
        });

        if (!articleData.title && !articleData.content) {
            console.warn(`No title or content extracted from ${finalUrl}. The page might be structured differently or inaccessible.`);
            // Optionally, take a screenshot for debugging
            // await page.screenshot({ path: `debug_screenshot_${Date.now()}.png` });
            return {
                error: 'Could not extract meaningful content (title or body) from the page.',
                originalUrl: googleNewsUrl,
                finalUrlAttempted: finalUrl
            };
        }

        articleData.url = finalUrl;
        articleData.originalUrl = googleNewsUrl;
        console.log(`Successfully scraped data for: ${finalUrl} (from ${googleNewsUrl})`);
        return articleData;

    } catch (error) {
        console.error(`Error during scraping process for ${googleNewsUrl}:`, error);
        return { error: error.message, url: googleNewsUrl, details: error.stack, finalUrlAttempted: page ? page.url() : 'N/A' };
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log(`Browser closed for ${googleNewsUrl}`);
            } catch (closeError) {
                console.error(`Error closing browser for ${googleNewsUrl}:`, closeError);
            }
        }
    }
}

// --- Root Route ---
app.get('/', (req, res) => {
    res.send('Puppeteer scraping service is running. Use /api/scrape?url=<URL> for single or POST to /api/scrape-multiple with {"urls": [...]} for multiple articles.');
});

// --- Single URL Scrape Endpoint (existing) ---
app.get('/api/scrape', async (req, res) => {
    const urlToScrape = req.query.url;

    if (!urlToScrape) {
        return res.status(400).json({ error: 'URL query parameter is required.' });
    }

    try {
        new URL(urlToScrape);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format provided.' });
    }

    console.log(`Received single scrape request for URL: ${urlToScrape}`);
    const scrapedData = await scrapeArticle(urlToScrape);

    if (scrapedData.error) {
        console.error(`Scraping failed for ${urlToScrape}: ${scrapedData.error}`);
        return res.status(500).json({
            message: "Failed to scrape the article.",
            errorDetails: scrapedData.error, // Send the error message
            originalUrl: scrapedData.url,
            finalUrlAttempted: scrapedData.finalUrlAttempted
        });
    }
    res.json(scrapedData);
});

// --- New Multiple URLs Scrape Endpoint ---
app.post('/api/scrape-multiple', async (req, res) => {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'An array of "urls" is required in the request body.' });
    }
    if (urls.length > 100) { // Optional: Set a limit
        return res.status(400).json({ error: `Too many URLs provided. Maximum is 100, you sent ${urls.length}.` });
    }

    const validatedUrls = [];
    for (const u of urls) {
        try {
            new URL(u); // Validate each URL
            validatedUrls.push(u);
        } catch (e) {
            console.warn(`Invalid URL in batch: ${u}`);
            // Optionally add an error object for this specific URL in the results
            // instead of failing the whole batch immediately.
            // For now, we'll just skip invalid ones or let it be handled by scrapeArticle.
        }
    }
    if (validatedUrls.length === 0) {
         return res.status(400).json({ error: 'No valid URLs found in the provided list.' });
    }


    console.log(`Received request to scrape ${validatedUrls.length} URLs.`);

    // Using Promise.allSettled to ensure all scraping attempts complete
    // This is better than Promise.all if you want results for all URLs, even if some fail.
    const results = await Promise.allSettled(validatedUrls.map(url => scrapeArticle(url)));

    const responseData = results.map((result, index) => {
        if (result.status === 'fulfilled') {
            return result.value; // This is the object returned by scrapeArticle (data or error object)
        } else {
            // This handles unexpected errors in scrapeArticle or the Promise machinery itself
            console.error(`Unexpected error scraping ${validatedUrls[index]}:`, result.reason);
            return {
                error: 'An unexpected error occurred during scraping this URL.',
                details: result.reason.message || result.reason,
                url: validatedUrls[index]
            };
        }
    });

    res.json(responseData);
});

// --- Concurrency Limited Multiple URLs Scrape Endpoint (Alternative) ---
// This is a more robust way if you have many URLs or limited resources.
// You'd need to install p-limit: npm install p-limit
/*
const pLimit = require('p-limit');

app.post('/api/scrape-multiple-limited', async (req, res) => {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'An array of "urls" is required in the request body.' });
    }
    if (urls.length > 200) { // Example limit
        return res.status(400).json({ error: `Too many URLs provided. Maximum is 200, you sent ${urls.length}.` });
    }

    console.log(`Received request to scrape ${urls.length} URLs with concurrency limit.`);

    const limit = pLimit(5); // Set concurrency limit (e.g., 5 Puppeteer instances at a time)
    const scrapingPromises = urls.map(url => {
        try {
            new URL(url); // Basic validation
            return limit(() => scrapeArticle(url));
        } catch (e) {
            console.warn(`Invalid URL in batch: ${url} - skipping.`);
            return Promise.resolve({ error: 'Invalid URL format provided.', url });
        }
    });

    const results = await Promise.allSettled(scrapingPromises);

    const responseData = results.map((result, index) => {
        const originalUrl = urls[index]; // Ensure original URL is tied correctly
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            console.error(`Unexpected error scraping ${originalUrl}:`, result.reason);
            return {
                error: 'An unexpected error occurred during scraping this URL.',
                details: result.reason.message || result.reason,
                url: originalUrl
            };
        }
    });
    res.json(responseData);
});
*/


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Endpoints:');
    console.log(`  GET  /api/scrape?url=<URL_TO_SCRAPE>`);
    console.log(`  POST /api/scrape-multiple (Body: {"urls": ["url1", "url2", ...]})`);
    // console.log(`  POST /api/scrape-multiple-limited (Body: {"urls": ["url1", "url2", ...]})`);
});
