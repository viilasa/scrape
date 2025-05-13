const express = require('express');
const puppeteer = require('puppeteer');
const { URL } = require('url'); // Already in your original script

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies (if you were to use POST requests, not needed for GET with query params)
// app.use(express.json());

// Puppeteer launch arguments for Render/Linux environments
const PUPPETEER_LAUNCH_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', // Essential for running in limited-resource environments like Docker/Render
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    // '--single-process', // Disables site isolation, can reduce memory but use with caution
    '--disable-gpu'
];

async function scrapeArticle(googleNewsUrl) {
    let browser;
    console.log(`Scraping process started for URL: ${googleNewsUrl}`);
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: PUPPETEER_LAUNCH_ARGS,
            // executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // Only if you provide your own Chrome
        });
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        console.log(`Navigating to initial Google News redirect URL: ${googleNewsUrl}`);
        await page.goto(googleNewsUrl, {
            waitUntil: 'load',
            timeout: 60000
        });
        console.log(`Initial navigation complete. Current URL: ${page.url()}`);

        try {
            console.log('Waiting for potential client-side redirect to the final article page...');
            await page.waitForNavigation({
                waitUntil: 'networkidle2',
                timeout: 60000
            });
            console.log('Client-side redirect to final article page complete.');
        } catch (e) {
            console.warn(`Warning or timeout during waitForNavigation: ${e.message}. Current URL: ${page.url()}`);
        }

        const finalUrl = page.url();
        console.log(`Landed on actual article URL: ${finalUrl}`);

        if (finalUrl.includes('google.com') || finalUrl.includes('googleusercontent.com')) {
            console.error(`Failed to redirect to the final article. Still on a Google URL: ${finalUrl}`);
            await browser.close(); // Ensure browser is closed
            return {
                error: 'Failed to redirect from Google News to the actual article page.',
                url: googleNewsUrl,
                finalUrlAttempted: finalUrl
            };
        }

        let articleData = {};

        // --- Data Extraction Logic (Title, Image, Publish Date, Content) ---
        // This is the same extraction logic from your previous working script
        // For brevity, I'll summarize, but you should paste your full evaluate calls here.

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
        articleData.image = await page.evaluate(() => {
            const ogImage = document.querySelector('meta[property="og:image"]');
            if (ogImage && ogImage.content) return ogImage.content;
            const twitterImage = document.querySelector('meta[name="twitter:image"]');
            if (twitterImage && twitterImage.content) return twitterImage.content;
            const articleElement = document.querySelector('article img');
            if (articleElement && articleElement.src) return articleElement.src;
            return null;
        });

        // 3. Publish Date
        articleData.publishDate = await page.evaluate(() => {
            const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
            if (jsonLdScript) {
                try {
                    const jsonData = JSON.parse(jsonLdScript.innerText);
                    if (jsonData && jsonData.datePublished) return jsonData.datePublished;
                    if (jsonData && jsonData.uploadDate) return jsonData.uploadDate;
                    if (jsonData && Array.isArray(jsonData['@graph'])) {
                        const articleGraph = jsonData['@graph'].find(item => item['@type'] === 'Article' || item['@type'] === 'NewsArticle' || item['@type'] === 'WebPage');
                        if (articleGraph && articleGraph.datePublished) return articleGraph.datePublished;
                    }
                    if (jsonData && jsonData.dateModified) return jsonData.dateModified;
                } catch (e) { /* ignore */ }
            }
            const metaPublishedTime = document.querySelector('meta[property="article:published_time"]');
            if (metaPublishedTime && metaPublishedTime.content) return metaPublishedTime.content;
            const timeElement = document.querySelector('time[datetime]');
            if (timeElement && timeElement.getAttribute('datetime')) return timeElement.getAttribute('datetime');
            return null;
        });

        // 4. Content
        articleData.content = await page.evaluate(() => {
            let contentElement;
            const selectors = [
                'article .entry-content', 'article .post-content', 'article .td-post-content',
                'article .story-content', 'article .article__content', 'article .content',
                'div[class*="article-body"]', 'div[class*="ArticleBody"]', 'div[class*="article-content"]',
                'div[itemprop="articleBody"]', 'article'
            ];
            for (let selector of selectors) {
                contentElement = document.querySelector(selector);
                if (contentElement) break;
            }
            if (contentElement) {
                contentElement.querySelectorAll('script, style, aside, .ads, .ad, [class*="related"], [id*="related"], figure figcaption, .caption, .meta, .author, .timestamp, .share').forEach(el => el.remove());
                return contentElement.innerText.trim().replace(/\s\s+/g, ' ');
            }
            return null;
        });
        // --- End of Data Extraction Logic ---


        articleData.url = finalUrl;
        console.log(`Successfully scraped data for: ${finalUrl}`);
        return articleData;

    } catch (error) {
        console.error(`Error during scraping process for ${googleNewsUrl}:`, error);
        // Return an error object that includes the original URL
        return { error: error.message, url: googleNewsUrl, details: error.stack };
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

// Define a simple root route to check if the server is up
app.get('/', (req, res) => {
    res.send('Puppeteer scraping service is running. Use /api/scrape?url=<URL_TO_SCRAPE> to scrape an article.');
});

// Define the /api/scrape endpoint
app.get('/api/scrape', async (req, res) => {
    const urlToScrape = req.query.url;

    if (!urlToScrape) {
        return res.status(400).json({ error: 'URL query parameter is required.' });
    }

    try {
        // Validate the URL (basic validation)
        new URL(urlToScrape); // This will throw an error if the URL is invalid
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format provided.' });
    }

    console.log(`Received request to scrape URL: ${urlToScrape}`);
    const scrapedData = await scrapeArticle(urlToScrape);

    if (scrapedData.error) {
        // If scrapeArticle returned an error object (including our custom redirect error)
        console.error(`Scraping failed for ${urlToScrape}: ${scrapedData.error}`);
        // It's good practice to not expose detailed error stacks to the client for security reasons
        // but for your own debugging on Render, the server logs will have them.
        return res.status(500).json({
            message: "Failed to scrape the article.",
            error: scrapedData.error, // Keep this relatively generic for the client
            originalUrl: scrapedData.url,
            finalUrlAttempted: scrapedData.finalUrlAttempted
        });
    }

    res.json(scrapedData);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
