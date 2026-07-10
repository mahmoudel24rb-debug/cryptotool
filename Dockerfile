# Stage 1: Build
# Node 24 : aligné sur l'environnement local, et requis pour le flag
# --use-system-ca du script start (inexistant en Node 20 → crash au boot)
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# public/charting_library is gitignored (TradingView license) — ensure the dir
# exists so the production-stage COPY never fails
RUN mkdir -p public
RUN npm run build

# Stage 2: Production
# The server runs under tsx: the package is ESM ("type": "module") and the
# old CommonJS dist build could not actually start under node.
FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY config.json ./

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["npm", "start"]
