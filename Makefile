# PeerPigeon Makefile
# Quick commands for development and testing

.PHONY: help install test test-unit test-integration test-custom test-all lint lint-fix benchmark coverage clean dev server

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

test: ## Run all tests (custom test runners)
	npm run test:custom

test-unit: ## Run unit tests only
	npm run test:unit

test-integration: ## Run integration tests only
	npm run test:integration

test-custom: ## Run custom test runners
	npm run test:custom

test-all: ## Run comprehensive test suite with runner
	npm run test:all

test-jest: ## Run Jest tests
	npm run test

coverage: ## Run tests with coverage
	npm run test:coverage

lint: ## Run ESLint
	npm run lint

lint-fix: ## Run ESLint with auto-fix
	npm run lint:fix

benchmark: ## Run performance benchmarks
	npm run benchmark

dev: ## Start development server
	npm run dev

server: ## Start WebSocket signaling server
	npm run server

clean: ## Clean node_modules and coverage
	rm -rf node_modules coverage

ci: ## Run CI pipeline (lint + tests)
	npm run ci

setup: install ## Initial project setup
	@echo "✅ Project setup complete!"

# Development workflow
start: server ## Alias for server

# Testing workflow
check: lint test ## Quick check (lint + test)

# Full workflow
all: clean install lint test coverage benchmark ## Complete workflow

# Quick commands
t: test ## Short alias for test
l: lint ## Short alias for lint
b: benchmark ## Short alias for benchmark
s: server ## Short alias for server
d: dev ## Short alias for dev
