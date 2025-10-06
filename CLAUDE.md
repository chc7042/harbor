# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Harbor is a Jenkins NAS deployment history management system with a React frontend and Node.js/Express backend. The system tracks deployment artifacts, provides real-time updates via WebSockets, and integrates with LDAP authentication.

## Development Commands

### Backend (Node.js/Express)
```bash
cd backend
npm run dev              # Start development server with nodemon
npm run start           # Start production server
npm run test            # Run Jest tests
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Run tests with coverage report
npm run lint            # Run ESLint
npm run lint:fix        # Fix ESLint issues
npm run health          # Run health check
```

### Frontend (React/Vite)
```bash
cd frontend
npm run dev             # Start Vite development server (port 5173)
npm run build           # Build for production
npm run preview         # Preview production build
npm run test            # Run Vitest tests
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Run tests with coverage
npm run lint            # Run ESLint
npm run lint:fix        # Fix ESLint issues
```

### Full System (Monorepo Commands)
```bash
# Start both backend and frontend in development
npm run dev             # Runs both backend and frontend concurrently
npm run install:all     # Install dependencies for both workspaces
npm run build          # Build both backend and frontend
npm run test           # Run tests for both workspaces
npm run lint           # Lint both workspaces
npm run lint:fix       # Fix lint issues in both workspaces
npm run typecheck      # Run type checking for both workspaces
npm run clean          # Clean all build artifacts and node_modules

# Database operations
npm run db:migrate      # Run database migrations
npm run db:seed        # Seed database with test data
npm run db:reset       # Reset database

# Docker operations
npm run docker:dev     # Start development environment with Docker
npm run docker:prod    # Start production environment with Docker
npm run docker:stop    # Stop Docker containers
npm run docker:logs    # View Docker logs
```

## System Architecture

### Monorepo Structure
Harbor uses npm workspaces for managing the monorepo:
- **Root workspace**: Shared scripts, dependencies, and configuration
- **Backend workspace**: Express.js API server with LDAP authentication
- **Frontend workspace**: React/Vite SPA with Tailwind CSS
- **Shared tooling**: ESLint, Prettier, Husky, CommitLint across all workspaces

### Backend Structure
- **Express API Server**: Main application server with JWT authentication
- **LDAP Integration**: User authentication via LDAP directory
- **PostgreSQL Database**: Main data persistence layer
- **WebSocket Manager**: Real-time communication for deployment updates
- **NAS Scanner Service**: File system monitoring and deployment artifact tracking
- **Jenkins Webhook Handler**: Receives deployment notifications from Jenkins

### Authentication Flow
1. LDAP authentication validates user credentials
2. JWT tokens issued for API access (access + refresh token pattern)
3. Session management with PostgreSQL storage
4. WebSocket connections authenticated via JWT query parameter

### Real-time Architecture
- WebSocket server runs on same port as HTTP server (`/ws` path)
- Room-based subscriptions (user-specific and global channels)
- Heartbeat mechanism for connection health
- Automatic reconnection logic in frontend

### Database Schema
Key tables managed via migrations in `/database/migrations/`:
- `deployments`: Deployment records and status tracking
- `users`: User information synchronized from LDAP
- `user_sessions`: JWT refresh token management
- `audit_logs`: Security and access logging
- `nas_files`: NAS file system metadata and indexing

## Environment Configuration

### Required Environment Variables

**Backend (.env)**:
```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=jenkins_nas_deployment
DB_USER=postgres
DB_PASSWORD=password

# JWT Authentication
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-refresh-secret
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=8h

# LDAP Configuration
LDAP_URL=ldap://your-ldap-server:389
LDAP_BIND_DN=cn=admin,dc=company,dc=com
LDAP_BIND_CREDENTIALS=ldap-password
LDAP_SEARCH_BASE=ou=users,dc=company,dc=com

# Server Configuration
PORT=3002                    # Backend API port
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

**Frontend (.env)**:
```bash
VITE_API_URL=http://localhost:3002
VITE_WS_URL=ws://localhost:3002
```

## Key Development Patterns

### API Route Structure
All API routes follow consistent patterns:
- Authentication middleware applied at router level
- Input validation using express-validator
- Swagger/OpenAPI documentation with JSDoc comments
- Standardized error handling and response formatting

### WebSocket Communication
- Client authentication via JWT token in query string
- Room-based pub/sub pattern for targeted updates
- Message types: `deployment_update`, `system_notification`, `heartbeat`
- Automatic reconnection with exponential backoff

### Database Integration
- Connection pooling with pg (PostgreSQL)
- Transaction helpers for complex operations
- Migration system for schema management
- Development mode graceful degradation when DB unavailable

### NAS File Monitoring
- Chokidar-based file system watching
- SHA-256 hash calculation for file integrity
- Mock directory creation in development mode
- Scheduled scanning with cron expressions

## Frontend Architecture

### Component Organization
- **Pages**: Top-level route components (`/src/pages/`)
- **Components**: Reusable UI components with Tailwind CSS
- **Services**: API communication and WebSocket management
- **Hooks**: Custom React hooks for common functionality
- **Contexts**: Global state management

### Key Frontend Services
- `apiService.js`: Axios-based API client with interceptors
- `websocketService.js`: WebSocket client with reconnection
- `notificationService.js`: Browser notification integration

### UI Component Patterns
- **UserAvatar**: Gravatar integration with fallback to user initials using crypto-js for MD5 hashing
- **Modal Components**: Consistent modal patterns for deployment details, project information
- **Real-time Updates**: Components automatically refresh via WebSocket subscriptions
- **Loading States**: Unified loading patterns with skeleton screens and spinners

### Styling Approach
- Tailwind CSS for utility-first styling
- "New York" design system implementation
- Responsive design with mobile-first approach
- Chart.js integration for deployment analytics

## Testing Strategy

### Backend Testing
- Jest for unit and integration tests
- Supertest for API endpoint testing
- LDAP and database mocking in test environment
- Coverage reporting with thresholds

### Frontend Testing
- Vitest for unit testing with jsdom
- React Testing Library for component testing
- MSW (Mock Service Worker) for API mocking

## Production Deployment

### Docker Configuration
- Multi-stage builds for optimized images
- Separate containers for backend/frontend
- PostgreSQL and monitoring stack via docker-compose
- Health checks and restart policies

### Monitoring Stack
- Prometheus for metrics collection
- Grafana for dashboards and visualization
- Loki for centralized logging
- AlertManager for notification rules

## Development Server Startup

When starting the development environment:

1. **Backend** starts on port 3002 with hot reload via nodemon
2. **Frontend** starts on port 5173 with Vite proxy to backend
3. **Database** connection failures are gracefully handled in development
4. **LDAP** authentication can be tested with provided test credentials
5. **WebSocket** connections established automatically on frontend login

The system includes comprehensive error handling for missing dependencies, allowing development without full infrastructure setup.

## Development Conventions

### Code Quality and Formatting
- **ESLint**: Enforced across frontend and backend with consistent rules
- **Prettier**: Automatic code formatting for JS, JSX, JSON, and Markdown
- **Husky**: Git hooks for pre-commit linting and commit message validation
- **lint-staged**: Runs linting and formatting only on staged files

### Commit Message Convention
Uses conventional commits with CommitLint enforcement:
- `feat:` - New features
- `fix:` - Bug fixes  
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `test:` - Test additions or changes
- `build:` - Build system changes
- `ci:` - CI configuration changes
- `chore:` - Maintenance tasks

### Important Files and Directories
- `database/migrations/` - PostgreSQL schema migrations
- `monitoring/` - Prometheus, Grafana, and logging configurations  
- `scripts/` - Development and deployment automation scripts
- `docs/` - Project documentation and specifications
- `.env.example` - Environment variable templates for development
- `.env.prod.example` - Production environment configuration template

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.

## Critical Production Environment Rules
- **ALWAYS ask before changing production configurations**
- **NEVER switch to mock authentication without explicit permission**
- **NEVER ignore environment variable settings in .env files**
- **ALWAYS use the credentials and settings specified in the project configuration**
- **PRODUCTION MEANS PRODUCTION - do not make arbitrary changes**
- **When testing fails, ask for guidance instead of making assumptions**

## Authentication Configuration
- **Primary test account**: admin/admin (as specified in .env)
- **Jenkins integration account**: jenkins_admin (for Jenkins system integration only)
- **LDAP configuration must match the settings in docker-compose.prod.yml**
- **Never bypass or mock authentication in production environment**

## Testing Protocols
- **Always use the configured test credentials first**
- **If authentication fails, check LDAP configuration before switching methods**
- **Document any configuration changes and get approval**
- **Production testing requires production credentials**
- **NEVER use Mock authentication settings - Mock is permanently disabled**
- **Always use real LDAP authentication in all environments**

## Production System Analysis & Troubleshooting

### Current Architecture (Docker Network Analysis)
```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                          HARBOR PRODUCTION SYSTEM                                ║
║                        Docker Network: 172.20.0.0/16                           ║
╚══════════════════════════════════════════════════════════════════════════════════╝

Browser → harbor.roboetech.com → Nginx Proxy Manager → Frontend:8080 (172.20.0.5)
                                                           ↓ API calls
Frontend → VITE_API_URL → Backend:3001 (172.20.0.4) ← Database:5432 (172.20.0.3)
                            ↓                              ↑
                       Redis:6379 (172.20.0.2)      WebSocket
                            ↓
                       NAS Volume (/nas) → ${NAS_HOST_PATH}
```

### Known Critical Issues

**🔴 Database Migration Failures:**
- Migration `004_create_deployment_paths.sql` failing to execute properly
- Missing columns: `nas_path`, `download_file`, `all_files`, `build_number`, `build_date`
- Backend code references non-existent columns causing SQL errors
- **Fix**: Run database migration manually or reset database schema

**🔴 NAS Scanning Service Failures:**
- "NAS scan failed" errors occurring every 15 minutes
- "Scheduled scan failed" errors in backend logs
- Likely causes: NAS mount issues, permission problems, or incorrect NAS_HOST_PATH
- **Fix**: Verify NAS mount path and permissions

**🔴 Port Configuration Inconsistencies:**
- `.env` file specifies PORT=3002
- `docker-compose.prod.yml` uses PORT=3001 (actual running port)
- **Fix**: Align all configuration files to use consistent port

### Production Debugging Commands

**Docker Container Inspection:**
```bash
docker ps                                    # Check running containers
docker logs harbor-backend-prod --tail 50   # Check backend logs
docker logs harbor-frontend-prod --tail 50  # Check frontend logs
docker exec -it harbor-backend-prod sh      # Access backend container
docker exec -it harbor-postgres-prod psql -U harbor_user -d harbor_prod  # Access database
```

**Database Debugging:**
```bash
# Check database schema
docker exec harbor-postgres-prod psql -U harbor_user -d harbor_prod -c "\d deployment_paths"

# Check migration status
docker exec harbor-postgres-prod psql -U harbor_user -d harbor_prod -c "SELECT * FROM schema_migrations;"

# Force re-run migrations
docker exec harbor-backend-prod npm run db:migrate
```

**Network Connectivity Tests:**
```bash
curl -s http://localhost:3001/api/health     # Test backend directly
curl -s http://localhost:8080               # Test frontend directly
docker network inspect harbor_harbor-network # Inspect network configuration
```

### Recovery Procedures

**Database Schema Reset (if migrations fail):**
1. Stop containers: `docker-compose -f docker-compose.prod.yml down`
2. Remove database volume: `docker volume rm harbor_postgres_data`
3. Restart system: `docker-compose -f docker-compose.prod.yml up -d`

**NAS Mount Troubleshooting:**
1. Verify NAS_HOST_PATH environment variable
2. Check host directory permissions
3. Test NAS connectivity from host system
4. Restart backend container if mount issues persist

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md
