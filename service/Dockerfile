# The Interway route service: one bundled Node file (built from app/src/service by `npm run build:service` in
# app/, copied here by deploy.sh). It loads the waterway data from the website at start-up (DATA_URL), so it
# always routes on the same data as https://abecadel.github.io/interway/.
FROM node:22-slim
WORKDIR /srv
COPY server.mjs .
ENV PORT=8080 DATA_URL=https://abecadel.github.io/interway/data/ NODE_OPTIONS=--max-old-space-size=768
EXPOSE 8080
CMD ["node", "server.mjs"]
