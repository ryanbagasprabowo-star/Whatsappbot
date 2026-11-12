const fs = require('fs');
const path = 'src/night.js';
let s = fs.readFileSync(path, 'utf8');

const start = s.indexOf('  // Hunter Last Shot');
const end = s.indexOf('  let announcement;', start);

if (start < 0 || end < 0) {
  throw new Error('Blok Hunter Last Shot tidak ditemukan. File tidak diubah.');
}

const code = [
"  // Hunter Last Shot",
"  const hunter = eliminated.find(jid =>",
"    lobby.roleAssignments.some(",
"      player => player.jid === jid && player.role === 'Hunter'",
"    )",
"  );",
"",
"  if (hunter) {",
"    const candidates = lobby.roleAssignments.filter(",
"      player => lobby.alivePlayers.has(player.jid)",
"    );",
"",
"    if (lobby.hybrid && hunter !== lobby.humanJid) {",
"      if (candidates.length > 0) {",
"        const shot = candidates[Math.floor(Math.random() * candidates.length)];",
"        lobby.alivePlayers.delete(shot.jid);",
"        eliminated.push(shot.jid);",
"      }",
"    } else if (candidates.length > 0) {",
"      lobby.pendingHunterShot = hunter;",
"      lobby.pendingAfterHunterPhase = 'day';",
"",
"      await sock.sendMessage(hunter, {",
"        text:",
"          '🏹 HUNTER LAST SHOT!\\n\\n' +",
"          'Kamu telah gugur dan dapat memilih satu pemain hidup untuk ikut tereliminasi.\\n\\n' +",
"          'Gunakan:\\n.ww shoot NAMA\\n\\n' +",
"          'Atau lewati:\\n.ww skip'",
"      });",
"    }",
"  }",
"",
].join('\n');

s = s.slice(0, start) + code + s.slice(end);
fs.writeFileSync(path, s);
console.log('Hunter Last Shot malam berhasil diperbarui.');
