FROM node:22.14-alpine

WORKDIR /app
COPY ../../frontend/package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]