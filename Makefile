.PHONY: setup test down

setup:
	@echo "Starting Docker containers..."
	docker compose up -d
	@echo "Waiting for database to be ready..."
	@until [ "$$(docker inspect --format='{{json .State.Health.Status}}' $$(docker compose ps -q db))" = '"healthy"' ]; do \
		echo "Waiting for database..."; \
		sleep 1; \
	done
	@echo "Database is ready. Running tests..."
	go test -v ./cmd/... ./internal/...

test:
	go test -v ./cmd/... ./internal/...

down:
	docker compose down -v
