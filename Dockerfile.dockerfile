# Use an official Node.js LTS version.
# Using a -slim variant to keep image size down, but we'll add system dependencies.
FROM node:18-slim

# Set working directory
WORKDIR /usr/src/app

# Install system dependencies required by Puppeteer's bundled Chromium
# These are for Debian-based systems like node:18-slim
RUN apt-get update \
    && apt-get install -y \
    # Dependencies for Chromium
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxtst6 \
    ca-certificates \
    fonts-liberation \
    lsb-release \
    xdg-utils \
    # wget is not strictly needed by puppeteer's bundled chrome but useful for diagnostics
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (or yarn.lock if you use yarn)
COPY package*.json ./

# IMPORTANT: For this Docker setup, remove certain Puppeteer-related
# environment variables from your Render service settings if they are set:
# - PUPPETEER_EXECUTABLE_PATH (let Puppeteer find its bundled version within node_modules)
# - PUPPETEER_CACHE_DIR (not needed as it will use node_modules/.local-chromium)
# - Ensure PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is NOT 'true'

# Install project dependencies. This will trigger Puppeteer's Chromium download
# into node_modules/puppeteer/.local-chromium/ within this Docker image.
RUN npm install --production

# Copy the rest of your application code
COPY . .

# Expose the port your app runs on (Render will set PORT env var)
# Your server.js uses process.env.PORT || 3000, so this is just informational.
EXPOSE 3000

# Command to run your application
# Your server.js should already include --no-sandbox in puppeteer.launch() args
CMD [ "node", "server.js" ]