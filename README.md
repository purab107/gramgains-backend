# GramGains Backend API

A calorie tracking and nutrition management backend service designed specifically for the Indian dietary context. Provides a RESTful API with advanced food search, user profile management, meal tracking, and metabolic calculations.

## Project Overview

GramGains Backend is a modular monolithic Node.js/Express application that serves as the core data layer for the GramGains calorie tracking platform. The system specialises in handling Indian food databases with support for vernacular language aliases, regional food prefixes, and culturally relevant nutritional tracking. The backend implements a custom food search engine with relevance-based ranking, barcode scanning support, and comprehensive audit tools for maintaining data quality.

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (v18+) |
| Framework | Express.js |
| Database | PostgreSQL (v14+) |
| ORM | Prisma |
| Authentication | Better Auth |
| Language | JavaScript |
| Dev tooling | Nodemon |

## Architecture

The backend follows a modular monolithic architecture with domain-driven design principles:

```
gramgains-backend/
├── src/
│   ├── app.js                 # Express app configuration and middleware setup
│   ├── server.js              # Server entry point
│   ├── config/
│   │   ├── auth.js            # Better Auth configuration
│   │   └── db.js              # Prisma client instance
│   ├── middlewares/
│   │   └── auth.js            # Authentication middleware (requireAuth)
│   ├── modules/               # Domain modules
│   │   ├── food/              # Food database and search
│   │   ├── tracker/           # Meal and activity logging
│   │   ├── dashboard/         # Analytics and summaries
│   │   ├── profile/           # User profiles and metrics
│   │   └── saved-meals/       # Saved meal management
│   └── audit/                 # Data quality audit tools
├── scripts/                   # Standalone utility scripts
├── prisma/                    # Database schema and seed scripts
└── test/                      # Test files
```

### Module Structure

Each domain module follows a consistent three-file pattern:

- **`{module}.routes.js`** — Express route definitions
- **`{module}.controller.js`** — Request handlers and response formatting
- **`{module}.service.js`** — Business logic and database operations

## Database Design

### Technology: PostgreSQL with Prisma ORM

The database schema is split across multiple Prisma schema files for maintainability, located in `prisma/schema/`:

| File | Purpose |
|---|---|
| `schema.prisma` | Database connection and generator config |
| `auth.prisma` | User authentication and session management |
| `profile.prisma` | User profiles, goals, metabolic targets, and weight logs |
| `food.prisma` | Food items, nutritional data, and serving sizes |
| `meal.prisma` | Meal logs and saved meals |
| `activity.prisma` | Activity and water logging |
| `social.prisma` | Social features (favourites) |

### Schema Highlights

- **ACID compliance** via PostgreSQL — referential integrity enforced with foreign keys and cascade rules
- **Soft delete** on food items (`deletedAt` field) — supports data recovery without permanent loss
- **Pre-calculated metabolic fields** — `bmr`, `tdee`, `targetCalories`, `targetProtein`, `targetCarbs`, `targetFat`, and `targetFiber` are stored directly on `UserProfile` after each calculation
- **Native PostgreSQL arrays** for `aliases` (`String[]`) — enables efficient multi-language food lookup
- **Strategic indexes** on `userId`, `date`, `foodId`, `layer`, `brand`, and `category` to prevent full table scans
- **Unique constraints** prevent duplicate data (user email, `userId + date` for weight logs, barcode)
- **Well-typed enums** for `MealType`, `ActivityLevel`, `Goal`, `Gender`, `FoodSource`

### Design Trade-offs

**Search is split between DB and application code**

Food search uses a two-phase approach: a broad PostgreSQL `ILIKE` query retrieves up to 2 000 candidates, which are then ranked by a custom JavaScript relevance engine. This keeps the stack simple (no additional services) and is appropriate for the current database size (~14K food items). If the database grows to hundreds of thousands of items, switching to PostgreSQL native full-text search (`tsvector`/`tsquery`) — which is already available in the database — would be the natural next step, with no new infrastructure required.

**Custom relevance engine**

The search engine (`src/modules/food/food-search.engine.js`) is domain-specific by design: it handles Indian-language prefix stripping, brand constraint detection, layer-hierarchy preference, and token-level stemming. This complexity is intentional — a generic search solution would not understand IFCT/INDB naming conventions or the raw vs. prepared vs. branded food hierarchy.

**Soft delete requires consistent filtering**

Every query that reads food items must include `deletedAt: null`. This is an acceptable trade-off for data recoverability. A future improvement would be a Prisma query extension that injects this filter automatically.

**Array aliases limit DB-level validation**

Storing aliases as a `String[]` PostgreSQL array means individual element constraints (e.g. max alias length) cannot be enforced at the database level. Validation must happen in application code.

## Core Features

### Food Database & Search
- **Multi-source database** — IFCT 2017, INDB, Open Food Facts, and user-created entries
- **Custom relevance engine** — token-based scoring with Indian language prefix support, brand constraint detection, and tier-based ranking
- **Barcode fast path** — direct barcode lookup before falling back to text search
- **Three-layer hierarchy** — Layer 1 (raw ingredients) → Layer 2 (prepared recipes) → Layer 3 (branded products)
- **Serving size management** — multiple units per food with gram-weight conversion

### User Management
- **Authentication** — email/password via Better Auth with session management
- **Profile system** — personalised metrics based on age, gender, height, weight, and activity level
- **Goal setting** — weight loss, maintenance, or bulking
- **Metabolic calculations** — BMR and TDEE computed using the Mifflin-St Jeor equation; results stored on the profile

### Meal Tracking
- **Daily logging** — breakfast, lunch, dinner, and snacks with per-entry nutritional calculations
- **Historical data** — query meal logs by date with full macro breakdown
- **Water tracking** — daily water intake logging and retrieval
- **Activity logging** — manual and external activity tracking with calorie burn estimates

### Analytics & Dashboard
- **Daily summary** — calorie and macro consumption vs. personal targets
- **Heatmap data** — adherence overview across a configurable time window
- **Recent foods** — quick access to frequently logged items

### Data Quality & Audit
- **Audit system** — comprehensive food database validation tools in `src/audit/`
- **Duplicate detection** — similarity-based duplicate identification
- **Nutritional validation** — plausibility checks for calorie and macro values
- **Indian-specific rules** — validation for raw vs. cooked staple foods

## API Endpoints

All endpoints are prefixed with `/api`.

### Authentication
Better Auth handles all auth endpoints. The handler accepts **all HTTP methods**.
```
ALL /api/auth/*
```

### Health
```
GET /api/health
```

### Food *(public — no authentication required)*
```
GET  /api/food/search?q={query}&layer={1-3}&category={category}&limit={50}&page={1}
GET  /api/food/barcode/:barcode
GET  /api/food/:id
POST /api/food
```

### Tracker *(authenticated)*
```
GET    /api/tracker/daily?date={YYYY-MM-DD}
GET    /api/tracker/recent-foods
POST   /api/tracker/log
PUT    /api/tracker/log/:id
DELETE /api/tracker/log/:id
GET    /api/tracker/water
POST   /api/tracker/water
DELETE /api/tracker/water/:id
```

### Dashboard *(authenticated)*
```
GET /api/dashboard/summary?date={YYYY-MM-DD}
GET /api/dashboard/heatmap?days={90}
```

### Profile *(authenticated)*
```
GET /api/profile
PUT /api/profile
```

### Saved Meals *(authenticated)*
```
GET    /api/saved-meals
GET    /api/saved-meals/:id
POST   /api/saved-meals
PUT    /api/saved-meals/:id
DELETE /api/saved-meals/:id
POST   /api/saved-meals/:id/log    ← logs all items in a saved meal to the tracker
```

## API Response Format

**Success**
```json
{
  "success": true,
  "data": { }
}
```

**Error**
```json
{
  "success": false,
  "message": "Human-readable description",
  "error": "Detailed error message"
}
```

**Paginated**
```json
{
  "success": true,
  "count": 50,
  "total": 1500,
  "page": 1,
  "limit": 50,
  "data": [ ]
}
```

## Environment Variables

Create a `.env` file in the root directory. The required variables are:

```env
# Server
PORT=5000
NODE_ENV=development

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/gramgains?schema=public"

# Supabase / pooled connections (optional)
# DIRECT_URL="postgresql://user:password@host:5432/postgres"

# Authentication
BETTER_AUTH_SECRET="your-secret-key-change-in-production"
BETTER_AUTH_URL="http://localhost:5000"

# CORS
FRONTEND_URL="http://localhost:3000"
```

## Setup Instructions

### Prerequisites
- Node.js v18 or higher
- PostgreSQL v14 or higher
- npm

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd gramgains-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create and configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your actual values
   ```

4. **Set up the database**
   ```bash
   # Generate Prisma client
   npm run prisma:generate

   # Push schema to database (creates tables without migration history)
   npm run prisma:push

   # Seed initial data (optional)
   npm run prisma:seed
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

   The API will be available at `http://localhost:5000`.

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server with hot reload (nodemon) |
| `npm start` | Start production server |
| `npm run prisma:generate` | Regenerate Prisma client after schema changes |
| `npm run prisma:push` | Push schema changes to the database |
| `npm run prisma:seed` | Seed the database with initial data |
| `npm run import:off` | Import Open Food Facts data (`prisma/openfoodfacts-import.js`) |
| `npm run audit:food` | Run food database audit |
| `npm run audit:food:strict` | Run strict food database audit |
| `npm run test:audit` | Run audit tests |
| `npm run test:search` | Run search functionality tests |
| `npm run benchmark:search` | Benchmark search performance |

> **Note:** There is no npm script for INDB import. Run `node prisma/indb-import.js` directly.

## Development Workflow

### Database Schema Changes
1. Edit the relevant file in `prisma/schema/`
2. Run `npm run prisma:generate` to update the Prisma client
3. Run `npm run prisma:push` to apply changes to the database
4. Test with the development server

> The project uses `prisma db push` (schema-push mode), not `prisma migrate`. There is no migration history folder.

### Adding New Features
1. Create a new directory in `src/modules/` following the existing pattern
2. Define routes in `{module}.routes.js`
3. Implement the controller in `{module}.controller.js`
4. Add business logic in `{module}.service.js`
5. Register the router in `src/app.js`

### Data Import

| Source | How to run |
|---|---|
| INDB (Indian Nutrient Database) | `node prisma/indb-import.js` |
| Open Food Facts | `npm run import:off` |
| Custom food items | `POST /api/food` endpoint |

## Food Search Engine

Located in `src/modules/food/food-search.engine.js`. Built specifically for Indian food data.

**Two-phase search flow:**
1. **DB phase** — `ILIKE` queries across `name`, `brand`, `genericName`, and `aliases` retrieve up to 2 000 candidates
2. **Scoring phase** — JavaScript relevance engine ranks candidates using a weighted scoring model

**Scoring model covers:**
- Exact name / alias full-phrase matches (highest weight)
- Indian-language prefix stripping on aliases (`"H. Kela"` → `"kela"`)
- Brand constraint detection and boosting
- Token-by-token matching across all fields with exact and prefix tiers
- Layer-hierarchy preference (Layer 1 raw > Layer 2 prepared > Layer 3 branded)
- Name conciseness penalty for overly verbose compound names

**Result tiers:**
- **Tier 1** — full-match candidates (all query tokens satisfied)
- **Tier 2** — partial-match fallback (ranked by brand affinity and partial token coverage)

## Testing

```bash
npm run test:audit          # Audit rule tests
npm run test:search         # Search engine tests
npm run benchmark:search    # Search performance benchmarks
```

## Production Considerations

### Security
- Rotate `BETTER_AUTH_SECRET` — never use the default value in production
- Set `FRONTEND_URL` to only the trusted frontend origin (CORS)
- Use HTTPS
- Consider rate limiting on public endpoints (e.g. `/api/food/search`)

### Performance
- Enable PostgreSQL connection pooling (Supabase pooler or PgBouncer)
- Monitor candidate set sizes in food search (the 2 000 candidate cap keeps response times predictable)
- Add indexes if new query patterns emerge

### Monitoring
- Structured logging is built in — every request logs method, path, status, and duration
- Track search response times and candidate counts for capacity planning

## Troubleshooting

**Database connection fails**
- Confirm PostgreSQL is running
- Verify `DATABASE_URL` format: `postgresql://user:password@host:port/dbname?schema=public`
- Ensure the database exists and the user has the required permissions

**Prisma client out of date**
- Always run `npm run prisma:generate` after any schema change before starting the server

**Search returning unexpected results**
- Check the `layer` and `category` query parameters — they act as hard filters
- Review candidate count: if `total` in the response is high, the query may be too broad
- Run `npm run benchmark:search` to profile performance

## Contributing

1. Follow the existing module structure and naming conventions
2. Add or update tests for any changed behaviour
3. Update this README if API endpoints or environment variables change
4. Run `npm run audit:food` before committing food data changes
5. Keep commits focused — one logical change per commit

## License

[Specify your license here]

GramGains Backend is a modular monolithic Node.js/Express application that serves as the core data layer for the GramGains calorie tracking platform. The system specializes in handling Indian food databases with support for vernacular languages, regional food prefixes, and culturally relevant nutritional tracking. The backend implements a sophisticated food search engine with relevance-based ranking, barcode scanning support, and comprehensive audit tools for maintaining data quality.

## Technology Stack

