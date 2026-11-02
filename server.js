const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 4173);
const INVITE_TOKEN = process.env.PI_INVITE_TOKEN || '';
const PAGE = path.join(__dirname, 'index.html');
const THREE_MODULE = path.join(__dirname, 'node_modules', 'three', 'build', 'three.module.js');
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
    id: id(), name: safeName(name), color: style.color, style, targetId: null,
    host, client, x: Math.cos(angle) * 2.4, z: Math.sin(angle) * 2.4,
    vx: 0, vz: 0, stunUntil: 0, hitstopUntil: 0,
    facingX: 0, facingZ: 1, hp: 100, meter: 0, beast: false, score: 0,
    respawnAt: 0, lightAt: 0, heavyAt: 0, finisherAt: 0,
    launcherAt: 0, sweepAt: 0, evadeAt: 0, evadeUntil: 0, evadeCounterUntil: 0, evadeX: 0, evadeZ: 0, airUntil: 0,
    comboAt: 0, comboStep: 0, moveX: 0, moveZ: 0, guard: false,
    action: null, actionAt: 0, actionUntil: 0, attackAt: 0, attackResolved: true,
    attackMove: '', attackComboStep: 0, message: '', messageUntil: 0,
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
  room.lastTickAt = Date.now();
  room.winnerIds = [];
  let i = 0;
  const count = Math.max(1, room.players.size);
  for (const player of room.players.values()) {
    const angle = (i / count) * Math.PI * 2;
    player.x = Math.cos(angle) * 3.2;
    player.z = Math.sin(angle) * 3.2;
    player.vx = 0; player.vz = 0; player.stunUntil = 0; player.hitstopUntil = 0;
    player.facingX = -Math.cos(angle);
    player.facingZ = -Math.sin(angle);
    player.hp = 100;
    player.meter = 0;
    player.beast = false;
    player.score = 0;
    player.respawnAt = 0;
    player.action = null; player.actionAt = 0; player.actionUntil = 0; player.attackAt = 0; player.attackResolved = true; player.attackComboStep = 0;
    player.attackMove = ''; player.lightAt = 0; player.heavyAt = 0; player.launcherAt = 0; player.sweepAt = 0; player.evadeAt = 0; player.evadeUntil = 0; player.evadeCounterUntil = 0; player.evadeX = 0; player.evadeZ = 0; player.airUntil = 0; player.finisherAt = 0; player.comboAt = 0; player.comboStep = 0;
    player.message = ''; player.messageUntil = 0;
    i += 1;
  }
}

function findTarget(room, attacker, range, frontOnly = true) {
  const locked = attacker.targetId && room.players.get(attacker.targetId);
  if (locked && locked.id !== attacker.id && locked.hp > 0 && !locked.respawnAt) {
    const distance = Math.hypot(locked.x - attacker.x, locked.z - attacker.z);
    if (distance < range) return { player: locked, distance };
  }
  let target = null;
  let best = range;
  for (const candidate of room.players.values()) {
    if (candidate.id === attacker.id || candidate.hp <= 0 || candidate.respawnAt) continue;
    const distance = Math.hypot(candidate.x - attacker.x, candidate.z - attacker.z);
    if (frontOnly && distance > 0.001) {
      const dot = ((candidate.x - attacker.x) * attacker.facingX + (candidate.z - attacker.z) * attacker.facingZ) / distance;
      if (dot < -0.1) continue;
    }
    if (distance < best) { best = distance; target = candidate; }
  }
  return target ? { player: target, distance: best } : null;
}

function applyHit(room, attacker, victim, damage, knockback, now) {
  if (victim.evadeUntil > now) {
    victim.message = 'PERFECT EVADE'; victim.messageUntil = now + 650;
    victim.meter = Math.min(100, victim.meter + 7);
    victim.evadeCounterUntil = now + 900;
    return;
  }
  const guarded = victim.guard && now >= victim.stunUntil;
  if (guarded) damage *= victim.style.guardDamage;
  if (victim.hp <= 0 || victim.respawnAt) return;
  victim.hp = Math.max(0, victim.hp - damage);
  attacker.meter = Math.min(100, attacker.meter + Math.max(4, damage * 0.55) * attacker.style.meterGain);
  victim.meter = Math.min(100, victim.meter + Math.max(2, damage * 0.3) * victim.style.meterGain);
  const dx = victim.x - attacker.x;
  const dz = victim.z - attacker.z;
  const length = Math.hypot(dx, dz) || 1;
  const force = knockback * (guarded ? 1.5 : 5.1);
  victim.vx += (dx / length) * force;
  victim.vz += (dz / length) * force;
  victim.stunUntil = now + (guarded ? 95 : (knockback > 0.8 ? 420 : 245));
  victim.hitstopUntil = now + (guarded ? 34 : 74);
  attacker.hitstopUntil = Math.max(attacker.hitstopUntil, now + 38);
  victim.action = 'hit';
  victim.actionAt = now;
  victim.actionUntil = now + (guarded ? 170 : 390);
  if (knockback >= 1.35 && !guarded) victim.airUntil = now + 760;
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
  const cooldowns = { light: 245, heavy: 465, launcher: 650, sweep: 570 };
  const cooldown = (cooldowns[move] || 300) * (player.beast ? 0.86 : 1);
  const last = player[`${move}At`] || 0;
  if (now - last < cooldown || player.hp <= 0 || player.respawnAt) return;
  player[`${move}At`] = now;

  if (now - player.comboAt > 900) player.comboStep = 0;
  const nextComboStep = player.comboStep + 1;
  const finisherChain = move === 'heavy' && nextComboStep >= 3;
  const target = findTarget(room, player, 99);
  if (target) {
    player.facingX = (target.player.x - player.x) / target.distance;
    player.facingZ = (target.player.z - player.z) / target.distance;
  }
  const timing = { light: [340, 94], heavy: [500, 175], launcher: [570, 210], sweep: [535, 195] }[move] || [400, 120];
  player.action = player.beast ? (move === 'light' ? 'beastLight' : (move === 'heavy' ? 'beastHeavy' : move)) : move;
  player.actionAt = now;
  player.actionUntil = now + timing[0];
  player.attackAt = now + timing[1];
  player.attackResolved = false;
  player.attackMove = finisherChain ? 'breaker' : move;
  player.attackComboStep = nextComboStep;
  const lunge = { light: 1.85, heavy: 2.45, launcher: 2.05, sweep: 1.65 }[move] || 1.8;
  player.vx += player.facingX * lunge;
  player.vz += player.facingZ * lunge;
}

function resolveAttack(room, player, now) {
  player.attackResolved = true;
  const move = player.attackMove === 'breaker' ? 'heavy' : player.attackMove;
  const isLight = move === 'light';
  const finisherChain = player.attackMove === 'breaker';
  const ranges = { light: 2.6, heavy: 3.05, launcher: 2.75, sweep: 2.55 };
  const target = findTarget(room, player, (ranges[move] || 2.7) + (player.beast ? 0.35 : 0));
  if (!target) { player.message = 'WHIFF'; player.messageUntil = now + 450; return; }
  player.comboStep = player.attackComboStep;
  player.comboAt = now;
  player.facingX = (target.player.x - player.x) / target.distance;
  player.facingZ = (target.player.z - player.z) / target.distance;
  const baseDamage = { light: player.style.light * 0.72, heavy: player.style.heavy * 0.76, launcher: 8.5, sweep: 8 }[move] || 7;
  const airborne = target.player.airUntil > now;
  const chainBonus = finisherChain ? player.style.chainPower * 0.72 : Math.min(3, (player.attackComboStep - 1) * 1.15);
  const punish = player.evadeCounterUntil > now ? 1.3 : 1;
  const damage = (baseDamage + chainBonus) * (player.beast ? player.style.beastPower : 1) * (airborne ? 0.82 : 1) * punish;
  const force = finisherChain ? 1.45 : (move === 'launcher' ? 1.38 : (move === 'sweep' ? 1.23 : (isLight ? 0.52 : 1.02)));
  applyHit(room, player, target.player, damage, force, now);
  player.message = punish > 1 ? 'EVADE PUNISH!' : (finisherChain ? 'BEAST BREAKER!' : (airborne ? `AIR JUGGLE · ${player.attackComboStep}` : `${player.attackComboStep} HIT`));
  player.messageUntil = now + 700;
  if (player.attackComboStep >= 3) player.comboStep = 0;
}

function action(client, message) {
  const room = client.room;
  const player = room && room.players.get(client.playerId);
  if (!room || !player) {
    if (message.type === 'create') {
      const room = { code: roomCode(), phase: 'lobby', players: new Map(), hostId: null, endsAt: 0, lastTickAt: Date.now(), winnerIds: [] };
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
  if (message.type === 'target' && room.phase === 'playing') {
    const target = room.players.get(String(message.targetId || ''));
    player.targetId = target && target.id !== player.id ? target.id : null;
  }
  if (message.type === 'attack' && room.phase === 'playing') doAttack(room, player, ['light', 'heavy', 'launcher', 'sweep'].includes(message.move) ? message.move : 'light', Date.now());
  if (message.type === 'evade' && room.phase === 'playing' && !player.respawnAt) {
    const now = Date.now();
    if (now - player.evadeAt >= 820 && now >= player.stunUntil) {
      player.evadeAt = now; player.evadeUntil = now + 190; player.evadeCounterUntil = now + 900;
      player.action = 'evade'; player.actionAt = now; player.actionUntil = now + 340;
      let dx = player.moveX; let dz = player.moveZ; const len = Math.hypot(dx, dz);
      if (len < 0.12) { dx = player.facingZ; dz = -player.facingX; } else { dx /= len; dz /= len; }
      player.evadeX = dx; player.evadeZ = dz;
    }
  }
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
      player.actionAt = now;
      player.actionUntil = now + 650;
      player.attackResolved = true;
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

function stepRoom(room, now) {
  const dt = Math.max(0.001, Math.min(0.05, (now - (room.lastTickAt || now - 0.033)) / 1000));
  room.lastTickAt = now;
  const fighters = [...room.players.values()];
  for (const player of fighters) {
    if (player.respawnAt && now >= player.respawnAt) {
      player.hp = 100;
      player.meter = Math.max(0, player.meter - 12);
      player.respawnAt = 0;
      player.x = (Math.random() - 0.5) * 5;
      player.z = (Math.random() - 0.5) * 5;
      player.vx = 0; player.vz = 0;
      player.message = 'BACK IN';
      player.messageUntil = now + 800;
    }
    if (player.beast) {
      player.meter = Math.max(0, player.meter - dt * 3.94);
      if (player.meter <= 0) { player.beast = false; player.message = 'METER EMPTY'; player.messageUntil = now + 700; }
    }
    if (player.attackAt && !player.attackResolved && now >= player.attackAt) resolveAttack(room, player, now);
    if (player.actionUntil <= now) { player.action = null; player.attackMove = ''; }
    if (player.hp <= 0 || player.respawnAt) { player.vx *= 0.82; player.vz *= 0.82; continue; }

    const inputLength = Math.hypot(player.moveX, player.moveZ);
    const canAct = now >= player.stunUntil;
    const inRecovery = player.action && player.action !== 'hit' && now < player.actionUntil;
    const moveScale = player.guard ? 0.66 : (player.beast ? 1.22 : 1);
    const actionScale = inRecovery ? 0.44 : 1;
    const topSpeed = player.style.speed * moveScale * actionScale;
    const desiredX = canAct && inputLength > 0.06 ? player.moveX / inputLength * topSpeed : 0;
    const desiredZ = canAct && inputLength > 0.06 ? player.moveZ / inputLength * topSpeed : 0;
    const acceleration = inputLength > 0.06 && canAct ? 30 : 0;
    const approach = Math.min(1, acceleration * dt);
    if (now < player.actionUntil && player.action === 'evade') {
      player.vx = player.evadeX * 4.6; player.vz = player.evadeZ * 4.6;
      player.x += player.vx * dt; player.z += player.vz * dt;
    } else if (now >= player.hitstopUntil) {
      player.vx += (desiredX - player.vx) * (approach || (1 - Math.exp(-12 * dt)));
      player.vz += (desiredZ - player.vz) * (approach || (1 - Math.exp(-12 * dt)));
      player.x += player.vx * dt;
      player.z += player.vz * dt;
    }
    let focus = null; let focusDistance = Infinity;
    const locked = player.targetId && room.players.get(player.targetId);
    if (locked && locked.id !== player.id && locked.hp > 0 && !locked.respawnAt) {
      const dx = locked.x - player.x; const dz = locked.z - player.z; focus = { x: dx / (Math.hypot(dx, dz) || 1), z: dz / (Math.hypot(dx, dz) || 1) };
    }
    for (const opponent of fighters) {
      if (focus) break;
      if (opponent.id === player.id || opponent.hp <= 0 || opponent.respawnAt) continue;
      const dx = opponent.x - player.x; const dz = opponent.z - player.z; const distance = Math.hypot(dx, dz);
      if (distance < focusDistance) { focus = { x: dx / (distance || 1), z: dz / (distance || 1) }; focusDistance = distance; }
    }
    if (focus && canAct) {
      player.facingX += (focus.x - player.facingX) * Math.min(1, dt * 15);
      player.facingZ += (focus.z - player.facingZ) * Math.min(1, dt * 15);
      const facingLength = Math.hypot(player.facingX, player.facingZ) || 1;
      player.facingX /= facingLength; player.facingZ /= facingLength;
    }
  }

  for (let i = 0; i < fighters.length; i += 1) {
    const a = fighters[i];
    if (a.hp <= 0 || a.respawnAt) continue;
    for (let j = i + 1; j < fighters.length; j += 1) {
      const b = fighters[j];
      if (b.hp <= 0 || b.respawnAt) continue;
      let dx = b.x - a.x; let dz = b.z - a.z;
      let distance = Math.hypot(dx, dz);
      const minDistance = 0.92;
      if (distance >= minDistance) continue;
      if (distance < 0.001) { dx = 1; dz = 0; distance = 1; }
      const nx = dx / distance; const nz = dz / distance;
      const push = (minDistance - distance) * 0.52;
      a.x -= nx * push; a.z -= nz * push;
      b.x += nx * push; b.z += nz * push;
      const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (closing > 0) { a.vx -= nx * closing * 0.28; a.vz -= nz * closing * 0.28; b.vx += nx * closing * 0.28; b.vz += nz * closing * 0.28; }
    }
  }

  for (const player of fighters) {
    const limit = 7.1;
    if (player.x < -limit || player.x > limit) { player.x = Math.max(-limit, Math.min(limit, player.x)); player.vx *= -0.28; }
    if (player.z < -limit || player.z > limit) { player.z = Math.max(-limit, Math.min(limit, player.z)); player.vz *= -0.28; }
  }
}

function snapshot(room, now) {
  const players = [...room.players.values()].map((player) => {
    return {
      id: player.id, name: player.name, color: player.color, style: player.style, x: player.x, z: player.z,
      targetId: player.targetId,
      facingX: player.facingX, facingZ: player.facingZ, hp: player.hp, meter: player.meter,
      beast: player.beast, score: player.score, respawnAt: player.respawnAt,
      airUntil: player.airUntil, evadeUntil: player.evadeUntil,
      guard: player.guard, action: player.actionUntil > now ? player.action : null,
      actionAt: player.actionAt, actionUntil: player.actionUntil, attackMove: player.attackMove,
      vx: player.vx, vz: player.vz, stunUntil: player.stunUntil,
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
  if (parsedUrl.pathname === '/health') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: true, renderer: fs.existsSync(THREE_MODULE) })); return; }
  if (INVITE_TOKEN && parsedUrl.searchParams.get('invite') !== INVITE_TOKEN) { response.writeHead(404); response.end('Not found'); return; }
  if (parsedUrl.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (request.method !== 'GET') { response.writeHead(405); response.end('Method not allowed'); return; }
  if (parsedUrl.pathname === '/vendor/three.module.js') {
    fs.readFile(THREE_MODULE, (error, content) => {
      if (error) { console.error(`Three.js module request failed: ${error.code}`); response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('3D renderer is not installed'); return; }
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
      response.end(content);
    });
    return;
  }
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
      stepRoom(room, now);
      const state = snapshot(room, now);
      for (const player of room.players.values()) send(player.client, state);
    } else if (room.phase === 'results') {
      const state = snapshot(room, now);
      for (const player of room.players.values()) send(player.client, state);
    }
  }
}, 33).unref();

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

