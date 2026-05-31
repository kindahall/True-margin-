FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV SHOPIFY_APP_PORT=4100

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/shopify-app ./apps/shopify-app

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tmt/shopify-app build
RUN pnpm prune --prod
RUN mkdir -p .data && chown -R node:node /app

EXPOSE 4100

USER node

CMD ["node", "apps/shopify-app/dist/server.js"]
