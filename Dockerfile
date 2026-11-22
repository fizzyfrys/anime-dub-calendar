FROM node:24-alpine

WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/fizzyfrys/anime-dub-calendar"
RUN apk add --no-cache tini && mkdir /data && chown node:node /data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY docs/ ./docs/
COPY web/ ./web/

ENV NODE_ENV=production
USER node
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "-g", "--"]
CMD ["node", "src/serve.js"]
