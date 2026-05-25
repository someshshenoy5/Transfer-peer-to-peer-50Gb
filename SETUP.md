# FileDrop — Setup Guide

## Prerequisites: Install Node.js

1. Go to **https://nodejs.org**
2. Download the **LTS** version (green button)
3. Run the installer — click Next through all steps
4. To verify, open a terminal and run:
   ```
   node --version
   npm --version
   ```
   Both should print a version number (e.g. `v20.10.0`).

---

## Project structure

```
filedrop/
  server/          ← Node.js signaling server
    index.js
    package.json
  client/          ← React frontend (Vite)
    index.html
    vite.config.js
    package.json
    src/
      main.jsx
      App.jsx
      index.css
      hooks/
        useWebRTC.js
```

---

## Step 1 — Start the signaling server

Open a terminal and run:

```bash
cd filedrop/server
npm install
node index.js
```

You should see:
```
Signaling server running on port 3001
```

**Leave this terminal open.**

---

## Step 2 — Start the React app

Open a **second terminal** and run:

```bash
cd filedrop/client
npm install
npm run dev
```

You should see:
```
  VITE v5.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173** in your browser.

---

## Step 3 — Test it (two browser windows)

1. Open **http://localhost:5173** in **Window 1**
2. Click **Create room** — you'll get a 6-letter code like `AB3F7X`
3. Open **http://localhost:5173** in **Window 2** (or a different browser)
4. Enter the same code and click **Join room**
5. Both windows should show each other as connected peers
6. Drop any file in Window 1 — it transfers directly to Window 2
7. Click **Save file** in Window 2 to download it

---

## Share with someone else on the internet

The signaling server at `localhost:3001` is only accessible on your machine.
To let others connect, you have two options:

### Option A — Quick test with ngrok (free)
1. Download ngrok: https://ngrok.com/download
2. Run: `ngrok http 3001`
3. Copy the `https://xxxx.ngrok.io` URL
4. In `client/src/hooks/useWebRTC.js`, change:
   ```js
   const socket = io("http://localhost:3001");
   ```
   to:
   ```js
   const socket = io("https://xxxx.ngrok.io");
   ```
5. Restart `npm run dev`
6. Share your `localhost:5173` (or run `npx vite --host` and share your LAN IP)

### Option B — Deploy (permanent)
- **Server**: Deploy to Railway, Render, or Fly.io (free tiers available)
- **Client**: Deploy to Vercel or Netlify (free)
- Update the socket URL in `useWebRTC.js` to your server's URL

---

## How the 50 GB transfer works

- Files are **chunked into 64 KB pieces** — never loaded fully into RAM
- Sent over a **WebRTC DataChannel** — direct peer-to-peer, no relay
- Flow control pauses sending if the buffer fills up
- Receiver assembles chunks into a Blob and offers a **Save file** link
- Transfer speed depends on your network (LAN: 100+ MB/s, internet: 5–30 MB/s)
- A 50 GB file at 10 MB/s takes ~85 minutes

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `node: command not found` | Install Node.js from nodejs.org |
| Port 3001 in use | Change `PORT=3002 node index.js` and update the socket URL |
| Peers don't connect | Make sure both use the same room code; check browser console for errors |
| Transfer stuck | Refresh both tabs and try again; check if firewall blocks WebRTC |
| No "Save file" button | Only the receiver sees it; check you're on the receiving side |
