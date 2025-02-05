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

## API Endpoints

### Check if an Email is Disposable
```http
POST /check-email
{
  "email": "user@example.com"
}
```

### Verify Email (Alternative Endpoint)
```http
POST /verify-email
{
  "email": "user@example.com"
}
```

### Manage Domain Lists
```http
POST /blocklist    # Add domain to blocklist
POST /allowlist    # Add domain to allowlist
DELETE /remove-domain  # Remove domain from either list
GET /domains      # List all domains (supports pagination)
```

### Other Useful Endpoints
- `GET /sync-domains` - Sync domains from GitHub
- `POST /refresh-cache` - Manually refresh Redis cache
- `GET /audit-logs` - View check history (supports pagination)
- `GET /audit-logs/:email` - Check history for specific email

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
