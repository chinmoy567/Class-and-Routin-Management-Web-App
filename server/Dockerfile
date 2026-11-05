# OPS-01 / OPS-05: the API, Socket.IO and Agenda worker. Build from the repo root.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace @crm/server --workspace @crm/shared --include-workspace-root --omit=dev

FROM node:24-slim
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY server ./server
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/server.js"]
