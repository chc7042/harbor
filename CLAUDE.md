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

### Full System
```bash
# Start both backend and frontend in development
npm run dev             # Runs both backend and frontend concurrently
docker-compose up       # Start with Docker (development)
docker-compose -f docker-compose.prod.yml up  # Production deployment
```

## System Architecture

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