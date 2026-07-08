FROM denoland/deno:2.0

WORKDIR /app
COPY . .

RUN deno cache src/main.ts

EXPOSE 8787
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "src/main.ts"]
