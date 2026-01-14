# Node-API DOckerfile
FROM 192.168.0.140:5000/node:22-alpine
WORKDIR /app
#COPY ./package.json .
#COPY . .
#RUN npm install && npm install -g nodemon && npm install express
#RUN rm -f ./.env
#RUN rm -f Dockerfile
#RUN rm -f Dockerfile.dev
#RUN rm -f docker-compose.yml
#RUN rm -rf node_modules package-lock.json
# Remove node_modules and package-lock.json
#RUN rm -rf node_modules package-lock.json
#RUN npm install --save-dev nodemon
#RUN npm install --production


COPY ./edge_reasume_certs /certs
RUN chown -R node:node /certs

USER node

EXPOSE 8443
EXPOSE 8080
CMD ["npm","run","server"]
