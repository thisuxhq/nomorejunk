# NoMoreJunk Email Validator

Hey there! 👋 This is a super handy API service that helps you check if an email address is using a disposable/temporary domain. You know those pesky throwaway email addresses that people use to bypass verification? Yeah, we catch those!

## What's Cool About This?

- **Super Fast Checks**: We use Redis caching to make checks lightning fast
- **Smart Domain Detection**: Can catch similar-looking domains (like `gmaill.com` trying to pose as `gmail.com`)
- **Maintainable Lists**: Automatically syncs allowlist and blocklist from GitHub repositories
- **Audit Trail**: Keeps track of all email checks with IP addresses for security
- **API-First**: Built with Hono.js for a lightweight but powerful API

## Getting Started

First, make sure you have Bun installed (we're using it for that sweet performance). Then:

```sh
# Install all the goodies
bun install

# Fire up the development server
bun run dev
```

The server will start at http://localhost:3000

## Environment Variables You'll Need

Create a `.env` file with these:
```env
DATABASE_URL=your_postgres_connection_string
REDIS_URL=your_redis_url
BLOCKLIST_URL=github_raw_url_to_blocklist
ALLOWLIST_URL=github_raw_url_to_allowlist
```

## API Documentation

### Base URL
All endpoints are prefixed with: `/api.nomorejunk.com`

### Authentication
Bearer token authentication is required for all endpoints except `/register` and `/login`.

Token format: `Authorization: Bearer <your_token>`

### Endpoints

#### Authentication

##### Register
```http
POST /register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "your_secure_password"
}
```

##### Login
```http
POST /login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "your_password"
}
```

Response:
```json
{
  "message": "Login successful",
  "token": "your_jwt_token"
}
```

#### Email Verification

##### Verify Email
```http
POST /verify-email
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Domain Management

##### Add/Update Domains
```http
POST /blocklist
POST /allowlist
Content-Type: application/json

{
  "domain": "example.com"
}
```

##### Remove Domain
```http
DELETE /remove-domain
Content-Type: application/json

{
  "domain": "example.com",
  "type": "disposable|allowlist"
}
```

##### List Domains
```http
GET /domains?type=disposable|allowlist&page=1&limit=10
```

#### System Operations

##### Sync & Cache Management
```http
GET /sync-domains
POST /refresh-cache
```

#### Audit Logging

##### Audit Log Endpoints
```http
GET /audit-logs?page=1&limit=10
GET /audit-logs/pagination?page=1&limit=10
GET /audit-logs/{email}
```

### Response Formats

#### Success Responses

```json
// Authentication Success
{
  "message": "Login successful",
  "token": "jwt_token_here"
}

// Registration Success
{
  "message": "Registration successful",
  "user": {
    "email": "user@example.com"
  }
}

// Email Verification Success
{
  "status": "success",
  "disposable": false,
  "reason": "Domain allowlisted",
  "domain": "example.com",
  "message": "Email address is valid and safe to use"
}

// Domain Operation Success
{
  "status": "success",
  "message": "Operation completed successfully",
  "domain": "example.com",
  "type": "disposable|allowlist"
}

// Audit Logs Success
{
  "status": "success",
  "message": "Audit logs retrieved successfully",
  "logs": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "domain": "example.com",
      "ip": "ip_address",
      "action": "action_type",
      "timestamp": "timestamp"
    }
  ]
}
```

#### Error Responses

```json
{
  "status": "error",
  "message": "Error description",
  "details": "Additional error context",  // Only in validation errors
  "error": "Detailed error message"      // Only in 500 responses
}
```

Common HTTP Status Codes:
- 200: Success
- 201: Created
- 400: Bad Request
- 401: Unauthorized (Invalid credentials)
- 403: Forbidden (Valid token required)
- 409: Conflict (Resource already exists)
- 500: Internal Server Error

## Database Stuff

We're using Drizzle ORM with PostgreSQL. To handle database changes:

```sh
# Generate migrations
bun run generate

# Push changes to database
bun run db-push
```

## Tech Stack
- **Runtime**: Bun
- **Framework**: Hono.js
- **Database**: PostgreSQL with Drizzle ORM
- **Cache**: Redis
- **Language**: TypeScript

## Contributing

Feel free to jump in! Whether it's adding features, fixing bugs, or improving docs - all contributions are welcome. Just fork, make your changes, and send a PR.

## Need Help?

Check out the source code - I've tried to keep it well-commented and organized. If you're still stuck, feel free to open an issue!

---

Made with ❤️ to keep email lists clean and genuine
