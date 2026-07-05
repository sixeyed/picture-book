FROM node:24-bookworm-slim

# pwsh: tar.gz install (the Microsoft apt repo is amd64-only; this works on arm64 Macs too)
ARG TARGETARCH
ARG PWSH_VERSION=7.5.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates libicu72 \
 && arch=$([ "$TARGETARCH" = "arm64" ] && echo linux-arm64 || echo linux-x64) \
 && curl -fsSL "https://github.com/PowerShell/PowerShell/releases/download/v${PWSH_VERSION}/powershell-${PWSH_VERSION}-${arch}.tar.gz" -o /tmp/pwsh.tgz \
 && mkdir -p /opt/pwsh && tar -xzf /tmp/pwsh.tgz -C /opt/pwsh \
 && chmod +x /opt/pwsh/pwsh && ln -s /opt/pwsh/pwsh /usr/local/bin/pwsh \
 && rm /tmp/pwsh.tgz && rm -rf /var/lib/apt/lists/*

RUN pwsh -NoProfile -Command "Install-Module Pester -Force -Scope AllUsers"

WORKDIR /app
ENV PATH=/app/node_modules/.bin:$PATH
CMD ["pwsh"]
