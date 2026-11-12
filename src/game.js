export function checkWinner(lobby) {
  const alive = lobby.roleAssignments.filter(
    player => lobby.alivePlayers.has(player.jid)
  );

  const wolves = alive.filter(
    player => ['Werewolf', 'Alpha Werewolf'].includes(player.role)
  );

  const villagers = alive.filter(
    player => !['Werewolf', 'Alpha Werewolf', 'Jester'].includes(player.role)
  );

  if (wolves.length === 0) return 'Villagers';
  if (wolves.length >= villagers.length) return 'Werewolves';

  return null;
}

function getPlayerName(lobby, jid) {
  const normalize = value => {
    const [user, server] = value.split('@');
    return user && server ? user.split(':')[0] + '@' + server : value;
  };

  const target = normalize(jid);
  const entry = Object.entries(lobby.playerNames || {}).find(
    ([key]) => normalize(key) === target
  );

  return entry?.[1] || 'Pemain';
}

export async function checkGameEnd(sock, lobby, groupJid) {
  if (lobby.status !== 'playing' || lobby.pendingHunterShot) {
    return false;
  }

  const winner = lobby.jesterWinner ? 'Jester' : checkWinner(lobby);

  if (!winner) return false;

  lobby.status = 'finished';
  lobby.phase = 'finished';

  const messages = {
    Werewolves:
      '🐺 WEREWOLF MENANG!\n\nJumlah Werewolf menyamai atau melebihi pemain Villager.',
    Villagers:
      '🏡 VILLAGER MENANG!\n\nSemua Werewolf telah berhasil ditemukan.',
    Jester:
      '🃏 JESTER MENANG!\n\nJester berhasil dikeluarkan melalui voting.'
  };

  const roles = lobby.roleAssignments.map((player, index) => {
    const status = lobby.alivePlayers.has(player.jid)
      ? '🟢 Masih hidup'
      : '☠️ Gugur';

    const label = lobby.hybrid
      ? player.jid === lobby.humanJid
        ? 'Pemain Manusia'
        : `Pemain Virtual ${lobby.players.indexOf(player.jid)}`
      : getPlayerName(lobby, player.jid);

    return lobby.hybrid
  ? `${index + 1}. ${label} — ${player.role} (${status})`
  : `${label} — ${player.role} (${status})`;
  }).join('\n');

  await sock.sendMessage(groupJid, {
    text:
      '🏆 PERMAINAN BERAKHIR!\n\n' +
      messages[winner] +
      '\n\n📋 HASIL AKHIR:\n' +
      roles
  });

  return true;
}

export function prepareNextNight(lobby) {
  if (lobby.status !== 'playing') return false;

  lobby.phase = 'night';
  lobby.nightActions = {
    wolves: new Map(),
    seer: null,
    doctor: null
  };

  lobby.dayDiscussion = null;
  lobby.voting = null;

  return true;
}

export function prepareNextDay(lobby) {
  if (lobby.status !== 'playing') return false;

  lobby.phase = 'day';
  lobby.dayDiscussion = {
    started: false,
    alivePlayers: []
  };

  lobby.voting = null;

  return true;
}
