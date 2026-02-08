FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# Start script - ensure data dir exists before prisma
CMD ["sh", "-c", "mkdir -p /app/data && npx prisma db push --skip-generate --accept-data-loss 2>&1 && echo 'DB ready' && node dist/index.js"]
