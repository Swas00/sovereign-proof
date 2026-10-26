# Sovereign Proof: one container runs the development chain (loopback only) and the API, which also serves the built web app.
# Only the API's port is exposed. The chain node is never reachable from outside; wallets use the API's locked-down /rpc gateway.
FROM node:22-bookworm-slim
WORKDIR /app
ENV HARDHAT_DISABLE_TELEMETRY_PROMPT=true \
    HOST=0.0.0.0
# The runtime needs tsx, hardhat and ethers (declared as devDependencies), so install everything.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:web
# Hosts such as Render set PORT; the API reads it (default 8787).
EXPOSE 8787
CMD ["npm", "run", "serve"]
