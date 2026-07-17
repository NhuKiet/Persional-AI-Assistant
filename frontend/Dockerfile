# Frontend image — build tĩnh bằng Vite rồi serve qua nginx.
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Vite nhúng biến VITE_* vào bundle LÚC BUILD (không phải runtime). Truyền
# endpoint backend qua build arg; mặc định localhost cho compose chạy máy nhà.
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
