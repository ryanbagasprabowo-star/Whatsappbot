const fs = require('fs');
const path = 'src/voting.js';
let s = fs.readFileSync(path, 'utf8');

const marker = 'export async function resolveVoting(sock, lobby, groupJid) {';
const start = s.indexOf(marker);

if (start < 0) throw new Error('Fungsi resolveVoting tidak ditemukan.');

const replacement = `export async function resolveVoting(sock, lobby, groupJid) {
  if (
    lobby.status !== 'playing' ||
    lobby.phase !== 'voting' ||
    !lobby.voting?.started
  ) {
    await sock.sendMessage(groupJid, {
      text: '❌ Tidak ada voting yang sedang berlangsung.'
    });
    return false;
  }

  const alive = getAlivePlayers(lobby);

  if (alive.some(player => !lobby.voting.voters.has(player.jid))) {
    await sock.sendMessage(groupJid, {
      text: '⏳ Belum semua pemain yang hidup mengirim suara.'
    });
    return false;
  }

  const counts = new Map();
  for (const target of lobby.voting.votes.values()) {
    counts.set(target, (counts.get(target) || 0) + 1);
  }

  const maxVotes = Math.max(0, ...counts.values());
  const winners = [...counts.entries()].filter(([, count]) => count === maxVotes);
  let eliminated = null;
  const result = [];

  if (winners.length === 1 && maxVotes > 0) {
    eliminated = winners[0][0];
    lobby.alivePlayers.delete(eliminated);

    const target = lobby.roleAssignments.find(
      player => player.jid === eliminated
    );

    if (target?.role === 'Jester') {
      lobby.jesterWinner = eliminated;
    }

    const number = lobby.players.indexOf(eliminated) + 1;
    result.push(
      lobby.hybrid
        ? \`⚖️ Pemain nomor \${number} (\${getPlayerLabel(lobby, eliminated)}) dikeluarkan.\\n🎭 Role: \${target.role}\`
        : \`⚖️ \${getPlayerLabel(lobby, eliminated)} dikeluarkan.\\n🎭 Role: \${target.role}\`
    );

    if (target?.role === 'Hunter') {
      const candidates = getAlivePlayers(lobby);

      if (lobby.hybrid && eliminated !== lobby.humanJid) {
        if (candidates.length > 0) {
          const shot = candidates[Math.floor(Math.random() * candidates.length)];
          lobby.alivePlayers.delete(shot.jid);
          result.push(
            '🏹 Hunter Virtual melakukan Last Shot!\\n' +
            '🎯 ' + getPlayerLabel(lobby, shot.jid) + ' ikut gugur.\\n' +
            '🎭 Role: ' + shot.role
          );
        } else {
          result.push('🏹 Hunter tidak memiliki target Last Shot.');
        }
      } else if (candidates.length > 0) {
        lobby.pendingHunterShot = eliminated;
        lobby.pendingAfterHunterPhase = 'night';

        await sock.sendMessage(eliminated, {
          text:
            '🏹 HUNTER LAST SHOT!\\n\\n' +
            'Kamu telah gugur dan dapat memilih satu pemain hidup untuk ikut tereliminasi.\\n\\n' +
            (lobby.hybrid
              ? 'Gunakan nomor pemain:\\n.ww shoot NOMOR\\n\\n'
              : 'Gunakan nama pemain:\\n.ww shoot NAMA\\n\\n') +
            'Atau lewati:\\n.ww skip'
        });

        result.push('🏹 Hunter menunggu pilihan Last Shot melalui chat pribadi.');
      } else {
        result.push('🏹 Hunter tidak memiliki target Last Shot.');
      }
    }
  } else {
    result.push('⚖️ Hasil voting seri. Tidak ada pemain yang dikeluarkan.');
  }

  lobby.voting.started = false;
  lobby.phase = 'day';

  await sock.sendMessage(groupJid, {
    text: '📊 HASIL VOTING\\n\\n' + result.join('\\n\\n') + '\\n\\nVoting selesai.'
  });

  return true;
}
`;

s = s.slice(0, start) + replacement;
fs.writeFileSync(path, s);
console.log('resolveVoting diperbarui dengan Hunter Last Shot dan kemenangan Jester.');
