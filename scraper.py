import requests
from bs4 import BeautifulSoup
from datetime import datetime
import json
import logging
import sys

class NewsScraper:
    def __init__(self, url):
        """
        Initialize the NewsScraper with a given URL
        """
        self.original_url = url
        self.url = self._resolve_google_redirect_if_needed(url)
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }

    def _is_google_rss_url(self, url):
        return "news.google.com/rss/articles/" in url or "news.google.com/articles/" in url

    def _resolve_google_redirect_if_needed(self, url):
        if self._is_google_rss_url(url):
            try:
                response = requests.get(url, headers={'User-Agent': self.headers['User-Agent']}, allow_redirects=True, timeout=10)
                logging.info(f"Resolved Google News RSS URL to: {response.url}")
                return response.url
            except Exception as e:
                logging.warning(f"Failed to resolve Google redirect: {e}")
                return url
        return url

    def scrape_article(self):
        """
        Scrape the article details
        """
        try:
            response = requests.get(self.url, headers=self.headers)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')

            title = self._extract_title(soup)
            image_url = self._extract_image_url(soup)
            content = self._extract_content(soup)
            date = self._extract_date(soup)

            return {
                'title': title,
                'image_url': image_url,
                'content': content,
                'date': date,
                'source_url': self.url,
                'original_url': self.original_url
            }

        except requests.RequestException as e:
            logging.error(f"Error fetching the URL: {e}")
            return None

    def _extract_title(self, soup):
        title_selectors = ['h1.article-title', 'h1.post-title', 'h1#main-title', 'title', 'h1']
        for selector in title_selectors:
            title_elem = soup.select_one(selector)
            if title_elem:
                return title_elem.get_text(strip=True)
        return "No title found"

    def _extract_image_url(self, soup):
        image_selectors = ['meta[property="og:image"]', 'img.article-image', 'figure img', 'img.featured-image', 'img']
        for selector in image_selectors:
            image_elem = soup.select_one(selector)
            if image_elem:
                image_url = image_elem.get('src') or image_elem.get('data-src') or image_elem.get('content')
                if image_url and not image_url.startswith(('http://', 'https://')):
                    image_url = requests.compat.urljoin(self.url, image_url)
                return image_url
        return "No image found"

    def _extract_content(self, soup):
        content_selectors = ['div.article-body', 'div.entry-content', 'article', 'div.post-content', 'div#main-content']
        for selector in content_selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                for tag in content_elem(["script", "style"]):
                    tag.decompose()
                return content_elem.get_text(separator=' ', strip=True)
        return "No content found"

    def _extract_date(self, soup):
        date_selectors = ['meta[property="article:published_time"]', 'time.published-date', 'span.post-date', 'meta[name="date"]']
        for selector in date_selectors:
            date_elem = soup.select_one(selector)
            if date_elem:
                date_str = date_elem.get('content') or date_elem.get('datetime') or date_elem.get_text(strip=True)
                try:
                    parsed_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    return parsed_date.isoformat()
                except (ValueError, TypeError):
                    continue
        return datetime.now().isoformat()

def save_article(article, filename=None):
    if not article:
        logging.error("No article to save")
        return None
    if not filename:
        filename = f"article_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(article, f, ensure_ascii=False, indent=4)
    print(f"Article saved to {filename}")
    return filename

def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    if len(sys.argv) < 2:
        logging.error("Usage: python scraper.py <url>")
        sys.exit(1)
    url = sys.argv[1]
    scraper = NewsScraper(url)
    article = scraper.scrape_article()
    if article:
        save_article(article)

if __name__ == "__main__":
    main()
