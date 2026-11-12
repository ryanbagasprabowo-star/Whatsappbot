const fs = require('fs');
const path = 'src/voting.js';
let s = fs.readFileSync(path, 'utf8');
const start = s.indexOf('export async function resolveVoting(');
if (start < 0) throw new Error('Fungsi tidak ditemukan');

const code = [
"export async function resolveVoting(sock, lobby, groupJid) {",
"  if (lobby.status !== 'playing' || lobby.phase !== 'voting' || !lobby.voting?.started) return false;",
"  const alive = getAlivePlayers(lobby);",
"  if (alive.some(p => !lobby.voting.voters.has(p.jid))) {",
"    await sock.sendMessage(groupJid, { text: '⏳ Belum semua pemain yang hidup mengirim suara.' });",
"    return false;",
"  }",
"  const counts = new Map();",
"  for (const target of lobby.voting.votes.values()) counts.set(target, (counts.get(target) || 0) + 1);",
"  const maxVotes = Math.max(0, ...counts.values());",
"  const winners = [...counts.entries()].filter(([, count]) => count === maxVotes);",
"  const result = [];",
"  if (winners.length === 1 && maxVotes > 0) {",
"    const eliminated = winners[0][0];",
"    lobby.alivePlayers.delete(eliminated);",
"    const target = lobby.roleAssignments.find(p => p.jid === eliminated);",
"    if (target?.role === 'Jester') lobby.jesterWinner = eliminated;",
"    result.push('⚖️ ' + getPlayerLabel(lobby, eliminated) + ' dikeluarkan.\\n🎭 Role: ' + target.role);",
"    if (target?.role === 'Hunter') {",
"      const candidates = getAlivePlayers(lobby);",
"      if (lobby.hybrid && eliminated !== lobby.humanJid) {",
"        if (candidates.length) {",
"          const shot = candidates[Math.floor(Math.random() * candidates.length)];",
"          lobby.alivePlayers.delete(shot.jid);",
"          result.push('🏹 Hunter Virtual melakukan Last Shot!\\n🎯 ' + getPlayerLabel(lobby, shot.jid) + ' ikut gugur.\\n🎭 Role: ' + shot.role);",
"        } else result.push('🏹 Hunter tidak memiliki target.');",
"      } else if (candidates.length) {",
"        lobby.pendingHunterShot = eliminated;",
"        lobby.pendingAfterHunterPhase = 'night';",
"        await sock.sendMessage(eliminated, { text: '🏹 HUNTER LAST SHOT!\\n\\nPilih satu pemain hidup untuk ikut gugur.\\n\\nGunakan:\\n.ww shoot NAMA\\n\\nAtau lewati:\\n.ww skip' });",
"        result.push('🏹 Hunter menunggu pilihan Last Shot melalui chat pribadi.');",
"      } else result.push('🏹 Hunter tidak memiliki target.');",
"    }",
"  } else result.push('⚖️ Hasil voting seri. Tidak ada pemain yang dikeluarkan.');",
"  lobby.voting.started = false;",
"  lobby.phase = 'day';",
"  await sock.sendMessage(groupJid, { text: '📊 HASIL VOTING\\n\\n' + result.join('\\n\\n') + '\\n\\nVoting selesai.' });",
"  return true;",
"}"
].join('\n');

fs.writeFileSync(path, s.slice(0, start) + code + '\n');
console.log('Fungsi resolveVoting berhasil diperbarui.');
