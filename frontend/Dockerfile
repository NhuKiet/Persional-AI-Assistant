# Frontend image — build tĩnh bằng Vite rồi serve qua nginx.
FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Vite nhúng biến VITE_* vào bundle LÚC BUILD (không phải runtime). Mặc định
# rỗng: trang gọi "/api/…" cùng origin, nginx chuyển sang backend (nginx.conf)
# — cần cho cookie đăng nhập. Chỉ đặt khi backend buộc phải ở origin khác.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
EXPOSE 80
