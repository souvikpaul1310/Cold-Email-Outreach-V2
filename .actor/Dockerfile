# Apify base image with Node 22 + Playwright + Chrome preinstalled
FROM apify/actor-node-playwright-chrome:22

COPY --chown=myuser package*.json ./

# Keep the Playwright version that ships with the base image
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" && node --version \
    && echo "NPM version:" && npm --version

COPY --chown=myuser . ./

CMD npm start --silent
