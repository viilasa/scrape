import requests
from bs4 import BeautifulSoup
from readability import Document
from datetime import datetime
import json
import logging
import sys

class NewsScraper:
    def __init__(self, url):
        self.url = url
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }

    def scrape_article(self):
        try:
            response = requests.get(self.url, headers=self.headers, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')

            # Try readability-lxml first
            doc = Document(response.text)
            readable_title = doc.title()
            readable_html = doc.summary()
            readable_soup = BeautifulSoup(readable_html, 'html.parser')

            article = {
                'title': readable_title or self._extract_title(soup),
                'image_url': self._extract_image_url(soup),
                'content': readable_soup.get_text(separator=' ', strip=True) or self._extract_content(soup),
                'date': self._extract_date(soup),
                'source_url': self.url
            }

            return article

        except requests.RequestException as e:
            logging.error(f"Error fetching the URL: {e}")
            return None

    def _extract_title(self, soup):
        title_tags = ['h1', 'title']
        for tag in title_tags:
            el = soup.select_one(tag)
            if el:
                return el.get_text(strip=True)
        return "No title found"

    def _extract_image_url(self, soup):
        meta_img = soup.select_one('meta[property="og:image"]')
        if meta_img and meta_img.get('content'):
            return meta_img['content']
        first_img = soup.select_one('img')
        if first_img and first_img.get('src'):
            return requests.compat.urljoin(self.url, first_img['src'])
        return "No image found"

    def _extract_content(self, soup):
        for selector in ['article', 'div.article-body', 'div.entry-content', 'div.post-content', 'div#main-content']:
            el = soup.select_one(selector)
            if el:
                [tag.decompose() for tag in el(['script', 'style'])]
                return el.get_text(separator=' ', strip=True)
        return "No content found"

    def _extract_date(self, soup):
        date_tags = [
            'meta[property="article:published_time"]',
            'meta[name="date"]',
            'time[datetime]',
            'time'
        ]
        for selector in date_tags:
            el = soup.select_one(selector)
            if el:
                date_str = el.get('content') or el.get('datetime') or el.get_text(strip=True)
                try:
                    parsed = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    return parsed.isoformat()
                except Exception:
                    pass
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
