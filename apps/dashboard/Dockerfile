FROM node:20-alpine AS build

WORKDIR /app
ARG VITE_API_URL
ARG VITE_PURCHASE_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_PURCHASE_URL=${VITE_PURCHASE_URL}

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/dashboard ./apps/dashboard

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tmt/dashboard build

FROM nginx:1.27-alpine AS runner

COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html

EXPOSE 80
