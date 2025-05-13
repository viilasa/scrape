# Use an official Node.js LTS version.
# Using a -slim variant to keep image size down, but we'll add system dependencies.
FROM node:18-slim

# Set working directory
WORKDIR /usr/src/app

# Install system dependencies required by Puppeteer's bundled Chromium
# This list is fairly comprehensive for headless Chrome on Debian-based systems.
RUN apt-get update \
    && apt-get install -y \
    # Core GUI/graphics libraries often needed even for headless
    gconf-service \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \       
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \        
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    # Other useful packages
    ca-certificates \
    fonts-liberation \
    libappindicator1 \
    lsb-release \
    xdg-utils \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (or yarn.lock if you use yarn)
COPY package*.json ./

# IMPORTANT for Docker deployment with this Dockerfile:
# 1. In Render Environment Variables:
#    - DELETE/UNSET `PUPPETEER_EXECUTABLE_PATH`
#    - DELETE/UNSET `PUPPETEER_CACHE_DIR`
#    - Ensure `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` is NOT set to `true` (it should be `false` or unset)
# 2. In package.json, it's best to REMOVE the `postinstall` script that runs `npx puppeteer browsers install chrome`
#    as Puppeteer's own install script (triggered by `npm install`) will download the correct browser
#    version into node_modules within this Docker image.

# Install project dependencies. This will trigger Puppeteer's Chromium download
# into node_modules/puppeteer/.local-chromium/ within this Docker image.
RUN npm install --production

# Copy the rest of your application code
COPY . .

# Expose the port your app runs on (Render will set the PORT env var automatically)
# Your server.js uses process.env.PORT || 3000, so this is mainly informational.
EXPOSE 3000

# Command to run your application
# Your server.js already includes necessary launch args like --no-sandbox
CMD [ "node", "server.js" ]
