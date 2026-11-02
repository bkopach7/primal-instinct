const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 4173);
const INVITE_TOKEN = process.env.PI_INVITE_TOKEN || '';
const PAGE = path.join(__dirname, 'index.html');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FIGHTERS = [
  { id: 'ash-wolf', name: 'Ash Wolf', beast: 'Wolf', color: '#ed5a37', speed: 3.8, light: 7, heavy: 11, beastPower: 1.2, meterGain: 1.08, guardDamage: 0.42, chainPower: 7 },
  { id: 'storm-tiger', name: 'Storm Tiger', beast: 'Tiger', color: '#e3ae4b', speed: 3.25, light: 8, heavy: 15, beastPower: 1.28, meterGain: 0.95, guardDamage: 0.42, chainPower: 5 },
  { id: 'iron-boar', name: 'Iron Boar', beast: 'Boar', color: '#68cfbb', speed: 2.9, light: 9, heavy: 14, beastPower: 1.22, meterGain: 0.94, guardDamage: 0.3, chainPower: 6 },
  { id: 'veil-fox', name: 'Veil Fox', beast: 'Fox', color: '#bd85eb', speed: 3.55, light: 7, heavy: 12, beastPower: 1.16, meterGain: 1.22, guardDamage: 0.42, chainPower: 6 },
];

function fighterStyle(requested) {
  return FIGHTERS.find((fighter) => fighter.id === requested) || FIGHTERS[crypto.randomInt(FIGHTERS.length)];
}

function id() {
  return crypto.randomBytes(5).toString('hex');
}

function roomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function safeName(value) {
  const name = String(value || 'Fighter').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16);
  return name || 'Fighter';
}

function frame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

function send(client, message) {
  if (!client || client.closed || client.socket.destroyed) return;
  try {
    client.socket.write(frame(0x1, JSON.stringify(message)));
  } catch { /* The close handler removes stale clients. */ }
}

function playerCard(player) {
  return { id: player.id, name: player.name, color: player.color, style: player.style, host: player.host };
}

function broadcastLobby(room) {
  const players = [...room.players.values()].map(playerCard);
  for (const player of room.players.values()) {
    send(player.client, {
      type: 'lobby', roomCode: room.code, hostId: room.hostId,
      players, phase: room.phase, minPlayers: 2, maxPlayers: 8,
    });
  }
}

function createPlayer(client, name, host, requestedStyle) {
  const angle = Math.random() * Math.PI * 2;
  const style = fighterStyle(requestedStyle);
  return {
    id: id(), name: safeName(name), color: style.color, style,
    host, client, x: Math.cos(angle) * 2.4, z: Math.sin(angle) * 2.4,
    facingX: 0, facingZ: 1, hp: 100, meter: 0, beast: false, score: 0,
    respawnAt: 0, lightAt: 0, heavyAt: 0, finisherAt: 0,
    comboAt: 0, comboStep: 0, moveX: 0, moveZ: 0, guard: false,
    action: null, actionUntil: 0, message: '', messageUntil: 0,
  };
}

function enterRoom(client, room, name, host, requestedStyle) {
  if (room.phase !== 'lobby') {
    send(client, { type: 'error', message: 'That match is already in progress.' });
    return;
  }
  if (room.players.size >= 8) {
    send(client, { type: 'error', message: 'That room is full.' });
    return;
  }
  const player = createPlayer(client, name, host, requestedStyle);
  player.host = host;
  room.players.set(player.id, player);
  client.room = room;
  client.playerId = player.id;
  send(client, { type: 'joined', roomCode: room.code, playerId: player.id, hostId: room.hostId });
  broadcastLobby(room);
}

function startRound(room) {
  room.phase = 'playing';
  room.endsAt = Date.now() + 180000;
  room.winnerIds = [];
  let i = 0;
  const count = Math.max(1, room.players.size);
  for (const player of room.players.values()) {
    const angle = (i / count) * Math.PI * 2;
    player.x = Math.cos(angle) * 3.2;
    player.z = Math.sin(angle) * 3.2;
    player.facingX = -Math.cos(angle);
    player.facingZ = -Math.sin(angle);
    player.hp = 100;
    player.meter = 0;
    player.beast = false;
    player.score = 0;
    player.respawnAt = 0;
    player.action = null;
    i += 1;
  }
}

function findTarget(room, attacker, range) {
  let target = null;
  let best = range;
  for (const candidate of room.players.values()) {
    if (candidate.id === attacker.id || candidate.hp <= 0 || candidate.respawnAt) continue;
    const distance = Math.hypot(candidate.x - attacker.x, candidate.z - attacker.z);
    if (distance < best) { best = distance; target = candidate; }
  }
  return target ? { player: target, distance: best } : null;
}

function applyHit(room, attacker, victim, damage, knockback, now) {
  if (victim.guard) damage *= victim.style.guardDamage;
  if (victim.hp <= 0 || victim.respawnAt) return;
  victim.hp = Math.max(0, victim.hp - damage);
  attacker.meter = Math.min(100, attacker.meter + Math.max(4, damage * 0.55) * attacker.style.meterGain);
  victim.meter = Math.min(100, victim.meter + Math.max(2, damage * 0.3) * victim.style.meterGain);
  const dx = victim.x - attacker.x;
  const dz = victim.z - attacker.z;
  const length = Math.hypot(dx, dz) || 1;
  victim.x = Math.max(-7.1, Math.min(7.1, victim.x + (dx / length) * knockback));
  victim.z = Math.max(-7.1, Math.min(7.1, victim.z + (dz / length) * knockback));
  victim.action = 'hit';
  victim.actionUntil = now + 260;
  if (victim.hp <= 0) {
    attacker.score += 1;
    victim.respawnAt = now + 1800;
    victim.beast = false;
    victim.message = `KO by ${attacker.name}`;
    victim.messageUntil = now + 1700;
    attacker.message = '+1 KO';
    attacker.messageUntil = now + 1000;
  }
}

function doAttack(room, player, move, now) {
  const isLight = move === 'light';
  const cooldown = isLight ? (player.beast ? 215 : 260) : (player.beast ? 430 : 520);
  const last = isLight ? player.lightAt : player.heavyAt;
  if (now - last < cooldown || player.hp <= 0 || player.respawnAt) return;
  if (isLight) player.lightAt = now; else player.heavyAt = now;

  if (now - player.comboAt > 1200) player.comboStep = 0;
  player.comboStep += 1;
  player.comboAt = now;
  const finisherChain = !isLight && player.comboStep >= 3;
  const target = findTarget(room, player, player.beast ? 3.1 : 2.65);
  player.action = player.beast ? (isLight ? 'beastLight' : 'beastHeavy') : (isLight ? 'light' : 'heavy');
  player.actionUntil = now + (isLight ? 270 : 400);
  player.facingX = target ? (target.player.x - player.x) / target.distance : player.facingX;
  player.facingZ = target ? (target.player.z - player.z) / target.distance : player.facingZ;
  if (target) {
    const chainBonus = finisherChain ? player.style.chainPower : Math.min(3, (player.comboStep - 1) * 1.5);
    const baseDamage = isLight ? player.style.light : player.style.heavy;
    const damage = (baseDamage + chainBonus) * (player.beast ? player.style.beastPower : 1);
    applyHit(room, player, target.player, damage, finisherChain ? 0.9 : (isLight ? 0.32 : 0.58), now);
    player.message = finisherChain ? 'CHAIN FINISH!' : `${player.comboStep} HIT`;
    player.messageUntil = now + 700;
  }
  if (player.comboStep >= 3) player.comboStep = 0;
}

function action(client, message) {
  const room = client.room;
  const player = room && room.players.get(client.playerId);
  if (!room || !player) {
    if (message.type === 'create') {
      const room = { code: roomCode(), phase: 'lobby', players: new Map(), hostId: null, endsAt: 0, winnerIds: [] };
      rooms.set(room.code, room);
      const host = createPlayer(client, message.name, true, message.style);
      room.hostId = host.id;
      room.players.set(host.id, host);
      client.room = room;
      client.playerId = host.id;
      send(client, { type: 'joined', roomCode: room.code, playerId: host.id, hostId: host.id });
      broadcastLobby(room);
    } else if (message.type === 'join') {
      const code = String(message.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      const found = rooms.get(code);
      if (!found) send(client, { type: 'error', message: 'Room code not found. Check it and try again.' });
      else enterRoom(client, found, message.name, false, message.style);
    }
    return;
  }

  if (message.type === 'start' && player.id === room.hostId && room.players.size >= 2) {
    startRound(room);
    broadcastLobby(room);
  }
  if (message.type === 'input' && room.phase === 'playing') {
    player.moveX = Math.max(-1, Math.min(1, Number(message.x) || 0));
    player.moveZ = Math.max(-1, Math.min(1, Number(message.z) || 0));
    player.guard = Boolean(message.guard);
  }
  if (message.type === 'attack' && room.phase === 'playing') doAttack(room, player, message.move === 'heavy' ? 'heavy' : 'light', Date.now());
  if (message.type === 'transform' && room.phase === 'playing' && !player.respawnAt) {
    if (player.beast) {
      player.beast = false;
      player.message = 'HUMAN FORM';
    } else if (player.meter >= 35) {
      player.beast = true;
      player.message = 'BEAST SHIFT';
    }
    player.messageUntil = Date.now() + 800;
  }
  if (message.type === 'finisher' && room.phase === 'playing' && player.beast && player.meter >= 45 && !player.respawnAt) {
    const now = Date.now();
    if (now - player.finisherAt >= 1800) {
      player.finisherAt = now;
      player.meter -= 45;
      player.action = 'finisher';
      player.actionUntil = now + 650;
      player.message = 'PRIMAL DRIVE!';
      player.messageUntil = now + 900;
      for (const target of room.players.values()) {
        if (target.id === player.id || target.hp <= 0 || target.respawnAt) continue;
        const distance = Math.hypot(target.x - player.x, target.z - player.z);
        if (distance < 3.8) applyHit(room, player, target, 21 * player.style.beastPower, 1.15, now);
      }
    }
  }
  if (message.type === 'rematch' && player.id === room.hostId && room.players.size >= 2 && room.phase === 'results') {
    startRound(room);
    broadcastLobby(room);
  }
}

function snapshot(room, now) {
  const players = [...room.players.values()].map((player) => {
    if (player.respawnAt && now >= player.respawnAt && room.phase === 'playing') {
      player.hp = 100;
      player.meter = Math.max(0, player.meter - 12);
      player.respawnAt = 0;
      player.x = (Math.random() - 0.5) * 5;
      player.z = (Math.random() - 0.5) * 5;
      player.message = 'BACK IN';
      player.messageUntil = now + 800;
    }
    if (player.beast && room.phase === 'playing') {
      player.meter = Math.max(0, player.meter - 0.26);
      if (player.meter <= 0) { player.beast = false; player.message = 'METER EMPTY'; player.messageUntil = now + 700; }
    }
    const isMoving = Math.abs(player.moveX) + Math.abs(player.moveZ) > 0.05;
    if (isMoving && !player.respawnAt && player.hp > 0 && room.phase === 'playing') {
      const length = Math.hypot(player.moveX, player.moveZ) || 1;
      const speed = player.guard ? player.style.speed * 0.66 : (player.beast ? player.style.speed * 1.22 : player.style.speed);
      player.x = Math.max(-7.1, Math.min(7.1, player.x + (player.moveX / length) * speed * 0.066));
      player.z = Math.max(-7.1, Math.min(7.1, player.z + (player.moveZ / length) * speed * 0.066));
    }
    return {
      id: player.id, name: player.name, color: player.color, style: player.style, x: player.x, z: player.z,
      facingX: player.facingX, facingZ: player.facingZ, hp: player.hp, meter: player.meter,
      beast: player.beast, score: player.score, respawnAt: player.respawnAt,
      guard: player.guard, action: player.actionUntil > now ? player.action : null,
      message: player.messageUntil > now ? player.message : '', host: player.host,
    };
  });
  let timeLeft = Math.max(0, Math.ceil((room.endsAt - now) / 1000));
  if (room.phase === 'playing' && timeLeft <= 0) {
    room.phase = 'results';
    const ranked = [...room.players.values()].sort((a, b) => b.score - a.score || b.hp - a.hp);
    const top = ranked[0];
    room.winnerIds = top ? ranked.filter((p) => p.score === top.score && p.hp === top.hp).map((p) => p.id) : [];
    timeLeft = 0;
    broadcastLobby(room);
  }
  return {
    type: 'state', roomCode: room.code, phase: room.phase,
    timeLeft, hostId: room.hostId, players, winnerIds: room.winnerIds,
  };
}

function removeClient(client) {
  client.closed = true;
  const room = client.room;
  if (!room) return;
  const player = room.players.get(client.playerId);
  room.players.delete(client.playerId);
  if (player && player.id === room.hostId) {
    const next = room.players.values().next().value;
    room.hostId = next ? next.id : null;
    if (next) next.host = true;
  }
  if (room.players.size === 0) rooms.delete(room.code);
  else broadcastLobby(room);
  client.room = null;
}

const server = http.createServer((request, response) => {
  const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (parsedUrl.pathname === '/health') { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('ok'); return; }
  if (INVITE_TOKEN && parsedUrl.searchParams.get('invite') !== INVITE_TOKEN) { response.writeHead(404); response.end('Not found'); return; }
  if (parsedUrl.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (request.method !== 'GET') { response.writeHead(405); response.end('Method not allowed'); return; }
  fs.readFile(PAGE, (error, content) => {
    if (error) { response.writeHead(500); response.end('Game page missing'); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(content);
  });
});

server.on('upgrade', (request, socket) => {
  const parsedUrl = new URL(request.url, 'http://localhost');
  const key = request.headers['sec-websocket-key'];
  if (!key || parsedUrl.pathname !== '/socket' || (INVITE_TOKEN && parsedUrl.searchParams.get('invite') !== INVITE_TOKEN)) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const client = { socket, room: null, playerId: null, closed: false, buffer: Buffer.alloc(0), lastPongAt: Date.now() };
  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const first = client.buffer[0];
      const second = client.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (client.buffer.length < 4) break;
        length = client.buffer.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (client.buffer.length < 10) break;
        const wide = client.buffer.readBigUInt64BE(2);
        if (wide > 1048576n) { socket.destroy(); return; }
        length = Number(wide); offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (client.buffer.length < offset + maskBytes + length) break;
      const mask = masked ? client.buffer.subarray(offset, offset + 4) : null;
      const start = offset + maskBytes;
      const payload = Buffer.from(client.buffer.subarray(start, start + length));
      client.buffer = client.buffer.subarray(start + length);
      if (masked) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      if (opcode === 0x8) { socket.end(frame(0x8, payload)); removeClient(client); return; }
      if (opcode === 0x9) { socket.write(frame(0xA, payload)); continue; }
      if (opcode === 0xA) { client.lastPongAt = Date.now(); continue; }
      if (opcode !== 0x1) continue;
      try { action(client, JSON.parse(payload.toString('utf8'))); }
      catch { send(client, { type: 'error', message: 'That action could not be read.' }); }
    }
  });
  socket.on('close', () => removeClient(client));
  socket.on('error', () => removeClient(client));
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === 'playing') {
      const state = snapshot(room, now);
      for (const player of room.players.values()) send(player.client, state);
    } else if (room.phase === 'results') {
      const state = snapshot(room, now);
      for (const player of room.players.values()) send(player.client, state);
    }
  }
}, 66).unref();

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const player of room.players.values()) {
      const client = player.client;
      if (now - client.lastPongAt > 65000) { client.socket.destroy(); continue; }
      if (!client.closed && !client.socket.destroyed) client.socket.write(frame(0x9, 'pi'));
    }
  }
}, 25000).unref();

server.listen(PORT, '0.0.0.0', () => {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const address of entries || []) if (address.family === 'IPv4' && !address.internal) addresses.push(address.address);
  }
  console.log('\n  PRIMAL INSTINCT');
  console.log(`  Ready at http://localhost:${PORT}`);
  if (addresses.length) console.log(`  Same Wi-Fi devices: ${addresses.map((address) => `http://${address}:${PORT}`).join('   ')}`);
  if (INVITE_TOKEN && process.env.RENDER_EXTERNAL_HOSTNAME) {
    console.log(`  Private invite link: https://${process.env.RENDER_EXTERNAL_HOSTNAME}/?invite=${encodeURIComponent(INVITE_TOKEN)}`);
  }
  console.log('  Keep this window open while friends play.\n');
});
