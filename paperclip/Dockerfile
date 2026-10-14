# Isolated runtime for the Paperclip control plane and its Claude Code workers.
# Nothing from the host is mounted except a named Docker volume for Paperclip data.
FROM node:24-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git curl jq ripgrep python3 tini procps \
 && rm -rf /var/lib/apt/lists/*
# Pinned versions (checked on 2026-10-14)
ARG PAPERCLIP_VERSION=2026.1012.0
ARG CLAUDE_CODE_VERSION=2.1.299
RUN npm install --global paperclipai@${PAPERCLIP_VERSION} @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && npm cache clean --force
RUN mkdir -p /paperclip /work && chown -R node:node /paperclip /work
USER node
ENV HOME=/paperclip PAPERCLIP_HOME=/paperclip PAPERCLIP_NO_BROWSER=1 PAPERCLIP_OPEN_ON_LISTEN=false \
    HOST=0.0.0.0 PORT=3100 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
WORKDIR /paperclip
EXPOSE 3100
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
