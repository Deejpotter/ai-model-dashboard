FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
