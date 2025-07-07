# Node-API DOckerfile
FROM node:22
WORKDIR /app
#COPY ./package.json .
COPY . .
RUN rm package-lock.json
RUN npm install && npm install -g nodemon && npm install express
#RUN rm -f ./.env
#RUN rm -f Dockerfile
#RUN rm -f Dockerfile.dev
#RUN rm -f docker-compose.yml
#RUN rm -rf node_modules package-lock.json
RUN npm install

EXPOSE 8083
EXPOSE 5000
CMD ["npm","run","server"]