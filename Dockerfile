FROM node:14-slim

WORKDIR /app

COPY package.json ./
RUN npm install --no-package-lock; \
  npm cache clean --force

# copy sources
COPY update_remote_settings_records.mjs ./
COPY ./version.json ./

# set CMD
CMD ["node", "update_remote_settings_records.mjs"]
