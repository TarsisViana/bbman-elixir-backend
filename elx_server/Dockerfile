FROM elixir:1.16-alpine

RUN apk add --no-cache git build-base
WORKDIR /app
COPY . ./
ENV MIX_ENV=prod

RUN mix deps.get && mix setup

EXPOSE 4000

CMD ["mix", "phx.server"]

