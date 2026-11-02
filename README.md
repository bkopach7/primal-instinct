# Primal Instinct

A room-code arena fighter for 2–8 players. It runs in a browser and synchronizes players through a small Node.js server.

## Solo practice

Select **Practice vs CPU** on the game page to start a focused 1-v-1 sparring match. The hosted game serves its 3D renderer with the page; opening `index.html` directly still works offline using the built-in fallback arena. Room-code multiplayer uses the server below.

## Start a room

1. Install Node.js 20 or newer on the computer that will host the room.
2. Run `start.ps1` from PowerShell, or run `node server.js` in this folder.
3. Keep the terminal window open. It prints a local address and, when available, a same-Wi-Fi address.
4. Open the local address on the host computer. Friends on the same Wi-Fi open the printed Wi-Fi address on their phones or computers.
5. Create a room and share its four-character code. The host can start once at least two fighters have joined.

If Windows asks whether Node.js can communicate on a network, allow it on private networks so other devices on the same Wi-Fi can connect.

## Controls

- **Keyboard:** WASD/arrows move relative to your locked opponent; Q cycles targets in a room; J/Z quick strike; K/X heavy strike; U launcher; I sweep; L guard; Space sidestep evade; R or Shift transforms; E uses Primal Drive.
- **Gamepad:** Left stick moves; A quick strike; B heavy; X launcher; Y sweep; LB guard; LT evade; RB transform; RT Primal Drive.
- **Touch:** Use the on-screen stick and labeled action buttons.
- Chain J → J → K for a Beast Breaker. Launch with U, then connect J or K while your opponent is airborne. Evade at the last moment to avoid a hit and open a short punish window.
- Land or take hits to build Beast meter. Shift at 35%; the meter drains while transformed. Primal Drive consumes 45 meter.

## Fighters

- **Ash Wolf:** Fast movement and a stronger chain ender.
- **Storm Tiger:** Harder-hitting attacks, especially in beast form.
- **Iron Boar:** Slower movement with a stronger guard.
- **Veil Fox:** Builds Beast meter more quickly.

## Match rules

Practice is a best-of-three duel against a CPU. Each round lasts one minute; a knockout wins the round, and the fighter with more health wins on time. First to two rounds takes the match. Practice uses the same combo, evade, transformation, and Beast Drive systems as room play.

Room-code matches support 2–8 fighters in a three-minute free-for-all. Fighters start each match with 100 health, score KOs, and respawn after a short delay. The top KO score wins; ties go to remaining health.

## Combat and presentation

Fighters accelerate and brake responsively, separate on contact, and recoil through knockback and hit-stun. Quick strikes, heavy strikes, launchers, sweeps, air follow-ups, a three-hit breaker, guard, timed sidestep evades, target selection, beast forms, and a meter-consuming Beast Drive create distinct choices in a fight. Practice uses readable 60-second rounds and health bars for both fighters. The 3D over-the-shoulder arena has cel-shaded, ink-outlined original fighters, a Japanese night-market stage, telegraphed attack animations, and beast-form aura effects. A built-in canvas renderer remains available for offline single-file play.

## Network scope

When running the server locally, players on the same Wi-Fi can join through the host computer. When hosted on the internet, players can join from anywhere using the hosted invite link and room code.

The camera follows over the player's shoulder and keeps the closest opponent in front. Fighters and visual details are original, built from procedural low-poly 3D models.

## Hosted invite link

The included `render.yaml` prepares a Render web service. The server supports room-code multiplayer through WebSockets. Set a strong `PI_INVITE_TOKEN` environment variable on the host: both the game page and its WebSocket reject requests without the matching `?invite=` query parameter. Anyone with the complete invite URL can use it. Keep the token out of the repository and share the invite URL only with players.

For a Render deploy, create a Node web service from this repository with `npm install --omit=dev` as the build command and `npm start` as the start command. Set `PI_INVITE_TOKEN` as a secret environment variable. The service listens on Render's assigned `PORT` and responds to `/health`. Render's free web services can spin down after 15 minutes without inbound requests, so the first visit after an idle period may take longer to load.

