function getAlivePlayers(lobby) {
  return lobby.roleAssignments.filter(
    player => lobby.alivePlayers.has(player.jid)
  );
}

function isWolf(role) {
  return role === 'Werewolf' || role === 'Alpha Werewolf';
}

function getPlayerList(lobby) {
  return getAlivePlayers(lobby).map(player => {
    const number = lobby.players.indexOf(player.jid) + 1;
    const label = lobby.hybrid
      ? player.jid === lobby.humanJid
        ? 'Pemain Manusia'
        : `Pemain Virtual ${number - 1}`
      : (lobby.playerNames?.[player.jid] || 'pemain') +
        ' (@' + player.jid.split('@')[0].split(':')[0] + ')';

    return `${number}. ${label}`;
  }).join('\n');
}

function getRemainingRoleSummary(lobby) {
  const alive = getAlivePlayers(lobby);

  const factions = {
    Werewolf: '🔴',
    'Alpha Werewolf': '🔴',
    Villager: '🟢',
    Seer: '🟢',
    Doctor: '🟢',
    Witch: '🟢',
    Hunter: '🟢',
    Guardian: '🟢',
    Jester: '🟣'
  };

  const counts = {};

  for (const player of alive) {
    counts[player.role] = (counts[player.role] || 0) + 1;
  }

  const order = [
    'Werewolf', 'Alpha Werewolf', 'Seer', 'Doctor',
    'Witch', 'Hunter', 'Guardian', 'Jester', 'Villager'
  ];

  const roles = [
    ...order.filter(role => counts[role]),
    ...Object.keys(counts).filter(role => !order.includes(role)).sort()
  ];

  const roleList = roles.map(role =>
    `${role}: ${counts[role]} orang ${factions[role] || '⚪'}`
  ).join('\n');

  return '👥 PEMAIN YANG MASIH HIDUP\n' +
    alive.map((player, index) => {
      const number = lobby.players.indexOf(player.jid) + 1;
      const name = lobby.hybrid
        ? player.jid === lobby.humanJid
          ? 'Pemain Manusia'
          : `Pemain Virtual ${number - 1}`
        : (lobby.playerNames?.[player.jid] || 'Pemain');

      return `${index + 1}. ${name}`;
    }).join('\n') +
    '\n\n📋 ROLE YANG MASIH TERSISA\n' +
    roleList +
    `\n\nTotal: ${alive.length} pemain masih hidup.`;
}

function randomTarget(players, actorJid) {
  const choices = players.filter(
    player => player.jid !== actorJid
  );

  if (!choices.length) return null;

  return choices[Math.floor(Math.random() * choices.length)].jid;
}

function initializeNightActions(lobby) {
  lobby.nightActions = {
    wolves: new Map(),
    seer: null,
    doctor: null,
    witchHeal: null,
    witchPoison: null,
    guardian: null,
    witchDone: false,
    guardianDone: false
  };

  if (!lobby.witchPotions) {
    lobby.witchPotions = {
      healUsed: false,
      poisonUsed: false
    };
  }
}

// MEMERIKSA PEMAIN YANG BELUM MELAKUKAN AKSI MALAM
export function getMissingNightActors(lobby) {
  const alive = getAlivePlayers(lobby);
  const actions = lobby.nightActions || {};
  const missing = [];

  for (const player of alive.filter(p => isWolf(p.role))) {
    if (!actions.wolves?.has(player.jid)) missing.push(player);
  }

  const seer = alive.find(p => p.role === 'Seer');
  if (seer && !actions.seer) missing.push(seer);

  const doctor = alive.find(p => p.role === 'Doctor');
  if (doctor && !actions.doctor) missing.push(doctor);

  const witch = alive.find(p => p.role === 'Witch');
  if (

    witch &&
    !actions.witchDone &&
    !(lobby.witchPotions?.healUsed && lobby.witchPotions?.poisonUsed)
  ) missing.push(witch);

  const guardian = alive.find(p => p.role === 'Guardian');
  if (guardian && !actions.guardianDone) missing.push(guardian);

  return missing;
}

export function isNightActionsComplete(lobby) {
  return getMissingNightActors(lobby).length === 0;
}

export async function remindMissingNightActions(sock, lobby) {
  const missing = getMissingNightActors(lobby);

  for (const player of missing) {
    if (lobby.hybrid && player.jid !== lobby.humanJid) continue;

    await sock.sendMessage(player.jid, {
      text:
        '⏳ AKSI MALAM BELUM DITERIMA!\n\n' +
        'Aksi role kamu belum tercatat. Silakan kirim aksi sesuai instruksi bot.'
    });
  }

  return missing;
}

// MEMULAI FASE MALAM
export async function startNight(sock, lobby, groupJid) {
  if (lobby.hybrid) {
    return startHybridNight(sock, lobby, groupJid);
  }

  if (lobby.status !== 'playing') {
    await sock.sendMessage(groupJid, {
      text: '❌ Permainan belum dimulai.'
    });
    return false;
  }

  if (lobby.pendingHunterShot) {
    await sock.sendMessage(groupJid, {
      text: '🏹 Hunter masih memiliki kesempatan Last Shot.'
    });
    return false;
  }

  if (lobby.phase === 'night') {
    await sock.sendMessage(groupJid, {
      text: '🌙 Fase malam sedang berlangsung.'
    });
    return true;
  }
  lobby.phase = 'night';
  initializeNightActions(lobby);

  const alive = getAlivePlayers(lobby);
  const playerList = getPlayerList(lobby);

  const targetFormat = lobby.hybrid ? 'NOMOR' : 'NAMA';
  const instructions = {
    Werewolf: '.ww kill ' + targetFormat,
    'Alpha Werewolf': '.ww kill ' + targetFormat,
    Seer: '.ww inspect ' + targetFormat,
    Doctor: '.ww protect ' + targetFormat,
    Witch:
      '.ww heal ' + targetFormat + '\n.ww poison ' + targetFormat + '\n.ww skip',
    Guardian:
      '.ww guard ' + targetFormat + '\n.ww skip'
  };

  for (const player of alive) {
    if (!instructions[player.role]) continue;

    try {
      await sock.sendMessage(player.jid, {
        text:
          '🌙 MALAM TELAH TIBA!\n\n' +
          instructions[player.role] +
          '\n\nDAFTAR PEMAIN:\n' +
          playerList +
          (player.role === 'Witch'
            ? '\n\n🧪 Setiap ramuan hanya bisa digunakan satu kali selama permainan.'
            : '') +
          (player.role === 'Guardian'
            ? '\n\n🛡️ Kamu tidak bisa melindungi diri sendiri atau target yang sama dua malam berturut-turut.'
            : '')
      });
    } catch (error) {
      console.error('Gagal mengirim instruksi malam:', error);
    }
  }

  await sock.sendMessage(groupJid, {
    text:
      '🌙 MALAM TELAH TIBA!\n\n' +
      '🐺 Werewolf, Seer, Doctor, Witch, dan Guardian silakan melakukan aksi melalui chat pribadi bot.'
  });

  return true;
}

// MEMULAI MALAM MODE HYBRID
export async function startHybridNight(sock, lobby, groupJid) {
  if (lobby.status !== 'playing') return false;

  if (lobby.phase === 'night') {
    await sock.sendMessage(groupJid, {
      text: '🌙 Fase malam sedang berlangsung.'
    });
    return true;
  }

  lobby.phase = 'night';
  initializeNightActions(lobby);

  const alive = getAlivePlayers(lobby);
  const humanJid = lobby.humanJid;

  // Aksi otomatis Werewolf virtual
  for (const wolf of alive.filter(player => isWolf(player.role))) {
    if (wolf.jid === humanJid) continue;

    const targets = alive.filter(player => !isWolf(player.role));
    const target = randomTarget(targets, wolf.jid);

    if (target) {
      lobby.nightActions.wolves.set(wolf.jid, target);
    }
  }

  // Aksi otomatis Seer virtual
  const seer = alive.find(player => player.role === 'Seer');

  if (seer && seer.jid !== humanJid) {
    const target = randomTarget(alive, seer.jid);

    if (target) {
      lobby.nightActions.seer = {
        sender: seer.jid,
        target
      };
    }
  }

  // Aksi otomatis Doctor virtual
  const doctor = alive.find(player => player.role === 'Doctor');

  if (doctor && doctor.jid !== humanJid) {
    const target = randomTarget(alive, doctor.jid);

    if (target) {
      lobby.nightActions.doctor = {
        sender: doctor.jid,
        target
      };
    }
  }

  // Witch virtual tidak menggunakan ramuan secara otomatis
  const witch = alive.find(player => player.role === 'Witch');

  if (witch && witch.jid !== humanJid) {
    lobby.nightActions.witchDone = true;
  }

  // Guardian virtual memilih perlindungan otomatis
  const guardian = alive.find(player => player.role === 'Guardian');

  if (guardian && guardian.jid !== humanJid) {
    const targets = alive.filter(player =>
      player.jid !== guardian.jid &&
      player.jid !== lobby.lastGuardianTarget
    );

    const target = randomTarget(targets, guardian.jid);

    if (target) {
      lobby.nightActions.guardian = {
        sender: guardian.jid,
        target
      };
      lobby.nightActions.guardianDone = true;
      lobby.lastGuardianTarget = target;
    } else {
      lobby.nightActions.guardianDone = true;
    }
  }

  // Instruksi pemain manusia
  const human = alive.find(player => player.jid === humanJid);

  const targetFormat = lobby.hybrid ? 'NOMOR' : 'NAMA';
  const instructions = {
    Werewolf: '.ww kill ' + targetFormat,
    'Alpha Werewolf': '.ww kill ' + targetFormat,
    Seer: '.ww inspect ' + targetFormat,
    Doctor: '.ww protect ' + targetFormat,
    Witch:
      '.ww heal ' + targetFormat + '\n.ww poison ' + targetFormat + '\n.ww skip',
    Guardian:
      '.ww guard ' + targetFormat + '\n.ww skip'
  };

  if (human && instructions[human.role]) {
    await sock.sendMessage(humanJid, {
      text:
        '🌙 MALAM TELAH TIBA!\n\n' +
        instructions[human.role] +
        '\n\nDAFTAR PEMAIN:\n' +
        getPlayerList(lobby)
    });
  }

  await sock.sendMessage(groupJid, {
    text:
      '🌙 MALAM TELAH TIBA!\n\n' +
      '🤖 Pemain virtual telah menjalankan aksi otomatis.\n' +
      '👤 Jika role kamu membutuhkan aksi, periksa chat pribadi bot.\n\n' +
      'Admin gunakan .ww check untuk memeriksa aksi yang belum masuk. Fase malam akan berlanjut otomatis setelah semua aksi lengkap.'
  });

  return true;
}

// MEMPROSES AKSI MALAM
export async function handleNightAction(
  sock,
  lobby,
  senderJid,
  command
) {
  if (lobby.status !== 'playing' || lobby.phase !== 'night') {
    return false;
  }

  const args = command.trim().split(/\s+/);
  const action = args[1]?.toLowerCase();
  const targetName = args.slice(2).join(' ').toLowerCase();

  const player = lobby.roleAssignments.find(
    item => item.jid === senderJid
  );

  if (!player || !lobby.alivePlayers.has(senderJid)) {
    return false;
  }

  const allowedActions = {
    Werewolf: 'kill',
    'Alpha Werewolf': 'kill',
    Seer: 'inspect',
    Doctor: 'protect',
    Witch: ['heal', 'poison', 'skip'],
    Guardian: ['guard', 'skip']
  };

  const allowed = allowedActions[player.role];

  if (
    !allowed ||
    (Array.isArray(allowed)
      ? !allowed.includes(action)
      : allowed !== action)
  ) {
    return false;
  }

  if (action === 'skip') {
    if (player.role === 'Witch') {
      lobby.nightActions.witchDone = true;
    } else if (player.role === 'Guardian') {
      lobby.nightActions.guardianDone = true;
    }

    await sock.sendMessage(senderJid, {
      text: '✅ Aksi malam dilewati.'
    });
    return true;
  }

  if (
    player.role === 'Witch' &&
    action === 'heal' &&
    lobby.witchPotions.healUsed
  ) {
    await sock.sendMessage(senderJid, {
      text: '❌ Ramuan penyembuh sudah digunakan.'
    });
    return true;
  }

  if (
    player.role === 'Witch' &&
    action === 'poison' &&
    lobby.witchPotions.poisonUsed
  ) {
    await sock.sendMessage(senderJid, {
      text: '❌ Ramuan racun sudah digunakan.'
    });
    return true;
  }

  let targetJid;

  if (targetName) {
    if (lobby.hybrid) {
      const number = Number(targetName);
      if (Number.isInteger(number) && number >= 1 && number <= lobby.players.length) {
        targetJid = lobby.players[number - 1];
      }
    } else {
      targetJid = lobby.players.find(jid =>
        (lobby.playerNames?.[jid] || '').toLowerCase() === targetName
      );
    }
  }

  if (!targetJid) {
    await sock.sendMessage(senderJid, {
      text: lobby.hybrid
        ? '❌ Nomor pemain tidak valid. Gunakan nomor pada daftar pemain.'
        : '❌ Nama pemain tidak valid. Gunakan nama yang terdaftar.'
    });
    return true;
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

  const target = lobby.roleAssignments.find(
    item => item.jid === targetJid
  );

  if (
    isWolf(player.role) &&
    isWolf(target.role)
  ) {
    await sock.sendMessage(senderJid, {
      text: '❌ Werewolf tidak dapat memilih sesama Werewolf.'
    });
    return true;
  }

  if (action === 'guard' && targetJid === lobby.lastGuardianTarget) {
    await sock.sendMessage(senderJid, {
      text: '❌ Guardian tidak dapat melindungi target yang sama dua malam berturut-turut.'
    });
    return true;
  }

  const actions = lobby.nightActions;

  if (action === 'kill') {
    if (actions.wolves.has(senderJid)) {
      await sock.sendMessage(senderJid, {
        text: '⚠️ Kamu sudah mengirim pilihan target.'
      });
      return true;
    }

    actions.wolves.set(senderJid, targetJid);
  }

  if (action === 'inspect') {
    if (actions.seer) {
      await sock.sendMessage(senderJid, {
        text: '⚠️ Kamu sudah melakukan pemeriksaan.'
      });
      return true;
    }

    actions.seer = {
      sender: senderJid,
      target: targetJid
    };

    const hidden = ['Alpha Werewolf', 'Jester'].includes(target.role);
    const result = hidden ? 'Identitas tidak diketahui' : target.role;

    await sock.sendMessage(senderJid, {
      text:
        '🔮 HASIL PEMERIKSAAN\n\n' +
        `Pemain ${lobby.hybrid
          ? targetJid === lobby.humanJid
            ? 'Manusia'
            : 'Virtual ' + lobby.players.indexOf(targetJid)
          : lobby.playerNames?.[targetJid] || targetJid} memiliki role: ${result}.`
    });

    return true;
  }

  if (action === 'protect') {
    if (actions.doctor) {
      await sock.sendMessage(senderJid, {
        text: '⚠️ Kamu sudah memilih pemain untuk dilindungi.'
      });
      return true;
    }

    actions.doctor = {
      sender: senderJid,
      target: targetJid
    };
  }

  if (action === 'heal') {
    if (actions.witchHeal) {
      await sock.sendMessage(senderJid, {
        text: '⚠️ Kamu sudah memilih target ramuan penyembuh malam ini.'
      });
      return true;
    }

    actions.witchHeal = {
      sender: senderJid,
      target: targetJid
    };

    lobby.witchPotions.healUsed = true;
  }

  if (action === 'poison') {
    if (actions.witchPoison) {
      await sock.sendMessage(senderJid, {
        text: '⚠️ Kamu sudah memilih target ramuan racun malam ini.'
      });
      return true;
    }

    actions.witchPoison = {
      sender: senderJid,
      target: targetJid
    };

    lobby.witchPotions.poisonUsed = true;
  }

  if (action === 'guard') {
    if (actions.guardian) {
      await sock.sendMessage(senderJid, {
        text: '⚠️ Kamu sudah memilih pemain untuk dilindungi.'
      });
      return true;
    }

    actions.guardian = {
      sender: senderJid,
      target: targetJid
    };

    actions.guardianDone = true;
    lobby.lastGuardianTarget = targetJid;
  }

  await sock.sendMessage(senderJid, {
    text: '✅ Aksi malam berhasil dikirim. Gunakan .ww skip jika sudah selesai.'
  });

  return true;
}

// MENYELESAIKAN FASE MALAM
export async function resolveNight(sock, lobby, groupJid, options = {}) {
  const force = options.force === true;
  if (lobby.status !== 'playing' || lobby.phase !== 'night') {
    await sock.sendMessage(groupJid, {
      text: '❌ Tidak sedang dalam fase malam.'
    });
    return false;
  }

  const alive = getAlivePlayers(lobby);

  const wolves = alive.filter(player => isWolf(player.role));
  const seerAlive = alive.some(player => player.role === 'Seer');
  const doctorAlive = alive.some(player => player.role === 'Doctor');
  const witch = alive.find(player => player.role === 'Witch');
  const guardianAlive = alive.some(player => player.role === 'Guardian');

  if (!force && wolves.some(wolf => !lobby.nightActions.wolves.has(wolf.jid))) {
    await sock.sendMessage(groupJid, {
      text: '⏳ Belum semua Werewolf mengirim pilihan target.'
    });
    return false;
  }

  if (!force && seerAlive && !lobby.nightActions.seer) {
    await sock.sendMessage(groupJid, {
      text: '⏳ Seer belum melakukan pemeriksaan.'
    });
    return false;
  }

  if (!force && doctorAlive && !lobby.nightActions.doctor) {
    await sock.sendMessage(groupJid, {
      text: '⏳ Doctor belum memilih pemain untuk dilindungi.'
    });
    return false;
  }

  if (
    !force &&
    witch &&
    !lobby.nightActions.witchDone &&
    !(lobby.witchPotions.healUsed && lobby.witchPotions.poisonUsed)
  ) {
    await sock.sendMessage(groupJid, {
      text: '⏳ Witch belum mengirim aksi atau .ww skip.'
    });
    return false;
  }

  if (!force && guardianAlive && !lobby.nightActions.guardianDone) {
    await sock.sendMessage(groupJid, {
      text: '⏳ Guardian belum mengirim aksi atau .ww skip.'
    });
    return false;
  }

  // Menghitung suara Werewolf
  const votes = new Map();

  for (const target of lobby.nightActions.wolves.values()) {
    votes.set(target, (votes.get(target) || 0) + 1);
  }

  const maxVotes = Math.max(0, ...votes.values());
  const winners = [...votes.entries()].filter(
    ([, count]) => count === maxVotes
  );

  let killed = null;

  if (winners.length === 1 && maxVotes > 0) {
    killed = winners[0][0];
  }

  // Perlindungan Doctor, Guardian, dan ramuan Witch
  const protectedTargets = [
    lobby.nightActions.doctor?.target,
    lobby.nightActions.guardian?.target,
    lobby.nightActions.witchHeal?.target
  ].filter(Boolean);

  if (killed && protectedTargets.includes(killed)) {
    killed = null;
  }

  // Target ramuan racun
  const poisonTarget = lobby.nightActions.witchPoison?.target;

  const victims = new Set();

  if (killed) victims.add(killed);

  if (poisonTarget) victims.add(poisonTarget);

  const eliminated = [];

  for (const victim of victims) {
    if (!lobby.alivePlayers.has(victim)) continue;

    lobby.alivePlayers.delete(victim);
    eliminated.push(victim);
  }

  // Hunter Last Shot
  const hunter = eliminated.find(jid =>
    lobby.roleAssignments.some(
      player => player.jid === jid && player.role === 'Hunter'
    )
  );

  if (hunter) {
    const candidates = lobby.roleAssignments.filter(
      player => lobby.alivePlayers.has(player.jid)
    );

    if (lobby.hybrid && hunter !== lobby.humanJid) {
      if (candidates.length > 0) {
        const shot = candidates[Math.floor(Math.random() * candidates.length)];
        lobby.alivePlayers.delete(shot.jid);
        eliminated.push(shot.jid);
      }
    } else if (candidates.length > 0) {
      lobby.pendingHunterShot = hunter;
      lobby.pendingAfterHunterPhase = 'day';

      await sock.sendMessage(hunter, {
        text:
          '🏹 HUNTER LAST SHOT!\n\n' +
          'Kamu telah gugur dan dapat memilih satu pemain hidup untuk ikut tereliminasi.\n\n' +
          (lobby.hybrid
            ? 'Gunakan nomor pemain:\n.ww shoot NOMOR\n\n'
            : 'Gunakan nama pemain:\n.ww shoot NAMA\n\n') +
          'Atau lewati:\n.ww skip'
      });
    }
  }
  let announcement;

  if (eliminated.length) {
    announcement = eliminated.map(jid => {
      const player = lobby.roleAssignments.find(
        item => item.jid === jid
      );

      const number = lobby.players.indexOf(jid);
      const name = lobby.hybrid
        ? jid === lobby.humanJid
          ? 'Pemain Manusia'
          : `Pemain Virtual ${number}`
        : (lobby.playerNames?.[jid] || 'pemain');

      return `☠️ ${name} (${player.role}) gugur malam ini.`;
    }).join('\n');
  } else {
    announcement = '☀️ Tidak ada pemain yang gugur malam ini.';
  }

  lobby.phase = 'day';

  await sock.sendMessage(groupJid, {
    text:
      '🌅 PAGI TELAH TIBA!\n\n' +
      announcement +
      '\n\n' + getRemainingRoleSummary(lobby) +
      '\n\nGunakan waktu ini untuk berdiskusi.'
  });

  return true;
}
