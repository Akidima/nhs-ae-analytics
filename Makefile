# =====================================================================
# NHS A&E Analytics — developer command shortcuts
#   make help   to list everything
# =====================================================================
.DEFAULT_GOAL := help
SHELL := /bin/bash

.PHONY: help init up down restart logs ps clean \
        ingest dbt-build dbt-test psql tf-init tf-apply

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

init: ## First-time setup: copy env template
	@test -f .env || (cp .env.example .env && echo "created .env from template")

up: init ## Start the full stack (postgres, minio, localstack, airflow)
	docker compose up -d
	@echo "Airflow:  http://localhost:8080  (admin/admin)"
	@echo "MinIO:    http://localhost:9001"

down: ## Stop the stack (keeps data volumes)
	docker compose down

restart: down up ## Restart the stack

logs: ## Tail logs from all services
	docker compose logs -f

ps: ## Show running containers
	docker compose ps

clean: ## DESTROY everything incl. data volumes (fresh start)
	docker compose down -v
	@echo "all containers and volumes removed"

ingest: ## Run the ingestion pipeline once (Phase 5)
	docker compose run --rm ingestion python -m ingestion.run

dbt-build: ## Run dbt build (models + tests) (Phase 8)
	docker compose run --rm dbt dbt build

dbt-test: ## Run dbt tests only
	docker compose run --rm dbt dbt test

psql: ## Open a psql shell on the analytics DB
	docker compose exec postgres psql -U nhs -d nhs_ae

tf-init: ## terraform init against LocalStack (Phase 10)
	cd terraform && terraform init

tf-apply: ## terraform apply against LocalStack (Phase 10)
	cd terraform && terraform apply -auto-approve
