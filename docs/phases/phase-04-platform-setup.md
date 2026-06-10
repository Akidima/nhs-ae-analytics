# NHS A&E Demand and Emergency Admissions Analytics Platform
## Phase 4: Platform Setup

**Project:** NHS A&E Demand and Emergency Admissions Analytics
**Phase:** 4 of 13
**Deliverables:** Complete configuration files, setup instructions, troubleshooting guide
**Prerequisite:** Phases 1–3 (+ Appendix A — Zero-Cost Edition)
**Next Phase:** Phase 5 — Data Engineering Pipeline (ingestion)
**Default build:** Zero-cost local stack (Docker on your laptop)

---

## 🧒 Explain Like I'm 10

> **Phase 4 is the day the kitchen actually gets built.**
>
> Up to now we drew plans and argued about where things go. Today the vans arrive and we bolt the stations to the floor: the fridge, the prep counter, the stoves, the head chef's timer, the inspector's station — all of it.
>
> The clever bit: instead of building each piece by hand, we use a magic instruction card. You say one phrase — `make up` — and the whole kitchen assembles itself, identical every time, on any laptop. That magic card is **Docker Compose**.
>
> When you're done cooking for the day you say `make down` and the kitchen folds away neatly, keeping your ingredients safe for tomorrow. If you ever want a totally fresh, empty kitchen, you say `make clean`.
>
> After today you have a real, running kitchen — empty of food so far (the cooking starts in Phase 5), but every station is plugged in, switched on, and talking to the others. **You can literally open the doors (`http://localhost:8080`) and see the lights on.**

---

## Table of Contents

1. [What This Phase Produces](#1-what-this-phase-produces)
2. [Prerequisites](#2-prerequisites)
3. [The Project Folder Structure](#3-the-project-folder-structure)
4. [The Services Explained](#4-the-services-explained)
5. [Environment Variables and Secrets Strategy](#5-environment-variables-and-secrets-strategy)
6. [Step-by-Step Setup](#6-step-by-step-setup)
7. [Verifying the Stack](#7-verifying-the-stack)
8. [Connecting Power BI / a SQL Client](#8-connecting-power-bi-a-sql-client)
9. [Troubleshooting Guide](#9-troubleshooting-guide)
10. [Learning Companion](#10-learning-companion)

---

## 1. What This Phase Produces

A one-command local platform. Every file below is real and in the repo:

| File | Role |
|------|------|
| `docker-compose.yml` | Defines all services (Postgres, MinIO, LocalStack, Airflow, ingestion, dbt) |
| `docker/ingestion.Dockerfile` | Builds the Python pipeline image |
| `docker/dbt.Dockerfile` | Builds the dbt Core image |
| `sql/init/00_create_airflow_db.sh` | Creates the Airflow metadata DB |
| `sql/init/01_schemas.sql` | Creates `staging`, `intermediate`, `marts`, `meta`, `reference` schemas |
| `sql/init/02_meta_catalog.sql` | Creates the metadata catalog tables (Phase 2) |
| `dbt/profiles.yml`, `dbt/dbt_project.yml` | dbt connection + layer→schema mapping |
| `.env.example` | Environment template (copy to `.env`) |
| `requirements.txt` | Python dependencies |
| `Makefile` | `make up/down/psql/...` shortcuts |
| `.gitignore` | Keeps secrets and data out of Git |
| `README.md` | Project front door |

After `make up`, you have running: a database, an S3-compatible store, an AWS emulator, and a working Airflow — all networked together.

---

## 2. Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Docker Desktop** (or Docker Engine + Compose v2) | The only thing you must install. Windows/Mac/Linux all fine. |
| **~4 GB free RAM** for Docker | Airflow's webserver + scheduler are the hungry ones. Give Docker Desktop ≥ 4 GB (Settings → Resources). |
| **Git** | To clone/version the repo. |
| **A SQL client** (optional) | DBeaver, `psql`, or Power BI to browse the warehouse. |
| **`make`** (optional) | Pre-installed on Mac/Linux; on Windows use Git Bash/WSL, or run the underlying `docker compose` commands directly. |

No Python install is needed on your host — everything runs inside containers.

---

## 3. The Project Folder Structure

```
nhs-ae-analytics/
├── README.md
├── Makefile                      # developer command shortcuts
├── .gitignore
├── .env.example                  # copy to .env (gitignored)
├── docker-compose.yml            # the whole stack
├── requirements.txt              # python deps (pipeline)
│
├── docker/
│   ├── ingestion.Dockerfile
│   └── dbt.Dockerfile
│
├── sql/
│   └── init/                     # runs once on first DB init
│       ├── 00_create_airflow_db.sh
│       ├── 01_schemas.sql
│       └── 02_meta_catalog.sql
│
├── ingestion/                    # Python framework        (Phase 5)
├── dbt/
│   ├── dbt_project.yml
│   ├── profiles.yml
│   └── models/{staging,intermediate,marts}/   (Phase 8)
├── airflow/
│   ├── dags/                     # DAGs                    (Phase 5)
│   ├── logs/
│   └── plugins/
├── config/
│   └── schema_registry/          # expected source schema  (Phase 5)
├── terraform/                    # IaC vs LocalStack        (Phase 10)
├── .github/workflows/            # CI/CD + free run         (Phase 10)
│
├── data/                         # gitignored runtime data
│   ├── raw/                      # raw zone (local fallback)
│   ├── minio/                    # MinIO storage
│   └── localstack/               # LocalStack state
│
└── docs/
    ├── phases/                   # the 13-phase guide
    └── appendices/               # zero-cost edition, etc.
```

This is the complete project skeleton. Later phases fill in `ingestion/`, `dbt/models/`, `airflow/dags/`, `config/schema_registry/`, `terraform/`, and `.github/workflows/` — the scaffolding for all of them already exists.

---

## 4. The Services Explained

Each maps directly to a kitchen station from Phase 3.

### postgres — the database (prep counter + finished-dish fridge)
PostgreSQL 16. Hosts **two** databases in one instance:
- `nhs_ae` — the analytics database (schemas: `staging`, `intermediate`, `marts`, `meta`, `reference`)
- `airflow` — Airflow's own metadata

The `sql/init/` scripts run **once**, the first time the volume is created. Data persists in the named volume `pgdata` across `up`/`down` (only `make clean` wipes it).

### minio — the raw zone (delivery dock)
An S3-compatible object store. Your ingestion code talks to it with the **real `boto3` S3 client** — so the code is identical to production AWS S3; only the endpoint differs. `minio-init` creates the versioned `nhs-ae-raw` bucket automatically.
- API: `http://localhost:9000` · Console: `http://localhost:9001`

### localstack — the pretend cloud (for IaC practice)
Emulates AWS (S3, IAM, Secrets Manager, STS) locally so your Terraform (Phase 10) runs for free with zero bill risk. Exposed on `http://localhost:4566`.

### airflow-init / airflow-webserver / airflow-scheduler — the head chef
- `airflow-init` runs database migrations and creates the `admin` user, then exits.
- `airflow-webserver` serves the UI at `http://localhost:8080`.
- `airflow-scheduler` runs the DAGs (added in Phase 5).
- Executor: **LocalExecutor** (right-sized — no Celery/Kubernetes overhead for a monthly job).

### ingestion / dbt — on-demand tools (not always-on)
These use Compose **profiles** (`tools`), so `make up` does **not** start them. You invoke them explicitly:
```bash
make ingest      # docker compose run --rm ingestion python -m ingestion.run
make dbt-build   # docker compose run --rm dbt dbt build
```
This keeps the always-on footprint small.

### How they talk to each other
Compose puts every service on a shared network where they reach each other **by service name**. Inside containers, the database host is `postgres`; from your **laptop** it's `localhost`. That distinction trips up everyone once — note it now.

---

## 5. Environment Variables and Secrets Strategy

### The rule
**Never commit secrets.** `.env.example` (a template with placeholder values) **is** committed; the real `.env` is **gitignored**. You create it once:

```bash
cp .env.example .env
```

### Local vs production secrets

| Context | Where secrets live | Why it's safe |
|---------|--------------------|----------------|
| **Local dev** (this phase) | `.env` file, gitignored | Values are throwaway local credentials; never leave your machine |
| **CI (GitHub Actions)** | GitHub encrypted **repository secrets** | Injected at runtime, masked in logs |
| **Production cloud** (Phase 10/11) | AWS Secrets Manager / Azure Key Vault | Fetched at runtime by IAM-scoped roles; never in code or env files |

The code reads config via `os.environ` / `python-dotenv`, so the *same code* works in all three contexts — only the **source** of the values changes. This is the secrets-hygiene story you tell in interviews.

### The Fernet key
Airflow encrypts connection credentials with a Fernet key. `.env.example` ships a working default for convenience, but generate your own:
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```
Paste it into `.env` as `AIRFLOW__CORE__FERNET_KEY`.

---

## 6. Step-by-Step Setup

```bash
# 1. Get the code
git clone <your-repo-url> nhs-ae-analytics
cd nhs-ae-analytics

# 2. Create your local env file
cp .env.example .env          # (or: make init)

# 3. (optional) generate your own Fernet key and paste into .env
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# 4. Start everything
make up                       # (or: docker compose up -d)

# 5. Watch it come alive (first run pulls images — a few minutes)
make logs                     # Ctrl-C to stop tailing
```

What happens on first `up`:
1. Postgres starts, runs the `sql/init/` scripts (schemas + metadata catalog + `airflow` DB).
2. MinIO starts; `minio-init` creates the `nhs-ae-raw` bucket.
3. LocalStack starts.
4. `airflow-init` migrates the metadata DB and creates the `admin` user, then exits (this is expected — it's a one-shot job).
5. `airflow-webserver` and `airflow-scheduler` start.

> The first run is slow (image pulls + Airflow DB migration + `PIP_ADDITIONAL_REQUIREMENTS` install). Subsequent `up`s are quick.

---

## 7. Verifying the Stack

```bash
make ps          # all services 'running' (airflow-init shows 'exited (0)' — correct)
```

**Check each door:**

| Check | How | Expected |
|-------|-----|----------|
| Airflow UI | open `http://localhost:8080` | login `admin`/`admin`; empty DAG list (DAGs arrive Phase 5) |
| MinIO UI | open `http://localhost:9001` | login with `MINIO_ROOT_*`; see the `nhs-ae-raw` bucket |
| Postgres schemas | `make psql` then `\dn` | `staging, intermediate, marts, meta, reference` |
| Metadata tables | in psql: `\dt meta.*` | `source_file, period_version, schema_drift_log, reconciliation_result, pipeline_run` |
| LocalStack | `curl localhost:4566/_localstack/health` | JSON listing s3/iam/etc. as available |
| dbt connectivity | `make dbt-build` (will be a no-op until Phase 8 models exist) | `dbt debug`-style connection OK |

If all six pass, the platform is correctly built.

---

## 8. Connecting Power BI / a SQL Client

From your **laptop** (outside the containers), connect to the warehouse:

```
Host:     localhost
Port:     5432
Database: nhs_ae
User:     nhs           (from .env)
Password: nhs_local_pw  (from .env)
```

- **Power BI Desktop:** Get Data → PostgreSQL database → `localhost:5432`, database `nhs_ae`. (There's nothing to chart until Phase 8 builds the marts — connection setup only for now.)
- **DBeaver / psql:** same coordinates. `make psql` opens a shell inside the container directly.

---

## 9. Troubleshooting Guide

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `make up` hangs / Airflow won't start | Docker has too little RAM | Docker Desktop → Settings → Resources → give it ≥ 4 GB |
| `port is already allocated` (5432/8080/9000) | Another service uses that port | Stop the conflicting app, or change the host port in `docker-compose.yml` (e.g. `15432:5432`) |
| `airflow-init` shows "exited" and people panic | **This is correct** | It's a one-shot init job; it's *meant* to exit 0 |
| Airflow login fails | User not created / wrong creds | Check `airflow-init` logs: `docker compose logs airflow-init`; verify `_AIRFLOW_WWW_USER_*` in `.env` |
| Schemas/tables missing in `nhs_ae` | Init scripts only run on **first** volume creation | `make clean` then `make up` to re-init (destroys data) |
| `FATAL: database "airflow" does not exist` | Init ran before script, or volume reused | `make clean && make up` |
| dbt can't connect | Wrong host (`localhost` vs `postgres`) | Inside containers use `postgres`; `profiles.yml` already defaults correctly |
| Can't connect Power BI | Using `postgres` as host from laptop | From the **host** use `localhost`, not `postgres` |
| MinIO bucket missing | `minio-init` failed | `docker compose logs minio-init`; re-run `docker compose up -d minio-init` |
| Changed `.env` but nothing changed | Containers cache env at start | `make restart` |
| Everything is weird, want a clean slate | Stale volumes/state | `make clean` (wipes DB + MinIO + LocalStack), then `make up` |
| Slow first run, fast later | First run pulls images + installs Airflow pip deps | Expected; be patient once |

**Golden rule:** when in doubt, `make clean && make up` gives you a guaranteed-fresh environment. Because the raw zone is immutable and everything downstream is rebuildable (Phase 3 principle), a clean rebuild never loses anything that matters once the pipeline exists.

---

## 10. Learning Companion

### Concepts to learn for this phase

| Concept | Why it matters here | Quick resource |
|---------|---------------------|----------------|
| Docker images vs containers vs volumes | The mental model for the whole stack | Docker "Get Started" docs |
| Docker Compose services & networks | How services find each other by name | Compose docs |
| Env vars & `.env` | Config + secrets without hardcoding | `python-dotenv` README |
| Host vs container networking (`localhost` vs `postgres`) | The #1 beginner gotcha | Compose networking docs |
| Postgres init scripts (`docker-entrypoint-initdb.d`) | How schemas get created automatically | Postgres image docs |
| Airflow components (webserver/scheduler/metadata DB) | Demystifies "why three Airflow services" | Airflow architecture overview |

### Estimated time
- Reading + understanding: ~2 hours
- First successful `make up`: ~30 minutes (mostly waiting on image pulls)
- Comfortable navigating all UIs: ~1 hour of poking around

### Beginner mistakes to avoid
1. **Committing `.env`.** It's gitignored for a reason — double-check before your first push.
2. **Panicking at `airflow-init` exiting.** It's supposed to.
3. **Using `postgres` as the host from Power BI.** From your laptop it's `localhost`.
4. **Starving Docker of RAM.** Airflow needs room; give Docker ≥ 4 GB.
5. **Editing `.env` and expecting live changes.** Restart the stack.

---

## Phase 4 Complete

### Deliverables Produced
- ✅ Complete `docker-compose.yml` (Postgres, MinIO, LocalStack, Airflow, ingestion, dbt)
- ✅ Dockerfiles for ingestion and dbt
- ✅ PostgreSQL bootstrap (schemas + metadata catalog + Airflow DB)
- ✅ dbt project + profile skeleton
- ✅ Environment-variable template and secrets strategy (local → CI → cloud)
- ✅ Makefile, .gitignore, README
- ✅ Setup instructions + verification checklist + troubleshooting guide

### Definition of Done for Phase 4
- [ ] `make up` brings up all services without errors
- [ ] Airflow UI reachable at `:8080`, login works
- [ ] MinIO console shows the `nhs-ae-raw` bucket
- [ ] `psql` shows all five schemas and the five `meta.*` tables
- [ ] LocalStack health endpoint responds
- [ ] You can connect a SQL client from your laptop to `localhost:5432`

### Phase 5 Preview
Phase 5 — Data Engineering Pipeline: the reusable **ingestion framework** in `ingestion/` — link resolver (random-suffix handling), downloader with retries, the `.xls` parser with header-anchor detection and schema-drift checks, file/row hashing, raw-zone writer (MinIO), staging loader, and the first **Airflow DAG** that orchestrates it. This is where food finally enters the kitchen.

---

*Document: Phase 4 of 13 | NHS A&E Analytics Platform | Version 1.0 | Default build = zero-cost*
