# Primal Instinct

A room-code arena fighter for 2–8 players. It runs in a browser and synchronizes players through a small Node.js server.

## Offline single-file mode

Open `index.html` directly in a browser (double-click it in File Explorer) to play an offline practice bout against three CPU fighters. The HTML contains its styles, artwork, and game code; it does not need an internet connection. Offline mode is for solo practice. Room-code multiplayer uses the server below.

## Start a room

1. Install Node.js 20 or newer on the computer that will host the room.
2. Run `start.ps1` from PowerShell, or run `node server.js` in this folder.
3. Keep the terminal window open. It prints a local address and, when available, a same-Wi-Fi address.
4. Open the local address on the host computer. Friends on the same Wi-Fi open the printed Wi-Fi address on their phones or computers.
5. Create a room and share its four-character code. The host can start once at least two fighters have joined.

If Windows asks whether Node.js can communicate on a network, allow it on private networks so other devices on the same Wi-Fi can connect.

## Controls

- **Keyboard:** WASD or arrow keys to move, J/Z for light, K/X for heavy, L/Space to guard, Shift to transform, E for Primal Drive.
- **Touch:** Use the on-screen stick and Light, Heavy, Guard, Shift, and Drive buttons.
- Chain attacks quickly. A heavy strike at the end of a three-hit chain adds a chain finisher.
- Land or take hits to build Beast meter. Shift at 35%; your meter drains while transformed. Primal Drive consumes 45 meter.

## Fighters

- **Ash Wolf:** Fast movement and a stronger chain ender.
- **Storm Tiger:** Harder-hitting attacks, especially in beast form.
- **Iron Boar:** Slower movement with a stronger guard.
- **Veil Fox:** Builds Beast meter more quickly.

## Match rules

Rounds last three minutes. Fighters start with 100 health. KOs are worth one point, and defeated players respawn after a short delay. The highest KO score wins; ties go to remaining health.

## Network scope

This version supports devices on the same Wi-Fi through the host computer. Playing across separate networks needs a publicly reachable server.

The arena uses a stylized 2.5D canvas view with a pulled-back shoulder camera. The fighters and visual treatment are original; this version does not use full 3D character models.

## Hosted invite link

The included `render.yaml` prepares a Render web service. The server supports room-code multiplayer through WebSockets. Set a strong `PI_INVITE_TOKEN` environment variable on the host: both the game page and its WebSocket reject requests without the matching `?invite=` query parameter. Anyone with the complete invite URL can use it. Keep the token out of the repository and share the invite URL only with players.

For a Render deploy, create a Node web service from this repository with `npm install --omit=dev` as the build command and `npm start` as the start command. Set `PI_INVITE_TOKEN` as a secret environment variable. The service listens on Render's assigned `PORT` and responds to `/health`. Render's free web services can spin down after 15 minutes without inbound requests, so the first visit after an idle period may take longer to load.
