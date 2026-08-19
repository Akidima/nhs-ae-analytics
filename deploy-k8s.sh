#!/bin/bash
# NHS A&E Analytics — Quick Kubernetes Deployment Script
# Usage: ./deploy-k8s.sh

set -e

NAMESPACE="nhs-ae-analytics"
REGISTRY="${DOCKER_REGISTRY:-docker.io/yourname}"  # Set your registry

echo "🚀 NHS A&E Analytics — Kubernetes Deployment"
echo "==========================================="

# Step 1: Check kubectl
echo "✓ Checking kubectl..."
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Install it first."
    exit 1
fi

CONTEXT=$(kubectl config current-context)
echo "  Using context: $CONTEXT"

# Step 2: Create namespace
echo "✓ Creating namespace..."
kubectl apply -f k8s-namespace.yaml

# Step 3: Label namespace for NetworkPolicy
echo "✓ Labeling namespace..."
kubectl label namespace $NAMESPACE name=$NAMESPACE --overwrite

# Step 4: Apply ConfigMap and Secret
echo "✓ Creating ConfigMap and Secret..."
kubectl apply -f k8s-config-secrets.yaml

# Step 4b: Sync pipeline code into ConfigMaps (emptyDir hid all code before)
echo "✓ Syncing DAGs, ingestion package, and schema registry ConfigMaps..."
kubectl create configmap airflow-dags \
  --from-file=airflow/dags/ \
  -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl create configmap ingestion-code \
  --from-file=ingestion/ \
  -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl create configmap schema-registry \
  --from-file=config/schema_registry/ \
  -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# Step 5: Create PVCs
echo "✓ Creating PersistentVolumeClaims..."
kubectl apply -f k8s-pvcs.yaml

# Step 6: Deploy PostgreSQL
echo "✓ Deploying PostgreSQL..."
kubectl apply -f k8s-postgres.yaml

echo "⏳ Waiting for PostgreSQL to be ready (this may take 1-2 minutes)..."
kubectl wait --for=condition=ready pod -l app=postgres -n $NAMESPACE --timeout=300s

# Step 7: Deploy MinIO and LocalStack
echo "✓ Deploying MinIO..."
kubectl apply -f k8s-minio.yaml

echo "✓ Deploying LocalStack..."
kubectl apply -f k8s-localstack.yaml

# Step 8: Deploy Services
echo "✓ Creating Services..."
kubectl apply -f k8s-services.yaml

# Step 9: Deploy Airflow
echo "✓ Deploying Airflow (Webserver + Scheduler)..."
kubectl apply -f k8s-airflow.yaml

echo "⏳ Waiting for Airflow Webserver to be ready (this may take 2-3 minutes)..."
kubectl wait --for=condition=ready pod -l app=airflow-webserver -n $NAMESPACE --timeout=300s || true

# Step 10: Deploy Jobs
echo "✓ Deploying Jobs and CronJobs..."
kubectl apply -f k8s-jobs.yaml

# Step 11: (Optional) Deploy Ingress
read -p "Deploy Ingress and NetworkPolicy? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    kubectl apply -f k8s-ingress-network.yaml
    echo "✓ Ingress and NetworkPolicy deployed"
fi

echo ""
echo "==========================================="
echo "✅ Deployment Complete!"
echo "==========================================="
echo ""
echo "Next steps:"
echo "1. Verify all pods are running:"
echo "   kubectl get pods -n $NAMESPACE"
echo ""
echo "2. Access Airflow (port-forward):"
echo "   kubectl port-forward svc/airflow-webserver 8080:8080 -n $NAMESPACE"
echo "   Then visit: http://localhost:8080 (admin/admin)"
echo ""
echo "3. Access MinIO (port-forward):"
echo "   kubectl port-forward svc/minio-console 9001:9001 -n $NAMESPACE"
echo "   Then visit: http://localhost:9001"
echo ""
echo "4. View logs:"
echo "   kubectl logs -f deployment/airflow-webserver -n $NAMESPACE"
echo "   kubectl logs -f deployment/postgres -n $NAMESPACE"
echo ""
