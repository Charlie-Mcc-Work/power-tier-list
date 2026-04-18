FROM node:20-slim

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY index.js ./

RUN mkdir -p /data
ENV DATA_DIR=/data
EXPOSE 3001

CMD ["node", "index.js"]
