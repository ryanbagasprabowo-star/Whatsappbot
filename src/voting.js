
function getAlivePlayers(lobby) {
  return lobby.roleAssignments.filter(
    player => lobby.alivePlayers.has(player.jid)
  );
}

function getPlayerLabel(lobby, jid) {
  if (lobby.hybrid) {
    if (jid === lobby.humanJid) return 'Pemain Manusia';
    return `Pemain Virtual ${lobby.players.indexOf(jid)}`;
  }

  return lobby.playerNames?.[jid] || 'pemain';
}

export async function startVoting(sock, lobby, groupJid) {
  if (lobby.status !== 'playing' || lobby.phase !== 'voting') {
    await sock.sendMessage(groupJid, {
      text: '❌ Voting hanya dapat dimulai pada fase voting.'
    });
    return false;
  }

  if (lobby.voting?.started) {
    await sock.sendMessage(groupJid, {
      text: '⚠️ Voting sudah berlangsung.'
    });
    return false;
  }

  const alive = getAlivePlayers(lobby);

  lobby.voting = {
    started: true,
    votes: new Map(),
    voters: new Set()
  };

  // Pemain virtual memilih secara otomatis.
  if (lobby.hybrid) {
    for (const player of alive) {
      if (player.jid === lobby.humanJid) continue;

      const targets = alive.filter(
        target => target.jid !== player.jid
      );

      if (!targets.length) continue;

      const target = targets[
        Math.floor(Math.random() * targets.length)
      ];

      lobby.voting.votes.set(player.jid, target.jid);
      lobby.voting.voters.add(player.jid);
    }
  }

  const playerList = alive.map(player => {
    if (lobby.hybrid) {
      const number = lobby.players.indexOf(player.jid) + 1;
      return `${number}. ${getPlayerLabel(lobby, player.jid)}`;
    }

    return getPlayerLabel(lobby, player.jid);
  }).join('\n');

  if (lobby.hybrid) {
    await sock.sendMessage(lobby.humanJid, {
      text:
        '🗳️ VOTING DIMULAI!\n\n' +
        'Pilih pemain yang ingin kamu keluarkan:\n\n' +
        playerList +
        '\n\nGunakan:\n.ww pilih NOMOR'
    });
  } else {
    for (const player of alive) {
      await sock.sendMessage(player.jid, {
        text:
          '🗳️ VOTING DIMULAI!\n\n' +
          'Pilih pemain yang ingin kamu keluarkan:\n\n' +
          playerList +
          '\n\nGunakan:\n.ww pilih NAMA'
      });
    }
  }

  await sock.sendMessage(groupJid, {
    text:
      '🗳️ VOTING TELAH DIMULAI!\n\n' +
      'Silakan kirim pilihan melalui chat pribadi bot.\n' +
      'Admin dapat menyelesaikan voting dengan:\n' +
      '.ww count'
  });

  return true;
}

export async function handleVote(
  sock,
  lobby,
  senderJid,
  command
) {
  if (
    lobby.status !== 'playing' ||
    lobby.phase !== 'voting' ||
    !lobby.voting?.started
  ) {
    return false;
  }

  const player = lobby.roleAssignments.find(
    item => item.jid === senderJid
  );

  if (!player || !lobby.alivePlayers.has(senderJid)) {
    return false;
  }

  if (lobby.voting.voters.has(senderJid)) {
    await sock.sendMessage(senderJid, {
      text: '⚠️ Kamu sudah mengirim suara.'
    });
    return true;
  }

  const args = command.trim().split(/\s+/);
  const targetInput = args.slice(2).join(' ').trim();
  let targetJid;

  if (lobby.hybrid) {
    const number = Number(targetInput);

    if (
      !Number.isInteger(number) ||
      number < 1 ||
      number > lobby.players.length
    ) {
      await sock.sendMessage(senderJid, {
        text: '❌ Nomor pemain tidak valid.'
      });
      return true;
    }

    targetJid = lobby.players[number - 1];
  } else {
    const normalizedInput = targetInput.toLowerCase();

    targetJid = lobby.players.find(jid =>
      (lobby.playerNames?.[jid] || '').trim().toLowerCase() ===
      normalizedInput
    );

    if (!targetJid) {
      await sock.sendMessage(senderJid, {
        text: '❌ Nama pemain tidak valid. Gunakan nama yang terdaftar.'
      });
      return true;
    }
  }

  if (!lobby.alivePlayers.has(targetJid)) {
    await sock.sendMessage(senderJid, {
      text: '❌ Pemain tersebut sudah gugur.'
    });
    return true;
  }

  if (targetJid === senderJid) {
    await sock.sendMessage(senderJid, {
      text: '❌ Kamu tidak dapat memilih diri sendiri.'
    });
    return true;
  }

  lobby.voting.votes.set(senderJid, targetJid);
  lobby.voting.voters.add(senderJid);

  await sock.sendMessage(senderJid, {
    text: '✅ Suara kamu berhasil dicatat.'
  });

  return true;
}

export async function resolveVoting(sock, lobby, groupJid) {
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

  const winners = [...counts.entries()].filter(
    ([, count]) => count === maxVotes
  );

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
        ? `⚖️ Pemain nomor ${number} (${getPlayerLabel(lobby, eliminated)}) dikeluarkan.\n🎭 Role: ${target.role}`
        : `⚖️ ${getPlayerLabel(lobby, eliminated)} dikeluarkan.\n🎭 Role: ${target.role}`
    );

    if (target?.role === 'Hunter') {
      const candidates = getAlivePlayers(lobby);

      if (lobby.hybrid && eliminated !== lobby.humanJid) {
        if (candidates.length > 0) {
          const shot = candidates[
            Math.floor(Math.random() * candidates.length)
          ];

          lobby.alivePlayers.delete(shot.jid);

          result.push(
            '🏹 Hunter Virtual melakukan Last Shot!\n' +
            '🎯 ' + getPlayerLabel(lobby, shot.jid) + ' ikut gugur.\n' +
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
            '🏹 HUNTER LAST SHOT!\n\n' +
            'Kamu telah gugur dan dapat memilih satu pemain hidup untuk ikut tereliminasi.\n\n' +
            (lobby.hybrid
              ? 'Gunakan nomor pemain:\n.ww shoot NOMOR\n\n'
              : 'Gunakan nama pemain:\n.ww shoot NAMA\n\n') +
            'Atau lewati:\n.ww skip'
        });

        result.push(
          '🏹 Hunter menunggu pilihan Last Shot melalui chat pribadi.'
        );
      } else {
        result.push('🏹 Hunter tidak memiliki target Last Shot.');
      }
    }
  } else {
    result.push(
      '⚖️ Hasil voting seri. Tidak ada pemain yang dikeluarkan.'
    );
  }

  // Rekap suara semua pemain yang hidup saat voting dimulai.
  const voteSummary = alive.map(player => {
    const votes = counts.get(player.jid) || 0;

    if (lobby.hybrid) {
      const number = lobby.players.indexOf(player.jid) + 1;

      return `${number}. ${getPlayerLabel(lobby, player.jid)} — ${votes} suara`;
    }

    return `${getPlayerLabel(lobby, player.jid)} — ${votes} suara`;
  }).join('\n');

  lobby.voting.started = false;
  lobby.phase = 'day';

  await sock.sendMessage(groupJid, {
    text:
      '📊 HASIL VOTING\n\n' +
      '🗳️ PEROLEHAN SUARA:\n' +
      voteSummary +
      '\n\n' +
      result.join('\n\n') +
      '\n\nVoting selesai.'
  });

  return true;
}

