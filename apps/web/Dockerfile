FROM node:26-alpine AS build
WORKDIR /app
# Rewrite and WebSocket targets are resolved at build time by next.config.ts.
ARG API_ORIGIN=http://api:8000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8000/v1/realtime/ws
ENV API_ORIGIN=$API_ORIGIN NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["npm", "run", "start"]
