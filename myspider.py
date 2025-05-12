import argparse
from news_scraper import NewsScraper, save_article

def deploy_scraper():
    """
    Deploy the news article scraper with command-line argument support
    """
    # Set up argument parser
    parser = argparse.ArgumentParser(description='News Article Web Scraper')
    parser.add_argument('url', type=str, help='URL of the news article to scrape')
    parser.add_argument('--output', type=str, 
                        help='Optional output filename for the scraped article')
    
    # Parse arguments
    args = parser.parse_args()
    
    try:
        # Create scraper instance
        scraper = NewsScraper(args.url)
        
        # Scrape the article
        article = scraper.scrape_article()
        
        # Save the article
        if article:
            save_article(article, args.output)
            print(f"Successfully scraped article from {args.url}")
        else:
            print("Failed to scrape the article.")
    
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    deploy_scraper()

# Requirements file (requirements.txt)
"""
requests==2.31.0
beautifulsoup4==4.12.3
"""

# Command-line usage examples:
# python scraper_deployment.py "https://example.com/news-article"
# python scraper_deployment.py "https://example.com/news-article" --output custom_filename.json