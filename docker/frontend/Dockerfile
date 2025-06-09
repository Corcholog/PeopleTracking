FROM node:22.14-alpine

WORKDIR /app
COPY ../../frontend/package*.json ./
RUN npm install
EXPOSE 3000

# Esto es para Desarrollo, cambiar el Dockerfile si es para producción
CMD ["sh", "-c", "npm install && npm run dev"]
