import requests
from bs4 import BeautifulSoup
from datetime import datetime
import json
import logging
import requests
import sys

class NewsScraper:
    def __init__(self, url):
        """
        Initialize the NewsScraper with a given URL
        
        Args:
            url (str): The URL of the news article to scrape
        """
        self.url = url
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
    def scrape_article(self):
        """
        Scrape the article details
        
        Returns:
            dict: A dictionary containing article details
        """
        try:
            # Send a GET request to the URL
            response = requests.get(self.url, headers=self.headers)
            response.raise_for_status()  # Raise an error for bad status codes
            
            # Parse the HTML content
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Extract title
            title = self._extract_title(soup)
            
            # Extract image URL
            image_url = self._extract_image_url(soup)
            
            # Extract content
            content = self._extract_content(soup)
            
            # Extract date
            date = self._extract_date(soup)
            
            # Create article dictionary
            article = {
                'title': title,
                'image_url': image_url,
                'content': content,
                'date': date,
                'source_url': self.url
            }
            
            return article
        
        except requests.RequestException as e:
            logging.error(f"Error fetching the URL: {e}")
            return None
        
    def _extract_title(self, soup):
        """
        Extract the title of the article
        
        Args:
            soup (BeautifulSoup): Parsed HTML content
        
        Returns:
            str: Article title
        """
        # Add multiple potential selectors for title
        title_selectors = [
            'h1.article-title',  # Example selector
            'h1.post-title',
            'h1#main-title',
            'title',
            'h1'
        ]
        
        for selector in title_selectors:
            title_elem = soup.select_one(selector)
            if title_elem:
                return title_elem.get_text(strip=True)
        
        return "No title found"
    
    def _extract_image_url(self, soup):
        """
        Extract the main image URL of the article
        
        Args:
            soup (BeautifulSoup): Parsed HTML content
        
        Returns:
            str: Image URL
        """
        # Add multiple potential selectors for image
        image_selectors = [
            'meta[property="og:image"]',
            'img.article-image',
            'figure img',
            'img.featured-image',
            'img'
        ]
        
        for selector in image_selectors:
            image_elem = soup.select_one(selector)
            if image_elem:
                # Try different attributes for image URL
                image_url = (
                    image_elem.get('src') or 
                    image_elem.get('data-src') or 
                    image_elem.get('content')
                )
                
                # Check if the URL is relative and convert to absolute
                if image_url and not image_url.startswith(('http://', 'https://')):
                    image_url = requests.compat.urljoin(self.url, image_url)
                
                return image_url
        
        return "No image found"
    
    def _extract_content(self, soup):
        """
        Extract the main content of the article
        
        Args:
            soup (BeautifulSoup): Parsed HTML content
        
        Returns:
            str: Article content
        """
        # Add multiple potential selectors for content
        content_selectors = [
            'div.article-body',
            'div.entry-content',
            'article',
            'div.post-content',
            'div#main-content'
        ]
        
        for selector in content_selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                # Remove script, style, and other unwanted tags
                for script in content_elem(["script", "style"]):
                    script.decompose()
                
                return content_elem.get_text(separator=' ', strip=True)
        
        return "No content found"
    
    def _extract_date(self, soup):
        """
        Extract the publication date of the article
        
        Args:
            soup (BeautifulSoup): Parsed HTML content
        
        Returns:
            str: Publication date
        """
        # Add multiple potential selectors for date
        date_selectors = [
            'meta[property="article:published_time"]',
            'time.published-date',
            'span.post-date',
            'meta[name="date"]'
        ]
        
        for selector in date_selectors:
            date_elem = soup.select_one(selector)
            if date_elem:
                date_str = (
                    date_elem.get('content') or 
                    date_elem.get('datetime') or 
                    date_elem.get_text(strip=True)
                )
                
                try:
                    # Try parsing the date string
                    parsed_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    return parsed_date.isoformat()
                except (ValueError, TypeError):
                    pass
        
        # If no date found, return current date
        return datetime.now().isoformat()

def save_article(article, filename=None):
    """
    Save the scraped article to a JSON file
    
    Args:
        article (dict): Scraped article details
        filename (str, optional): Output filename
    
    Returns:
        str: Path of the saved file
    """
    if not article:
        logging.error("No article to save")
        return None
    
    if not filename:
        filename = f"article_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(article, f, ensure_ascii=False, indent=4)
    
    print(f"Article saved to {filename}")
    return filename

# Example usage
def main():
    # Configure logging
    logging.basicConfig(level=logging.INFO, 
                        format='%(asctime)s - %(levelname)s - %(message)s')
    
    # Example news article URL (replace with the actual URL you want to scrape)
    if len(sys.argv) < 2:
        logging.error("Usage: python scraper.py <url>")
        sys.exit(1)

    url = sys.argv[1]
    
    # Create scraper instance
    scraper = NewsScraper(url)
    
    # Scrape the article
    article = scraper.scrape_article()
    
    # Save the article
    if article:
        save_article(article)

if __name__ == "__main__":
    main()