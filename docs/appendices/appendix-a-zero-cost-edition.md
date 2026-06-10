# NHS A&E Analytics Platform
## Appendix A: The Zero-Cost Edition

**Status:** Cross-cutting appendix — applies to every phase
**Purpose:** Build, run, and showcase the entire platform for **£0**, while still demonstrating every skill (cloud, IaC, orchestration, BI) an interviewer cares about.
**Default policy:** From here on, the **zero-cost path is the default build**. The paid cloud deployment (real AWS/Azure) is kept as an **optional upgrade**, clearly marked, in Phases 4 and 10.

---

## 🧒 Explain Like I'm 10

> You don't need to rent a second restaurant to prove you can cook. **You cook the whole meal in your own kitchen at home and film it.**
>
> Renting a cloud kitchen costs money every month, even when nobody's eating. So instead, we build the entire kitchen *on your own laptop* using Docker (the kitchen-in-a-box). It runs only when you switch it on — and switching it on is free.
>
> For the one part that's tricky (the fancy serving window, Power BI), we either use the free version or swap in a free look-alike. And for the "cloud" skills, we use a clever pretend-cloud called **LocalStack** that runs on your laptop and behaves exactly like the real thing — so you learn and *prove* the cloud skill without ever paying a cloud bill.
>
> The result: a complete, impressive project that cost you nothing, plus a recorded demo and a public link you can share. **That's the whole idea — same meal, home kitchen, zero rent.**

---

## 1. The One Principle

> **Develop and run everything locally on your laptop in Docker. Treat the cloud deployment as "designed, deploy-on-demand," not "always-on."**

A portfolio project does not need to be live 24/7. It needs to be:
1. **Runnable** — `docker compose up` and it works.
2. **Demonstrable** — a recorded walkthrough + screenshots.
3. **Reviewable** — all code public on GitHub, with docs.

Paying to keep infrastructure idle is a *red flag* to a good interviewer, not a green one. Cost discipline is a skill you are showing off, not hiding.

Your ASUS ROG laptop comfortably runs the full stack (Postgres + Airflow + dbt + Great Expectations + MinIO are all lightweight at this data volume).

---

## 2. Full Paid → Free Mapping

| Layer | Paid / Cloud Version | Zero-Cost Version | Skill Still Demonstrated? |
|-------|----------------------|-------------------|---------------------------|
| Compute | Cloud VMs / ECS Fargate | Your laptop, in Docker | ✅ (containerisation) |
| Raw zone (object storage) | AWS S3 / Azure Blob | **MinIO** container (S3-compatible) or local volume | ✅ S3 API skills via MinIO |
| Database | AWS RDS / Azure Postgres | PostgreSQL container | ✅ identical SQL/Postgres |
| Orchestration (dev) | MWAA (~£250+/mo) | Airflow container (LocalExecutor) | ✅ Airflow DAGs |
| Orchestration (recurring "prod") | Cloud-scheduled Airflow | **GitHub Actions cron** | ✅ scheduled pipeline, free |
| Transformation | dbt Cloud (paid) | **dbt Core** (free) | ✅ full dbt |
| Validation | — | Great Expectations (already free) | ✅ |
| Cloud infrastructure | Live AWS/Azure | **LocalStack** (AWS emulator in Docker) | ✅ real Terraform + AWS APIs |
| IaC | Terraform → real cloud | Terraform → LocalStack | ✅ identical Terraform code |
| Dashboards | Power BI Pro/Premium | Power BI Desktop (free authoring) **or Apache Superset/Metabase** | ✅ BI + DAX, or open-source BI |
| CI/CD | — | GitHub Actions (free on public repos) | ✅ |
| Hosting / showcase | Paid hosting | GitHub Pages (dbt docs + screenshots) | ✅ public portfolio link |
| Secrets | Secrets Manager / Key Vault | `.env` (gitignored) locally; GH Actions encrypted secrets | ✅ secrets hygiene |

**Every row keeps the skill. Nothing on the CV is lost.**

---

## 3. Component-by-Component Free Setup

### 3.1 Raw Zone → MinIO (recommended) or local volume

Two free options:

- **Simplest:** a local Docker volume (`./data/raw/`). Zero extra services. The storage client is abstracted, so code is identical to S3.
- **Better for the CV:** run **MinIO**, an open-source, S3-compatible object store, as a container. Your code uses the *real* `boto3` S3 client pointed at MinIO. You demonstrate genuine S3 skills, and switching to real AWS S3 later is just an endpoint change.

```yaml
# docker-compose snippet (full file in Phase 4)
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]   # API + web console
    volumes: ["./data/minio:/data"]
```

```python
# boto3 against MinIO == boto3 against real S3, only endpoint_url differs
import boto3
s3 = boto3.client(
    "s3",
    endpoint_url="http://localhost:9000",   # remove this line for real AWS
    aws_access_key_id="minioadmin",
    aws_secret_access_key="minioadmin",
)
```

### 3.2 Database → PostgreSQL container

No change from the main design. Postgres in Docker is already free and is the same engine RDS runs.

### 3.3 Orchestration → Airflow locally + GitHub Actions for recurring runs

- **For development & the orchestration skill:** run Airflow in Docker locally (Phase 4). Build and demo the DAGs there.
- **For the actual monthly recurring run at zero cost:** a **GitHub Actions scheduled workflow** runs the pipeline on a cron with no server.

```yaml
# .github/workflows/monthly-pipeline.yml  (zero-cost recurring run)
name: monthly-ae-pipeline
on:
  schedule:
    - cron: "0 8 * * 4"      # Thursdays 08:00 UTC (release is 2nd Thursday)
  workflow_dispatch: {}       # manual trigger button
jobs:
  run:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres }
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r requirements.txt
      - run: python -m ingestion.run        # scrape → download → stage
      - run: dbt build --project-dir dbt     # transform + test
      - run: python -m validation.checkpoint # Great Expectations gate
```

> **Interview line:** "I demonstrate Airflow locally for orchestration design, but the production recurring run is a free scheduled GitHub Action — because for a monthly job, a £250/mo managed Airflow is the wrong tool."

### 3.4 Cloud + IaC → Terraform against LocalStack

**LocalStack** emulates AWS (S3, RDS-ish, IAM, Secrets Manager, etc.) inside a Docker container. You write *real* Terraform and run `terraform apply` against it — free, offline, zero risk of a bill.

```yaml
# docker-compose snippet
  localstack:
    image: localstack/localstack:latest
    ports: ["4566:4566"]
    environment:
      SERVICES: s3,iam,secretsmanager,sts
    volumes: ["./data/localstack:/var/lib/localstack"]
```

```hcl
# terraform/providers.tf — point AWS provider at LocalStack
provider "aws" {
  region                      = "eu-west-2"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requested_account_id   = true
  s3_use_path_style           = true
  endpoints {
    s3             = "http://localhost:4566"
    iam            = "http://localhost:4566"
    secretsmanager = "http://localhost:4566"
  }
}
```

To deploy to **real** AWS later, you delete the `endpoints {}` block and supply real credentials. The Terraform *resources* are unchanged — that's the whole point.

> **Interview line:** "The same Terraform deploys to real AWS unchanged — I developed and tested it against LocalStack to keep cost at zero."

### 3.5 Dashboards → Power BI free, or Superset

**Path A — Power BI Desktop (free, Windows):** You're on Windows, so author all five dashboards for free. To share:
- Record a screen walkthrough (best for interviews — shows interactivity)
- Export pages to PDF
- "Publish to web" (free public embed, needs a free Microsoft account)

**Path B — Apache Superset / Metabase (free, open-source, in Docker):** A fully-free, publicly-linkable, live web dashboard. Connects straight to your Postgres warehouse. Good if you want a live link on LinkedIn or you're tool-agnostic.

> **Recommendation:** Build in **Power BI** (it's the NHS-standard skill and the most valuable to show for NHS-adjacent roles), and *optionally* mirror one dashboard in Superset to prove you're not locked to one tool.

### 3.6 Showcase → GitHub Pages

`dbt docs generate` produces a static documentation site (model lineage, column descriptions, tests). Push it to **GitHub Pages** for a free public URL. Add a `/screenshots` folder with dashboard images. Now you have one link to drop into LinkedIn posts and your CV.

---

## 4. How Each Phase Adapts to Zero-Cost

| Phase | Zero-cost default | Paid upgrade (optional) |
|-------|-------------------|-------------------------|
| 4 — Platform Setup | Docker Compose: Postgres + Airflow + dbt + GE + **MinIO + LocalStack** | n/a (already local) |
| 5 — Ingestion | Writes to MinIO/volume; runs in container | Same code → real S3 |
| 6 — Warehouse | Local Postgres | Same DDL → RDS |
| 7 — Data Quality | Great Expectations (free) | unchanged |
| 8 — Analytics (dbt) | dbt Core (free) | unchanged |
| 9 — Dashboards | Power BI free / Superset | Power BI Pro for org sharing |
| 10 — DevOps | Terraform → LocalStack; GitHub Actions cron | Terraform → real AWS/Azure; managed Airflow |
| 11 — Production Readiness | Runbooks/governance written and demonstrated locally | Apply against live cloud |
| 12 — Enhancements | All buildable locally | Streaming/ML may want cloud later |

**Net effect:** Phases 4–9 and 11–12 are *naturally* zero-cost already. Only Phase 10 changes — and it changes from "deploy to AWS" to "deploy to LocalStack, with real-AWS as a documented optional step."

---

## 5. Cost Guardrails (How to Guarantee £0)

To be certain you are never charged:

1. **Don't put a payment card on a cloud account at all** while in zero-cost mode. No card = no bill, full stop.
2. If you *do* later trial real AWS Free Tier: set a **£1 budget alert** immediately, use only Free-Tier-eligible sizes, and **`terraform destroy`** the moment a demo ends.
3. Keep the repo **public** so GitHub Actions minutes are free.
4. Use **Power BI Desktop** (free) for authoring; only consider Pro if an actual employer needs org-wide sharing.
5. LocalStack and MinIO are fully local — they never call out to a paid cloud.

---

## 6. What You "Lose" — and How to Frame It

| What you don't have | Why it doesn't matter | What you say in the interview |
|---------------------|------------------------|-------------------------------|
| A live always-on cloud deployment | Idle infra is wasted money | "It's designed for AWS — here's the Terraform, tested on LocalStack — and I deploy it on demand to avoid idle cost." |
| Managed Airflow (MWAA) | Overkill for a monthly job | "I right-sized orchestration: local Airflow for design, free scheduled Actions for the recurring run." |
| Power BI org sharing | Not needed for a portfolio | "Here's a recorded walkthrough and a Publish-to-web link; I also mirrored it in Superset." |

This framing turns "I had no budget" into "I made deliberate, defensible cost-engineering decisions" — which is exactly what data/platform teams want to hear.

---

## 7. Zero-Cost Definition of Done

You're finished when, having spent **£0**:

- [ ] `docker compose up` brings up Postgres, Airflow, dbt, GE, MinIO, LocalStack
- [ ] Ingestion scrapes NHS England, lands files in MinIO, loads staging
- [ ] dbt builds the dimensional model; dbt tests pass
- [ ] Great Expectations checkpoint passes (incl. reconciliation)
- [ ] Terraform `apply` succeeds against LocalStack
- [ ] A GitHub Actions workflow runs the pipeline end-to-end on push
- [ ] Five dashboards exist (Power BI and/or Superset)
- [ ] dbt docs published to GitHub Pages; screenshots in the repo
- [ ] README explains the zero-cost design and the real-cloud upgrade path
- [ ] A 5–10 min recorded demo walkthrough exists

Hit all of those and you have a senior-credible portfolio project that cost nothing but your laptop's electricity.

---

*Appendix A | NHS A&E Analytics Platform | Version 1.0 | Default build = zero-cost*
