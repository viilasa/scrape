from flask import Flask, request, jsonify
from scraper import NewsScraper

app = Flask(__name__)

@app.route('/scrape', methods=['POST'])
def scrape():
    data = request.json
    url = data.get("link")
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    scraper = NewsScraper(url)
    article = scraper.scrape_article()
    return jsonify(article or {"error": "Failed to scrape"}), 200

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000)
