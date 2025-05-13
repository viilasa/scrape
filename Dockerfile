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
    gconf-service \
    libasound2 \       
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
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
    ca-certificates \
    fonts-liberation \
    libappindicator1 \
    libnss3 \
    lsb-release \
    xdg-utils \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (or yarn.lock if you use yarn)
COPY package*.json ./

# Ensure Puppeteer downloads its browser and doesn't use a system one for this setup
# Remove PUPPETEER_EXECUTABLE_PATH from Render ENV VARS
# Ensure PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is NOT true in Render ENV VARS

RUN npm install --production

# Copy the rest of your application code
COPY . .

EXPOSE 3000

CMD [ "node", "server.js" ]
