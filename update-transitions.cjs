const fs = require('fs');
const path = 'src/lobby.js';
let s = fs.readFileSync(path, 'utf8');

const oldResolve = `    if (resolved) {
      const finished = await checkGameEnd(
        sock,
        lobby,
        groupJid
      );

      if (finished) {
        lobbies.delete(groupJid);
      } else {
        await startDay(sock, lobby, groupJid);
      }
    }`;

const newResolve = `    if (resolved && !lobby.pendingHunterShot) {
      const finished = await checkGameEnd(
        sock,
        lobby,
        groupJid
      );

      if (finished) {
        lobbies.delete(groupJid);
      } else {
        await startDay(sock, lobby, groupJid);
      }
    }`;

const oldCount = `    if (resolved) {
      const finished = await checkGameEnd(
        sock,
        lobby,
        groupJid
      );

      if (!finished) {
        await startNight(sock, lobby, groupJid);
      }
    }`;

const newCount = `    if (resolved && !lobby.pendingHunterShot) {
      const finished = await checkGameEnd(
        sock,
        lobby,
        groupJid
      );

      if (finished) {
        lobbies.delete(groupJid);
      } else {
        await startNight(sock, lobby, groupJid);
      }
    }`;

if (s.split(oldResolve).length !== 2) {
  throw new Error('Blok resolve tidak cocok tepat satu kali. Tidak ada perubahan.');
}
if (s.split(oldCount).length !== 2) {
  throw new Error('Blok count tidak cocok tepat satu kali. Tidak ada perubahan.');
}

s = s.replace(oldResolve, newResolve).replace(oldCount, newCount);
fs.writeFileSync(path, s);
console.log('Transisi resolve dan count berhasil diperbarui.');
