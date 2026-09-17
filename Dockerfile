FROM node:22

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN chown -R node:node /app
USER node

EXPOSE 8080
EXPOSE 8443

CMD ["node", "index.js"]
