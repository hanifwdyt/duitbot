FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# Create data directory
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# Start script
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
