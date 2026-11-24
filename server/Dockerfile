# Build context: IDPS_BACKEND/server. PostgreSQL 17 client matches the source database.
FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends age postgresql-client-17 ca-certificates openssl tini \
    && rm -rf /var/lib/apt/lists/* && npm install -g pnpm@10.28.2
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN DIRECT_URL=postgresql://build@localhost/build pnpm build
ENV NODE_ENV=production
USER node
ENTRYPOINT ["tini","--"]
CMD ["pnpm","start"]
