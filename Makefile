# One-command local workflow. Services: db, redis, api, worker, web.
COMPOSE = docker compose -f infra/docker-compose.yml

.PHONY: up down logs seed test e2e lint

up:            ## Build and start every service
	$(COMPOSE) up --build -d
	@echo "web http://localhost:3000  api http://localhost:8000/v1/docs"

seed:          ## Seed a verified cohort and publish a batch
	$(COMPOSE) exec api python -m app.seed --run-batch

down:          ## Stop everything (keeps the database volume)
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f api worker web

test:          ## Backend acceptance tests (needs MM_DATABASE_URL pointing at a test database)
	cd apps/api && python -m pytest -q

lint:          ## Web typecheck, lint and build
	cd apps/web && npx tsc --noEmit && npm run lint && npm run build

e2e:           ## Browser journey against a running stack
	cd apps/web && npx playwright test
