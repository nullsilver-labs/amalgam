FROM node:24-slim

# Only what the agent will reach for through `bash`. Anything else is a
# CLI-with-README installed into the workspace, in a separate deliberate commit.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep curl ca-certificates tini openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/amalgam/package.json packages/amalgam/package.json
COPY packages/telegram/package.json packages/telegram/package.json
RUN npm ci --ignore-scripts
COPY . /work
RUN npm run build && npm link ./packages/amalgam && npm link ./packages/telegram

ENV AMALGAM_HOME=/root/.amalgam
WORKDIR /workspace
ENTRYPOINT ["tini", "--"]
CMD ["amalgam"]
