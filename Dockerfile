FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun --bun next build

FROM base AS web
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts postcss.config.mjs ./
COPY src ./src
EXPOSE 3000
CMD ["bun", "--bun", "next", "start"]

FROM base AS pipeline
ENV PATH=/root/.bun/bin:$PATH
# The claude-code provider spawns the Claude Code CLI instead of calling an API.
RUN bun install -g @studio-foundation/cli@0.17.0 @anthropic-ai/claude-code
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["/app/docker/run-loop.sh"]
