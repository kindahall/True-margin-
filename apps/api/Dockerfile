FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4001

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY prisma ./prisma
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tmt/api build
RUN pnpm prune --prod
RUN mkdir -p .data && chown -R node:node /app

EXPOSE 4001

USER node

CMD ["node", "apps/api/dist/apps/api/src/server.js"]
