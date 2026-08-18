# Kubernetes Manifests for NHS A&E Analytics — Summary

## 📦 Generated Files

### Core Manifests
| File | Purpose |
|------|---------|
| `k8s-namespace.yaml` | Create isolated `nhs-ae-analytics` namespace |
| `k8s-config-secrets.yaml` | ConfigMap (env vars) + Secret (credentials) |
| `k8s-pvcs.yaml` | PersistentVolumeClaims for data persistence |
| `k8s-services.yaml` | Services (ClusterIP, LoadBalancer) for networking |
| `k8s-postgres.yaml` | PostgreSQL StatefulSet with health checks |
| `k8s-minio.yaml` | MinIO Deployment + init job for bucket creation |
| `k8s-localstack.yaml` | LocalStack Deployment for AWS service emulation |
| `k8s-airflow.yaml` | Airflow Webserver + Scheduler Deployments |
| `k8s-jobs.yaml` | Ingestion + dbt Jobs and CronJobs |
| `k8s-ingress-network.yaml` | Ingress (optional) + NetworkPolicy (optional) |

### Deployment Tooling
| File | Purpose |
|------|---------|
| `deploy-k8s.sh` | Bash script to deploy all manifests in order |
| `kustomization.yaml` | Kustomize configuration for overlays |
| `KUBERNETES_DEPLOYMENT_GUIDE.md` | Complete deployment documentation |

---

## 🚀 Quick Start

### 1. **Prepare Secrets** (CRITICAL)
Edit `k8s-config-secrets.yaml` and replace placeholder credentials:
```bash
# Generate Fernet key for Airflow:
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 2. **Build & Push Custom Images**
```bash
# Build images
docker build -f docker/ingestion.Dockerfile -t your-registry/nhs-ae:ingestion .
docker build -f docker/dbt.Dockerfile -t your-registry/nhs-ae:dbt .

# Push to registry
docker push your-registry/nhs-ae:ingestion
docker push your-registry/nhs-ae:dbt

# Update k8s-jobs.yaml with your registry paths
```

### 3. **Deploy**
```bash
# Option A: Automated deployment script
./deploy-k8s.sh

# Option B: Manual deployment
kubectl apply -f k8s-namespace.yaml
kubectl apply -f k8s-config-secrets.yaml
kubectl apply -f k8s-pvcs.yaml
kubectl apply -f k8s-postgres.yaml
kubectl wait --for=condition=ready pod -l app=postgres -n nhs-ae-analytics --timeout=300s
kubectl apply -f k8s-minio.yaml k8s-localstack.yaml
kubectl apply -f k8s-services.yaml k8s-airflow.yaml k8s-jobs.yaml

# Option C: Using Kustomize
kubectl apply -k .
```

### 4. **Verify Deployment**
```bash
# Check all pods
kubectl get pods -n nhs-ae-analytics

# Watch pod status
kubectl get pods -n nhs-ae-analytics -w
```

### 5. **Access Applications**
```bash
# Airflow UI (http://localhost:8080, admin/admin)
kubectl port-forward svc/airflow-webserver 8080:8080 -n nhs-ae-analytics

# MinIO Console (http://localhost:9001)
kubectl port-forward svc/minio-console 9001:9001 -n nhs-ae-analytics

# PostgreSQL (localhost:5432)
kubectl port-forward svc/postgres 5432:5432 -n nhs-ae-analytics
```

---

## 🏗️ Architecture

### Persistent Services (Always Running)
- **PostgreSQL** (StatefulSet): Analytics warehouse + Airflow metadata
- **MinIO** (Deployment): S3-compatible object storage
- **LocalStack** (Deployment): AWS service emulator
- **Airflow Webserver** (Deployment): DAG orchestration UI
- **Airflow Scheduler** (Deployment): DAG execution engine

### On-Demand Tasks (Run on Demand or Schedule)
- **Ingestion Job**: One-time data ingestion runner
- **Ingestion CronJob**: Scheduled daily (2 AM UTC)
- **dbt Job**: One-time data transformation runner
- **dbt CronJob**: Scheduled daily (3 AM UTC, after ingestion)

---

## 🔐 Security Considerations

### Current State (Development)
- Secrets stored as plaintext Kubernetes Secret (not encrypted at rest by default)
- Services accessible via LoadBalancer (public exposure)
- No NetworkPolicy enforcing pod-to-pod communication

### Production Recommendations
1. **Use External Secrets Manager**:
   - AWS Secrets Manager + external-secrets operator
   - Azure Key Vault
   - HashiCorp Vault
   - Sealed Secrets

2. **Use Ingress Instead of LoadBalancer**:
   - Replace `type: LoadBalancer` with `type: ClusterIP`
   - Deploy Ingress controller (nginx, Traefik, etc.)
   - Enable TLS/SSL certificates

3. **Enable NetworkPolicy**:
   - Uncomment `k8s-ingress-network.yaml`
   - Restrict pod-to-pod communication

4. **Enable RBAC**:
   - Create ServiceAccounts and Roles
   - Limit pod permissions

---

## 📊 Storage

### PersistentVolumeClaims
| PVC | Size | Purpose | Access |
|-----|------|---------|--------|
| `postgres-pvc` | 10Gi | PostgreSQL data | ReadWriteOnce |
| `minio-pvc` | 20Gi | MinIO object storage | ReadWriteOnce |
| `localstack-pvc` | 5Gi | LocalStack state | ReadWriteOnce |
| `airflow-logs-pvc` | 5Gi | Airflow logs | ReadWriteMany |

**Storage Class**: `standard` (default in most clusters)

To list available storage classes:
```bash
kubectl get storageclass
```

---

## 🔄 Job Scheduling

### Ingestion Pipeline
- **Schedule**: Daily 2 AM UTC
- **Command**: `python -m ingestion.run`
- **Image**: Your custom ingestion image
- **Dependencies**: PostgreSQL, MinIO must be running

### dbt Transformations
- **Schedule**: Daily 3 AM UTC (after ingestion)
- **Command**: `dbt build`
- **Image**: Your custom dbt image
- **Dependencies**: PostgreSQL, ingestion must complete

To run jobs manually:
```bash
# Ingestion
kubectl create job ingestion-manual-1 --from=cronjob/ingestion-cronjob -n nhs-ae-analytics

# dbt
kubectl create job dbt-manual-1 --from=cronjob/dbt-cronjob -n nhs-ae-analytics

# View logs
kubectl logs -f job/ingestion-manual-1 -n nhs-ae-analytics
```

---

## 🛠️ Customization

### Resource Limits
Edit deployments to increase/decrease resource requests/limits:
```yaml
resources:
  requests:
    memory: "256Mi"  # Minimum guaranteed
    cpu: "100m"
  limits:
    memory: "512Mi"  # Maximum allowed
    cpu: "500m"
```

### Storage Sizes
Edit `k8s-pvcs.yaml`:
```yaml
resources:
  requests:
    storage: 10Gi  # Increase for larger datasets
```

### Replicas
Edit deployment replicas (or use Kustomize):
```yaml
spec:
  replicas: 3  # Scale Airflow webserver to 3 instances
```

### CronJob Schedules
Edit job schedules in `k8s-jobs.yaml`:
```yaml
schedule: "0 2 * * *"  # 2 AM UTC daily
# Format: minute hour day month day-of-week
# Examples:
# "0 2 * * *"      — Daily 2 AM
# "0 */4 * * *"    — Every 4 hours
# "0 2 * * 1"      — Mondays 2 AM
```

---

## 📈 Monitoring & Debugging

### View Pod Logs
```bash
# Stream logs from deployment
kubectl logs -f deployment/postgres -n nhs-ae-analytics
kubectl logs -f deployment/airflow-webserver -n nhs-ae-analytics

# View logs from specific pod
kubectl logs <pod-name> -n nhs-ae-analytics

# View logs from all containers in a pod
kubectl logs <pod-name> --all-containers=true -n nhs-ae-analytics
```

### Describe Resources
```bash
# Get detailed status of a pod
kubectl describe pod <pod-name> -n nhs-ae-analytics

# Check why a pod failed
kubectl describe pod <pod-name> -n nhs-ae-analytics | grep -A 20 "Events:"
```

### Execute Commands in Running Pod
```bash
# Open a shell in a pod
kubectl exec -it <pod-name> -n nhs-ae-analytics -- /bin/bash

# Run a specific command
kubectl exec <pod-name> -n nhs-ae-analytics -- pg_isready -U nhs
```

### Check Resource Usage
```bash
# View current resource usage
kubectl top pods -n nhs-ae-analytics

# View nodes
kubectl top nodes
```

---

## 🗑️ Cleanup

### Delete Everything
```bash
# Delete entire namespace (removes all resources)
kubectl delete namespace nhs-ae-analytics

# This WILL delete all data volumes as well!
```

### Delete Specific Resources
```bash
# Delete a deployment
kubectl delete deployment airflow-webserver -n nhs-ae-analytics

# Delete a PVC (WARNING: deletes data!)
kubectl delete pvc postgres-pvc -n nhs-ae-analytics

# Delete all jobs
kubectl delete job --all -n nhs-ae-analytics
```

---

## 🔗 Useful Commands

```bash
# Get all resources in namespace
kubectl get all -n nhs-ae-analytics

# Watch pods starting up
kubectl get pods -n nhs-ae-analytics -w

# Get detailed info on all resources
kubectl get all -n nhs-ae-analytics -o wide

# Check pod events
kubectl get events -n nhs-ae-analytics --sort-by='.lastTimestamp'

# Check storage status
kubectl get pvc -n nhs-ae-analytics -o wide

# Check services and their endpoints
kubectl get svc -n nhs-ae-analytics -o wide
kubectl get endpoints -n nhs-ae-analytics

# Tail logs from multiple pods
kubectl logs -f -l app=airflow-webserver -n nhs-ae-analytics --all-containers=true

# Scale a deployment
kubectl scale deployment airflow-webserver --replicas=3 -n nhs-ae-analytics

# Restart a deployment (delete all pods)
kubectl rollout restart deployment/airflow-webserver -n nhs-ae-analytics
```

---

## 📚 References

- **Full Deployment Guide**: See `KUBERNETES_DEPLOYMENT_GUIDE.md`
- **Kubernetes Docs**: https://kubernetes.io/docs/
- **kubectl Cheat Sheet**: https://kubernetes.io/docs/reference/kubectl/cheatsheet/
- **Airflow Helm Chart**: https://airflow.apache.org/docs/helm-chart/
- **MinIO on Kubernetes**: https://docs.min.io/minio/kubernetes/

---

## Troubleshooting Quick Links

| Issue | Command |
|-------|---------|
| Pods stuck in Pending | `kubectl describe pod <name> -n nhs-ae-analytics` |
| Pod CrashLoopBackOff | `kubectl logs <name> -n nhs-ae-analytics` |
| No storage available | `kubectl get storageclass` |
| Database won't connect | `kubectl exec <name> -- psql -h postgres -U nhs -c "SELECT 1"` |
| Out of memory | `kubectl top pods -n nhs-ae-analytics` |

---

Generated for NHS A&E Analytics. See KUBERNETES_DEPLOYMENT_GUIDE.md for complete instructions.
