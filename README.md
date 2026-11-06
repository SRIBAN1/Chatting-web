# Chatting Web

A shared, name-based chat room. Visitors choose a display name and join without creating an account. Messages are stored in PostgreSQL and remain in the shared history across reloads and deployments.

## Run locally

Use Node.js 22 or newer and pnpm 11.25.0. Copy `.env.example` to `.env.local`, set `DATABASE_URL` to a PostgreSQL connection string, then run:

```sh
pnpm install
pnpm dev
```

Without `DATABASE_URL`, the interface still starts and shows a clear database connection message, but messages cannot be loaded or saved. On its first API request, the application creates the chat schema and initializes an append-only room counter in a single PostgreSQL transaction under an advisory lock. This keeps simultaneous Vercel cold starts from racing to create the tables. The checked-in schema reference is `db/migrations/001_create_chat_messages.sql`.

Message IDs are allocated and inserted in one SQL statement while holding a row lock on the room counter. That makes message order follow committed insert order, so a poll cursor cannot skip a late-committing concurrent message. There is no message expiry or delete endpoint.

## Deploy to Vercel with persistent SQL

1. Import `SRIBAN1/Chatting-web` as a Next.js project in Vercel.
2. In Vercel Marketplace, connect the Vercel-managed Neon Postgres integration to this project and enable it for the environments you will deploy. It supplies `DATABASE_URL` to the application.
3. Deploy or redeploy after the database integration is connected. The API uses Neon's serverless HTTP driver and creates the message table the first time it handles a request.

You can instead use an existing Neon database: create or copy its PostgreSQL connection string, store it as `DATABASE_URL` in the Vercel project’s Environment Variables, and redeploy. For local development, put the same environment variable in `.env.local` only. Never commit actual credentials.

Vercel’s Postgres products are provided through database integrations in the Vercel Marketplace. See [Vercel Postgres documentation](https://vercel.com/docs/postgres), [Neon’s Next.js guide](https://neon.tech/docs/guides/nextjs), and [Neon’s Vercel integration guide](https://neon.tech/docs/guides/vercel-native-integration).

## Chat behavior and privacy

The shared room loads the newest 50 messages first, offers older history in chronological order, and checks for new messages automatically. Every accepted message is inserted in PostgreSQL; this app does not apply message expiry or delete messages automatically. The browser remembers only the chosen display name in local storage.

Names are public labels, not verified accounts. Since there is no registration or authentication, visitors can choose the same name or use another person’s name. Messages in the public room can be read by anyone who visits the site.

The API rejects empty messages, trims surrounding whitespace, caps messages at 500 characters and names at 24 characters, and escapes message content through React’s normal text rendering.
