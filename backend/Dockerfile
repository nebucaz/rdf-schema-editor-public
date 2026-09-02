# Build stage — compile the Go binary
FROM golang:1.26-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o bin/server ./cmd/server

# Runtime stage — minimal image with no build toolchain
FROM alpine:3.21

RUN apk --no-cache add ca-certificates wget && \
    addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/bin/server ./server

EXPOSE 8090

USER app

CMD ["./server"]
