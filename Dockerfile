FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

ENV PORT=3000
EXPOSE 3000

# Run node directly (not via npm) so SIGTERM reaches the app for a clean shutdown
CMD ["node", "server.js"]
