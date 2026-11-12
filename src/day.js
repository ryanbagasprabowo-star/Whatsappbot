function getAlivePlayers(lobby) {
  return lobby.roleAssignments.filter(
    player => lobby.alivePlayers.has(player.jid)
  );
}

function getPlayerName(lobby, jid) {
  const normalize = value => {
    const [user, server] = value.split('@');
    return user && server ? user.split(':')[0] + '@' + server : value;
  };
  const target = normalize(jid);
  const entry = Object.entries(lobby.playerNames || {}).find(([key]) => normalize(key) === target);
  return entry?.[1] || 'Pemain';
}

function getPlayerLabel(lobby, player) {
  if (lobby.hybrid) {
    if (player.jid === lobby.humanJid) {
      return 'Pemain Manusia';
    }

    const number = lobby.players.indexOf(player.jid);
    return `Pemain Virtual ${number}`;
  }

  return getPlayerName(lobby, player.jid);
}

export async function startDay(sock, lobby, groupJid) {
  if (lobby.status !== 'playing') {
    await sock.sendMessage(groupJid, {
      text: '❌ Permainan belum dimulai.'
    });
    return false;
  }

    if (lobby.phase !== 'day') {
    await sock.sendMessage(groupJid, {
      text: '❌ Saat ini bukan fase siang.'
    });
    return false;
  }

  const alive = getAlivePlayers(lobby);

  if (!alive.length) {
    await sock.sendMessage(groupJid, {
      text: '❌ Tidak ada pemain yang tersisa.'
    });
    return false;
  }

  const playerList = alive.map(player => {
  if (lobby.hybrid) {
    const number = lobby.players.indexOf(player.jid) + 1;
    return `${number}. ${getPlayerLabel(lobby, player)}`;
  }

  return getPlayerName(lobby, player.jid);
}).join('\n');

  lobby.dayDiscussion = {
    started: true,
    alivePlayers: alive.map(player => player.jid)
  };

  await sock.sendMessage(groupJid, {
    text:
      '☀️ PAGI TELAH TIBA!\n\n' +
      '🗣️ WAKTU DISKUSI DIMULAI!\n\n' +
      '👥 PEMAIN YANG MASIH HIDUP:\n' +
      playerList +
      '\n\n' +
      'Diskusikan siapa yang kalian curigai.\n\n' +
      'Admin dapat memulai voting dengan:\n' +
      '.ww vote'
  });

  return true;
}

export async function endDay(sock, lobby, groupJid) {
  if (lobby.status !== 'playing') {
    await sock.sendMessage(groupJid, {
      text: '❌ Permainan belum dimulai.'
    });
    return false;
  }

  if (lobby.phase !== 'day') {
    await sock.sendMessage(groupJid, {
      text: '❌ Saat ini bukan fase siang.'
    });
    return false;
  }

  lobby.phase = 'voting';

  await sock.sendMessage(groupJid, {
    text: '🗳️ WAKTU DISKUSI BERAKHIR!'
  });

  return true;
}
