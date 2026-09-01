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
ENV NODE_ENV=production HOME=/home/bun
COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/.next ./.next
COPY --chown=bun:bun package.json next.config.ts postcss.config.mjs ./
COPY --chown=bun:bun src ./src
# --chown on each COPY, never `chown -R` after: a recursive chown over
# node_modules rewrites the entire 1.4 GB layer, which stalled the build for
# 15 minutes on apollon.
# /data exists in the image so the named volume inherits this ownership.
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000
CMD ["bun", "--bun", "next", "start"]

FROM base AS pipeline
# The claude CLI refuses --dangerously-skip-permissions as root and Studio's
# claude-code provider always passes it, so this image runs unprivileged.
# BUN_INSTALL puts the global bins in /usr/local/bin, which that user can read;
# `bun install -g` also drops the executable bit on the CLI's platform binary,
# so studio would die with EACCES spawning its own baseline build.
ENV BUN_INSTALL=/usr/local HOME=/home/bun
RUN bun install -g @studio-foundation/cli@0.17.0 @anthropic-ai/claude-code \
 && chmod +x /usr/local/install/global/node_modules/@studio-foundation/cli-linux-x64*/studio
COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun . .
RUN mkdir -p /data && chown bun:bun /data
USER bun
CMD ["/app/docker/run-loop.sh"]
