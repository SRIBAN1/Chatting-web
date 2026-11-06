# TODO

- [x] **Name-based guest entry:** Anyone can enter the chat using a chosen name without account registration; preserve the request that anyone can chat with a name.
- [ ] **Shared chat room with durable messages:** Visitors share a chat room, can send and receive messages, and messages must not disappear. Store conversation history in SQL so it remains available after reloads and deployments.
- [ ] **Chronological conversation history:** Automatically load existing messages and display existing and newly sent messages in chronological order, with clear sender names and message timestamps.
- [x] **Responsive, reliable chat experience:** Provide a responsive chat interface optimized for mobile and desktop; validate input, prevent empty messages, and show user-friendly error states.
- [ ] **Vercel-compatible SQL deployment:** Ensure the application and its database configuration work with Vercel deployment and a persistent SQL database.

**Status:** The SQL-backed chat, durable history, polling, and Vercel integration are implemented in code. Those outcomes remain open until a real PostgreSQL `DATABASE_URL` is connected and the persistence path is verified end to end.
