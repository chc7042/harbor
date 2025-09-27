#!/bin/bash

# Harbor Deployment Script
# Usage: ./scripts/deploy.sh [environment] [action]
# Environment: dev, staging, prod
# Action: build, deploy, rollback, logs

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_PROJECT_NAME="harbor"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
Harbor Deployment Script

Usage: $0 [environment] [action] [options]

Environments:
  dev       Development environment
  staging   Staging environment
  prod      Production environment

Actions:
  build     Build Docker images
  deploy    Deploy the application
  restart   Restart services
  stop      Stop all services
  logs      Show application logs
  status    Show service status
  rollback  Rollback to previous version
  backup    Create database backup
  restore   Restore database from backup

Options:
  --force           Force rebuild images (ignore cache)
  --no-deps         Don't start dependent services
  --scale=SERVICE=N Scale a service to N replicas
  --verbose         Verbose output
  --help            Show this help message

Examples:
  $0 dev deploy
  $0 prod build --force
  $0 staging logs backend
  $0 prod rollback
  $0 prod backup
EOF
}

# Validate environment
validate_environment() {
    local env=$1
    case $env in
        dev|staging|prod)
            return 0
            ;;
        *)
            log_error "Invalid environment: $env"
            log_error "Valid environments: dev, staging, prod"
            exit 1
            ;;
    esac
}

# Check prerequisites
check_prerequisites() {
    local missing_tools=()

    if ! command -v docker &> /dev/null; then
        missing_tools+=("docker")
    fi

    if ! command -v docker-compose &> /dev/null; then
        missing_tools+=("docker-compose")
    fi

    if [ ${#missing_tools[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_error "Please install the missing tools and try again."
        exit 1
    fi
}

# Load environment configuration
load_environment() {
    local env=$1

    # Set compose file based on environment
    case $env in
        dev)
            export COMPOSE_FILE="docker-compose.yml"
            export ENV_FILE=".env"
            ;;
        staging)
            export COMPOSE_FILE="docker-compose.staging.yml"
            export ENV_FILE=".env.staging"
            ;;
        prod)
            export COMPOSE_FILE="docker-compose.prod.yml"
            export ENV_FILE=".env.prod"
            ;;
    esac

    # Check if environment file exists
    if [ ! -f "$PROJECT_ROOT/$ENV_FILE" ]; then
        log_error "Environment file not found: $ENV_FILE"
        log_error "Please create the environment file based on the example."
        exit 1
    fi

    # Load environment variables
    set -a
    source "$PROJECT_ROOT/$ENV_FILE"
    set +a

    log_info "Loaded environment: $env"
    log_info "Using compose file: $COMPOSE_FILE"
    log_info "Using environment file: $ENV_FILE"
}

# Build Docker images
build_images() {
    local force_build=${1:-false}

    log_info "Building Docker images..."

    local build_args=""
    if [ "$force_build" = true ]; then
        build_args="--no-cache --pull"
        log_warning "Force building images (ignoring cache)"
    fi

    cd "$PROJECT_ROOT"

    # Build backend
    log_info "Building backend image..."
    docker-compose -f "$COMPOSE_FILE" build $build_args backend

    # Build frontend
    log_info "Building frontend image..."
    docker-compose -f "$COMPOSE_FILE" build $build_args frontend

    log_success "Docker images built successfully"
}

# Deploy application
deploy_application() {
    local no_deps=${1:-false}

    log_info "Deploying Harbor application..."

    cd "$PROJECT_ROOT"

    # Create networks and volumes if they don't exist
    docker-compose -f "$COMPOSE_FILE" up --no-start

    # Start services
    local deploy_args=""
    if [ "$no_deps" = true ]; then
        deploy_args="--no-deps"
    fi

    log_info "Starting services..."
    docker-compose -f "$COMPOSE_FILE" up -d $deploy_args

    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    wait_for_health

    log_success "Harbor application deployed successfully"
    show_status
}

# Wait for services to be healthy
wait_for_health() {
    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        local healthy=true

        # Check database health
        if ! docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_isready &> /dev/null; then
            healthy=false
        fi

        # Check backend health
        if ! docker-compose -f "$COMPOSE_FILE" exec -T backend curl -sf http://localhost:3002/api/health &> /dev/null; then
            healthy=false
        fi

        if [ "$healthy" = true ]; then
            log_success "All services are healthy"
            return 0
        fi

        log_info "Waiting for services to be healthy... (attempt $attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done

    log_warning "Some services may not be healthy. Check logs for details."
}

# Show service status
show_status() {
    log_info "Service status:"
    cd "$PROJECT_ROOT"
    docker-compose -f "$COMPOSE_FILE" ps
}

# Show logs
show_logs() {
    local service=${1:-""}
    local follow=${2:-false}

    cd "$PROJECT_ROOT"

    if [ -n "$service" ]; then
        log_info "Showing logs for service: $service"
        if [ "$follow" = true ]; then
            docker-compose -f "$COMPOSE_FILE" logs -f "$service"
        else
            docker-compose -f "$COMPOSE_FILE" logs --tail=100 "$service"
        fi
    else
        log_info "Showing logs for all services"
        if [ "$follow" = true ]; then
            docker-compose -f "$COMPOSE_FILE" logs -f
        else
            docker-compose -f "$COMPOSE_FILE" logs --tail=100
        fi
    fi
}

# Stop services
stop_services() {
    log_info "Stopping Harbor services..."
    cd "$PROJECT_ROOT"
    docker-compose -f "$COMPOSE_FILE" down
    log_success "Services stopped"
}

# Restart services
restart_services() {
    log_info "Restarting Harbor services..."
    cd "$PROJECT_ROOT"
    docker-compose -f "$COMPOSE_FILE" restart
    wait_for_health
    log_success "Services restarted"
}

# Create backup
create_backup() {
    local backup_name="harbor_backup_$(date +%Y%m%d_%H%M%S)"
    local backup_dir="$PROJECT_ROOT/backups"

    log_info "Creating backup: $backup_name"

    # Create backup directory
    mkdir -p "$backup_dir"

    cd "$PROJECT_ROOT"

    # Database backup
    log_info "Creating database backup..."
    docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" | \
        gzip > "$backup_dir/${backup_name}_db.sql.gz"

    # Application logs backup
    log_info "Creating logs backup..."
    docker-compose -f "$COMPOSE_FILE" logs --no-color > "$backup_dir/${backup_name}_logs.txt"

    # Configuration backup
    log_info "Creating configuration backup..."
    tar -czf "$backup_dir/${backup_name}_config.tar.gz" \
        "$ENV_FILE" \
        "nginx/" \
        "database/" \
        2>/dev/null || true

    log_success "Backup created: $backup_name"
    log_info "Backup location: $backup_dir"
}

# Restore from backup
restore_backup() {
    local backup_file=$1

    if [ -z "$backup_file" ]; then
        log_error "Backup file not specified"
        log_info "Available backups:"
        ls -la "$PROJECT_ROOT/backups/" | grep "_db.sql.gz" || log_warning "No backups found"
        exit 1
    fi

    if [ ! -f "$backup_file" ]; then
        log_error "Backup file not found: $backup_file"
        exit 1
    fi

    log_warning "This will overwrite the current database!"
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Restore cancelled"
        exit 0
    fi

    log_info "Restoring database from: $backup_file"

    cd "$PROJECT_ROOT"

    # Stop application services
    docker-compose -f "$COMPOSE_FILE" stop backend frontend

    # Restore database
    gunzip -c "$backup_file" | \
        docker-compose -f "$COMPOSE_FILE" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME"

    # Restart services
    docker-compose -f "$COMPOSE_FILE" start backend frontend

    wait_for_health

    log_success "Database restored successfully"
}

# Rollback to previous version
rollback() {
    log_info "Rolling back to previous version..."

    # This is a simplified rollback - in production you might want to:
    # 1. Pull previous image tags
    # 2. Update compose file to use previous tags
    # 3. Redeploy

    cd "$PROJECT_ROOT"

    # Stop current services
    docker-compose -f "$COMPOSE_FILE" down

    # Remove current images (forces pull of previous versions)
    docker-compose -f "$COMPOSE_FILE" pull

    # Redeploy
    deploy_application

    log_success "Rollback completed"
}

# Scale services
scale_services() {
    local scale_args=$1

    log_info "Scaling services: $scale_args"

    cd "$PROJECT_ROOT"
    docker-compose -f "$COMPOSE_FILE" up -d --scale $scale_args

    wait_for_health
    log_success "Services scaled successfully"
}

# Main function
main() {
    local environment=""
    local action=""
    local force_build=false
    local no_deps=false
    local verbose=false
    local scale_args=""
    local service=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --help|-h)
                show_help
                exit 0
                ;;
            --force)
                force_build=true
                shift
                ;;
            --no-deps)
                no_deps=true
                shift
                ;;
            --scale=*)
                scale_args="${1#*=}"
                shift
                ;;
            --verbose|-v)
                verbose=true
                set -x
                shift
                ;;
            dev|staging|prod)
                environment=$1
                shift
                ;;
            build|deploy|restart|stop|logs|status|rollback|backup|restore)
                action=$1
                shift
                ;;
            *)
                if [ -z "$service" ] && [ "$action" = "logs" ]; then
                    service=$1
                elif [ "$action" = "restore" ] && [ -z "$backup_file" ]; then
                    backup_file=$1
                else
                    log_error "Unknown argument: $1"
                    show_help
                    exit 1
                fi
                shift
                ;;
        esac
    done

    # Validate arguments
    if [ -z "$environment" ]; then
        log_error "Environment not specified"
        show_help
        exit 1
    fi

    if [ -z "$action" ]; then
        log_error "Action not specified"
        show_help
        exit 1
    fi

    # Check prerequisites
    check_prerequisites

    # Validate environment
    validate_environment "$environment"

    # Load environment configuration
    load_environment "$environment"

    # Execute action
    case $action in
        build)
            build_images "$force_build"
            ;;
        deploy)
            build_images "$force_build"
            deploy_application "$no_deps"
            ;;
        restart)
            restart_services
            ;;
        stop)
            stop_services
            ;;
        logs)
            show_logs "$service" true
            ;;
        status)
            show_status
            ;;
        rollback)
            rollback
            ;;
        backup)
            create_backup
            ;;
        restore)
            restore_backup "$backup_file"
            ;;
        scale)
            if [ -z "$scale_args" ]; then
                log_error "Scale arguments not specified. Use --scale=service=N"
                exit 1
            fi
            scale_services "$scale_args"
            ;;
        *)
            log_error "Unknown action: $action"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"