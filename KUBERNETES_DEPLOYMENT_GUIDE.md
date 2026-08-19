# NHS A&E Analytics — Kubernetes Deployment Guide

## Overview

This deployment converts your Docker Compose stack to production-grade Kubernetes manifests. The stack includes:

- **PostgreSQL** (StatefulSet) — Analytics warehouse + Airflow metadata DB
- **MinIO** (Deployment) — S3-compatible object storage (raw zone)
- **LocalStack** (Deployment) — AWS service emulator (Terraform support)
- **Airflow Webserver** (Deployment) — DAG orchestration UI
- **Airflow Scheduler** (Deployment) — DAG execution engine
- **Ingestion Pipeline** (Job + CronJob) — On-demand data ingestion
- **dbt** (Job + CronJob) — Scheduled data transformations

---

## File Structure

```
k8s-namespace.yaml              # Create the nhs-ae-analytics namespace
k8s-config-secrets.yaml         # ConfigMap + Secret (credentials)
k8s-pvcs.yaml                   # PersistentVolumeClaims for data
k8s-services.yaml               # Services (ClusterIP, LoadBalancer)
k8s-postgres.yaml               # PostgreSQL StatefulSet
k8s-minio.yaml                  # MinIO Deployment + init
k8s-localstack.yaml             # LocalStack Deployment
k8s-airflow.yaml                # Airflow Webserver + Scheduler Deployments
k8s-jobs.yaml                   # Ingestion + dbt Jobs + CronJobs
k8s-ingress-network.yaml        # Ingress + NetworkPolicy (optional)
```

---

## Prerequisites

1. **Kubernetes cluster** (1.20+): EKS, GKE, AKS, or local (minikube, kind)
2. **kubectl** CLI installed and configured
3. **Docker registry** (DockerHub, ECR, GCR, etc.) for custom images
4. **Storage class** available in your cluster (check: `kubectl get storageclass`)

### Check your cluster:
```bash
kubectl cluster-info
kubectl get nodes
kubectl get storageclass
```

---

## Step 1: Build and Push Custom Images

You must build the `ingestion` and `dbt` images and push them to your registry.

### Build images:
```bash
# Build ingestion image
docker build -f docker/ingestion.Dockerfile -t your-registry/nhs-ae-analytics:ingestion .

# Build dbt image
docker build -f docker/dbt.Dockerfile -t your-registry/nhs-ae-analytics:dbt .
```

### Push to registry (example: DockerHub):
```bash
docker push your-registry/nhs-ae-analytics:ingestion
docker push your-registry/nhs-ae-analytics:dbt
```

### Update k8s-jobs.yaml:
Replace `nhs-ae-analytics:ingestion` and `nhs-ae-analytics:dbt` with your full image paths:
```yaml
image: your-registry/nhs-ae-analytics:ingestion
image: your-registry/nhs-ae-analytics:dbt
```

---

## Step 2: Update Secrets in k8s-config-secrets.yaml

**CRITICAL:** Never commit real credentials to version control.

Edit `k8s-config-secrets.yaml` and replace placeholder values:

```yaml
stringData:
  AIRFLOW__CORE__FERNET_KEY: "your-generated-fernet-key"  # Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  POSTGRES_PASSWORD: "your-strong-password"
  MINIO_ROOT_PASSWORD: "your-strong-password"
  AIRFLOW_WWW_USER_PASSWORD: "your-airflow-password"
  LOCALSTACK_AUTH_TOKEN: "your-localstack-token"
```

### Generate Fernet key:
```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### Production best practice:
Use external secret management instead:
- **AWS**: AWS Secrets Manager + external-secrets operator
- **Azure**: Azure Key Vault
- **GCP**: Google Secret Manager
- **Generic**: HashiCorp Vault

---

## Step 3: Adjust Storage Classes and PVC Sizes

Edit `k8s-pvcs.yaml` to match your cluster's storage:

```yaml
storageClassName: standard  # Change to your storage class name
resources:
  requests:
    storage: 10Gi  # Adjust for your data volume
```

Find available storage classes:
```bash
kubectl get storageclass
```

---

## Step 4: Deploy to Kubernetes

Deploy all manifests in order (namespace first, then dependencies):

```bash
# 1. Create namespace
kubectl apply -f k8s-namespace.yaml

# 2. Create ConfigMap and Secret
kubectl apply -f k8s-config-secrets.yaml

# 3. Create PersistentVolumeClaims
kubectl apply -f k8s-pvcs.yaml

# 4. Deploy PostgreSQL (wait for it to be ready)
kubectl apply -f k8s-postgres.yaml
kubectl wait --for=condition=ready pod -l app=postgres -n nhs-ae-analytics --timeout=300s

# 5. Deploy MinIO and LocalStack
kubectl apply -f k8s-minio.yaml
kubectl apply -f k8s-localstack.yaml

# 6. Deploy Services
kubectl apply -f k8s-services.yaml

# 7. Deploy Airflow
kubectl apply -f k8s-airflow.yaml

# 8. Deploy Jobs and CronJobs
kubectl apply -f k8s-jobs.yaml

# 9. (Optional) Deploy Ingress and NetworkPolicy
kubectl apply -f k8s-ingress-network.yaml
```

Or deploy everything at once:
```bash
kubectl apply -f k8s-*.yaml
```

---

## Step 5: Verify Deployment

### Check all pods are running:
```bash
kubectl get pods -n nhs-ae-analytics
kubectl get pods -n nhs-ae-analytics -w  # Watch for completion
```

### Check services:
```bash
kubectl get svc -n nhs-ae-analytics
```

### Check persistent volumes:
```bash
kubectl get pvc -n nhs-ae-analytics
```

### Check for errors:
```bash
kubectl logs -f deployment/postgres -n nhs-ae-analytics
kubectl logs -f deployment/airflow-webserver -n nhs-ae-analytics
kubectl logs -f deployment/minio -n nhs-ae-analytics
```

---

## Step 6: Access Applications

### Airflow Webserver (port 8080)

**Local access (port-forward):**
```bash
kubectl port-forward svc/airflow-webserver 8080:8080 -n nhs-ae-analytics
# Visit: http://localhost:8080
# Login: admin / admin
```

**Via LoadBalancer (if exposed):**
```bash
kubectl get svc -n nhs-ae-analytics | grep airflow
# Get EXTERNAL-IP and visit http://EXTERNAL-IP:8080
```

### MinIO Console (port 9001)

**Local access (port-forward):**
```bash
kubectl port-forward svc/minio-console 9001:9001 -n nhs-ae-analytics
# Visit: http://localhost:9001
# Login: minioadmin / your-password
```

### PostgreSQL (port 5432)

**Local access (port-forward):**
```bash
kubectl port-forward svc/postgres 5432:5432 -n nhs-ae-analytics
# Connect: psql -h localhost -U nhs -d nhs_ae
```

### LocalStack (port 4566)

**Local access (port-forward):**
```bash
kubectl port-forward svc/localstack 4566:4566 -n nhs-ae-analytics
# Terraform/AWS CLI can now connect to http://localhost:4566
```

---

## Step 7: Run Jobs Manually

### Run ingestion job once:
```bash
kubectl create job --from=cronjob/ingestion-cronjob ingestion-manual-1 -n nhs-ae-analytics
kubectl logs -f job/ingestion-manual-1 -n nhs-ae-analytics
```

### Run dbt job once:
```bash
kubectl create job --from=cronjob/dbt-cronjob dbt-manual-1 -n nhs-ae-analytics
kubectl logs -f job/dbt-manual-1 -n nhs-ae-analytics
```

### Check job status:
```bash
kubectl get jobs -n nhs-ae-analytics
kubectl describe job ingestion-manual-1 -n nhs-ae-analytics
```

---

## Step 8: View Logs

### Stream all pod logs:
```bash
kubectl logs -f deployment/airflow-webserver -n nhs-ae-analytics
kubectl logs -f deployment/airflow-scheduler -n nhs-ae-analytics
kubectl logs -f deployment/postgres -n nhs-ae-analytics
```

### View logs from a specific pod:
```bash
kubectl get pods -n nhs-ae-analytics  # Get pod names
kubectl logs <pod-name> -n nhs-ae-analytics
```

### Follow logs in real-time:
```bash
kubectl logs -f <pod-name> -n nhs-ae-analytics
```

---

## Step 9: (Production) Configure Ingress

Replace placeholder domains in `k8s-ingress-network.yaml`:
```yaml
- host: airflow.example.com  # Your actual domain
- host: minio.example.com    # Your actual domain
```

Then:
```bash
kubectl apply -f k8s-ingress-network.yaml
```

Ensure your ingress controller is installed:
```bash
kubectl get ingressclass
```

---

## Step 10: (Production) Configure External Secrets

Instead of Secrets in YAML, use a secret manager:

### AWS Secrets Manager example:
1. Store credentials in AWS Secrets Manager
2. Install external-secrets operator:
   ```bash
   helm repo add external-secrets https://charts.external-secrets.io
   helm install external-secrets external-secrets/external-secrets -n external-secrets-system --create-namespace
   ```
3. Create a SecretStore referencing AWS Secrets Manager
4. Replace Secrets in manifests with ExternalSecrets

---

## Troubleshooting

### Pods stuck in Pending:
```bash
kubectl describe pod <pod-name> -n nhs-ae-analytics
# Check events section for PVC/storage issues
```

### CrashLoopBackOff:
```bash
kubectl logs <pod-name> -n nhs-ae-analytics
# Check for env var or config errors
```

### PostgreSQL won't start:
```bash
kubectl logs deployment/postgres -n nhs-ae-analytics
# Check PVC is bound and storage is available
kubectl get pvc -n nhs-ae-analytics
```

### Airflow can't connect to PostgreSQL:
```bash
kubectl exec -it deployment/airflow-webserver -n nhs-ae-analytics -- bash
# Inside pod:
psql -h postgres -U nhs -d nhs_ae  # Test connection
```

### MinIO init pod failing:
```bash
kubectl logs deployment/minio-init -n nhs-ae-analytics
# Check if minio pod is running first
kubectl logs deployment/minio -n nhs-ae-analytics
```

---

## Cleanup

### Delete entire namespace (destroys all resources):
```bash
kubectl delete namespace nhs-ae-analytics
```

### Delete specific resources:
```bash
kubectl delete deployment airflow-webserver -n nhs-ae-analytics
kubectl delete pvc postgres-pvc -n nhs-ae-analytics  # Destroys data!
```

---

## Resource Limits

Current manifests specify modest limits. For production, adjust based on your workload:

```yaml
resources:
  requests:      # Minimum guaranteed
    memory: "256Mi"
    cpu: "100m"
  limits:        # Maximum allowed
    memory: "512Mi"
    cpu: "500m"
```

Scale these up for:
- **PostgreSQL**: Large analytical queries → 2Gi memory, 1 CPU
- **Airflow Scheduler**: Many DAGs → 1Gi memory, 1 CPU
- **MinIO**: High throughput → 1Gi+ memory, 1+ CPU

---

## Key Differences from Docker Compose

| Aspect | Docker Compose | Kubernetes |
|--------|---|---|
| **Config** | .env file | ConfigMap + Secret |
| **Persistence** | Named volumes | PersistentVolumeClaim (PVC) |
| **Networking** | service names | Service DNS names |
| **Init tasks** | depends_on, healthcheck | initContainers |
| **On-demand jobs** | docker compose run | Job / CronJob |
| **Scaling** | Manual restart | Replica scaling |
| **Secrets** | Plain text .env | Secret resource + external managers |

---

## Next Steps

1. ✅ Customize secrets in `k8s-config-secrets.yaml`
2. ✅ Build and push custom images
3. ✅ Adjust PVC sizes and storage class
4. ✅ Deploy all manifests
5. ✅ Verify pods are running
6. ✅ Access Airflow UI and MinIO console
7. ✅ Test ingestion and dbt jobs
8. ✅ Set up Ingress for production access
9. ✅ Implement external secrets management
10. ✅ Configure monitoring (Prometheus, Grafana, etc.)

---

## References

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [kubectl Cheat Sheet](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
- [Airflow Helm Chart](https://airflow.apache.org/docs/helm-chart/)
- [MinIO Deployment Guide](https://docs.min.io/minio/kubernetes/)
