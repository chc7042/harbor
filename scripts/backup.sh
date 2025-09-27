#!/bin/bash

# Harbor Backup Script
# Creates automated backups of database, logs, and configuration

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_ROOT}/backups"
COMPOSE_PROJECT_NAME="harbor"

# Default configuration
DEFAULT_RETENTION_DAYS=30
DEFAULT_BACKUP_TYPE="full"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Help function
show_help() {
    cat << EOF
Harbor Backup Script

Usage: $0 [options]

Options:
  --type TYPE           Backup type: full, db, logs, config (default: full)
  --retention DAYS      Number of days to keep backups (default: 30)
  --output DIR          Output directory (default: ./backups)
  --compress            Compress backup files
  --encrypt             Encrypt backup files (requires gpg)
  --environment ENV     Environment: dev, staging, prod (default: auto-detect)
  --verbose             Verbose output
  --help                Show this help message

Backup Types:
  full      Complete backup (database + logs + config)
  db        Database only
  logs      Application logs only
  config    Configuration files only

Examples:
  $0 --type full --retention 7
  $0 --type db --compress --encrypt
  $0 --environment prod --output /backup/harbor
EOF
}

# Load environment configuration
load_environment() {
    local env=${1:-"auto"}

    if [ "$env" = "auto" ]; then
        # Auto-detect environment
        if [ -f "$PROJECT_ROOT/.env.prod" ]; then
            env="prod"
        elif [ -f "$PROJECT_ROOT/.env.staging" ]; then
            env="staging"
        else
            env="dev"
        fi
    fi

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
        *)
            log_error "Invalid environment: $env"
            exit 1
            ;;
    esac

    if [ -f "$PROJECT_ROOT/$ENV_FILE" ]; then
        set -a
        source "$PROJECT_ROOT/$ENV_FILE"
        set +a
        log_info "Loaded environment: $env"
    else
        log_warning "Environment file not found: $ENV_FILE"
    fi
}

# Create backup directory
create_backup_dir() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_name="harbor_backup_${timestamp}"

    CURRENT_BACKUP_DIR="${BACKUP_DIR}/${backup_name}"

    mkdir -p "$CURRENT_BACKUP_DIR"
    log_info "Created backup directory: $CURRENT_BACKUP_DIR"

    echo "$backup_name"
}

# Database backup
backup_database() {
    local backup_name=$1
    local compress=${2:-false}
    local encrypt=${3:-false}

    log_info "Starting database backup..."

    local db_file="${CURRENT_BACKUP_DIR}/database.sql"

    cd "$PROJECT_ROOT"

    # Check if database container is running
    if ! docker-compose -f "$COMPOSE_FILE" ps postgres | grep -q "Up"; then
        log_error "Database container is not running"
        return 1
    fi

    # Create database dump
    docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_dump \
        -U "${DB_USER:-harbor_user}" \
        -d "${DB_NAME:-harbor_prod}" \
        --verbose \
        --no-owner \
        --no-privileges \
        > "$db_file"

    if [ $? -eq 0 ]; then
        log_success "Database backup completed: $(basename "$db_file")"

        # Compress if requested
        if [ "$compress" = true ]; then
            gzip "$db_file"
            db_file="${db_file}.gz"
            log_info "Database backup compressed: $(basename "$db_file")"
        fi

        # Encrypt if requested
        if [ "$encrypt" = true ]; then
            encrypt_file "$db_file"
        fi

        # Create checksum
        sha256sum "$db_file" > "${db_file}.sha256"

    else
        log_error "Database backup failed"
        return 1
    fi
}

# Logs backup
backup_logs() {
    local backup_name=$1
    local compress=${2:-false}

    log_info "Starting logs backup..."

    local logs_dir="${CURRENT_BACKUP_DIR}/logs"
    mkdir -p "$logs_dir"

    cd "$PROJECT_ROOT"

    # Export Docker container logs
    local services=("backend" "frontend" "postgres" "redis" "nginx")

    for service in "${services[@]}"; do
        if docker-compose -f "$COMPOSE_FILE" ps "$service" | grep -q "Up"; then
            local log_file="${logs_dir}/${service}.log"
            docker-compose -f "$COMPOSE_FILE" logs --no-color "$service" > "$log_file" 2>/dev/null

            if [ -s "$log_file" ]; then
                log_info "Exported logs for service: $service"
            else
                rm -f "$log_file"
                log_warning "No logs found for service: $service"
            fi
        else
            log_warning "Service not running: $service"
        fi
    done

    # Copy application logs if they exist
    if [ -d "./logs" ]; then
        cp -r ./logs/* "$logs_dir/" 2>/dev/null || true
        log_info "Copied application log files"
    fi

    # Copy nginx logs if available
    if docker volume ls | grep -q "nginx_logs"; then
        docker run --rm -v nginx_logs:/logs:ro -v "$logs_dir":/backup alpine \
            sh -c 'cp -r /logs/* /backup/ 2>/dev/null || true'
        log_info "Copied nginx log files"
    fi

    # Compress logs directory
    if [ "$compress" = true ]; then
        tar -czf "${logs_dir}.tar.gz" -C "$CURRENT_BACKUP_DIR" logs
        rm -rf "$logs_dir"
        log_info "Logs backup compressed: logs.tar.gz"
    fi

    log_success "Logs backup completed"
}

# Configuration backup
backup_config() {
    local backup_name=$1
    local compress=${2:-false}

    log_info "Starting configuration backup..."

    local config_dir="${CURRENT_BACKUP_DIR}/config"
    mkdir -p "$config_dir"

    cd "$PROJECT_ROOT"

    # Configuration files to backup
    local config_files=(
        "$ENV_FILE"
        "docker-compose*.yml"
        "Dockerfile*"
        "nginx/"
        "database/init.sql"
        "scripts/"
        "package.json"
        "backend/package.json"
        "frontend/package.json"
    )

    for item in "${config_files[@]}"; do
        if [ -e "$item" ]; then
            if [ -d "$item" ]; then
                cp -r "$item" "$config_dir/"
            else
                cp "$item" "$config_dir/" 2>/dev/null || true
            fi
            log_info "Backed up: $item"
        fi
    done

    # Create environment info
    cat > "${config_dir}/backup_info.txt" << EOF
Backup Information
==================
Timestamp: $(date)
Environment: ${NODE_ENV:-unknown}
Git Commit: $(git rev-parse HEAD 2>/dev/null || echo "unknown")
Git Branch: $(git branch --show-current 2>/dev/null || echo "unknown")
Docker Version: $(docker --version 2>/dev/null || echo "unknown")
Docker Compose Version: $(docker-compose --version 2>/dev/null || echo "unknown")

Environment Variables:
$(env | grep -E '^(DB_|LDAP_|JWT_|REDIS_)' | sort || echo "No relevant environment variables found")
EOF

    # Compress config directory
    if [ "$compress" = true ]; then
        tar -czf "${config_dir}.tar.gz" -C "$CURRENT_BACKUP_DIR" config
        rm -rf "$config_dir"
        log_info "Configuration backup compressed: config.tar.gz"
    fi

    log_success "Configuration backup completed"
}

# Encrypt file
encrypt_file() {
    local file=$1

    if ! command -v gpg &> /dev/null; then
        log_warning "GPG not available, skipping encryption"
        return 0
    fi

    if [ -z "${BACKUP_GPG_RECIPIENT:-}" ]; then
        log_warning "BACKUP_GPG_RECIPIENT not set, skipping encryption"
        return 0
    fi

    log_info "Encrypting file: $(basename "$file")"

    gpg --trust-model always --encrypt \
        --recipient "$BACKUP_GPG_RECIPIENT" \
        --output "${file}.gpg" \
        "$file"

    if [ $? -eq 0 ]; then
        rm "$file"
        log_info "File encrypted and original removed"
    else
        log_error "Encryption failed"
        return 1
    fi
}

# Clean old backups
cleanup_old_backups() {
    local retention_days=$1

    log_info "Cleaning up backups older than $retention_days days..."

    if [ ! -d "$BACKUP_DIR" ]; then
        log_info "No backup directory found, nothing to clean"
        return 0
    fi

    local deleted=0

    find "$BACKUP_DIR" -maxdepth 1 -type d -name "harbor_backup_*" -mtime +$retention_days | while read -r backup_dir; do
        log_info "Removing old backup: $(basename "$backup_dir")"
        rm -rf "$backup_dir"
        ((deleted++))
    done

    if [ $deleted -eq 0 ]; then
        log_info "No old backups found"
    else
        log_success "Removed $deleted old backups"
    fi
}

# Create backup manifest
create_manifest() {
    local backup_name=$1

    local manifest_file="${CURRENT_BACKUP_DIR}/manifest.json"

    cat > "$manifest_file" << EOF
{
  "backup_name": "$backup_name",
  "timestamp": "$(date -Iseconds)",
  "environment": "${NODE_ENV:-unknown}",
  "version": "$(git rev-parse HEAD 2>/dev/null || echo unknown)",
  "files": [
$(find "$CURRENT_BACKUP_DIR" -type f ! -name "manifest.json" -printf '    "%P",\n' | sed '$ s/,$//')
  ],
  "size": "$(du -sh "$CURRENT_BACKUP_DIR" | cut -f1)",
  "checksum": "$(find "$CURRENT_BACKUP_DIR" -type f ! -name "manifest.json" -exec sha256sum {} \; | sha256sum | cut -d' ' -f1)"
}
EOF

    log_info "Created backup manifest: manifest.json"
}

# Main backup function
main() {
    local backup_type="$DEFAULT_BACKUP_TYPE"
    local retention_days="$DEFAULT_RETENTION_DAYS"
    local compress=false
    local encrypt=false
    local environment="auto"
    local verbose=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --type)
                backup_type="$2"
                shift 2
                ;;
            --retention)
                retention_days="$2"
                shift 2
                ;;
            --output)
                BACKUP_DIR="$2"
                shift 2
                ;;
            --compress)
                compress=true
                shift
                ;;
            --encrypt)
                encrypt=true
                shift
                ;;
            --environment)
                environment="$2"
                shift 2
                ;;
            --verbose|-v)
                verbose=true
                set -x
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown argument: $1"
                show_help
                exit 1
                ;;
        esac
    done

    # Validate backup type
    case $backup_type in
        full|db|logs|config)
            ;;
        *)
            log_error "Invalid backup type: $backup_type"
            log_error "Valid types: full, db, logs, config"
            exit 1
            ;;
    esac

    # Load environment
    load_environment "$environment"

    # Create backup directory
    local backup_name=$(create_backup_dir)

    log_info "Starting $backup_type backup: $backup_name"

    # Perform backup based on type
    case $backup_type in
        full)
            backup_database "$backup_name" "$compress" "$encrypt"
            backup_logs "$backup_name" "$compress"
            backup_config "$backup_name" "$compress"
            ;;
        db)
            backup_database "$backup_name" "$compress" "$encrypt"
            ;;
        logs)
            backup_logs "$backup_name" "$compress"
            ;;
        config)
            backup_config "$backup_name" "$compress"
            ;;
    esac

    # Create manifest
    create_manifest "$backup_name"

    # Clean old backups
    cleanup_old_backups "$retention_days"

    # Final backup size
    local backup_size=$(du -sh "$CURRENT_BACKUP_DIR" | cut -f1)

    log_success "Backup completed successfully!"
    log_info "Backup name: $backup_name"
    log_info "Backup size: $backup_size"
    log_info "Backup location: $CURRENT_BACKUP_DIR"

    if [ "$backup_type" = "full" ]; then
        log_info "Full backup includes: database, logs, and configuration"
    fi
}

# Run main function
main "$@"