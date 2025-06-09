FROM node:22.14-alpine

WORKDIR /app
# Hacer COPY para producción, para desarrollo dejar el Dockerfile de esta manera

EXPOSE 3000

# Esto es para Desarrollo, cambiar el Dockerfile si es para producción
CMD ["sh", "-c", "npm install && npm run dev"]
