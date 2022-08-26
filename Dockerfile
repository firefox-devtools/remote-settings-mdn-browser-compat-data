FROM node:14-slim

WORKDIR /app

# Install dependencies, but don't generate lock files as we want to always fetch
# the lastest @mdn/browser-compat-data package.
COPY package.json ./
RUN npm install --no-package-lock && \
  npm cache clear --force

# copy sources
COPY update_remote_settings_records.mjs ./
COPY ./version.json ./

# set CMD
CMD ["npm", "run", "ingest"]
