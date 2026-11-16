import fs from 'fs';
import { eliminatePlayer } from './elimination.js';
import { createRoles, getRoleInfo } from './roles.js';

import {
  startNight,
  resolveNight,
  handleNightAction,
  isNightActionsComplete,
  remindMissingNightActions
} from './night.js';

import {
  startDay,
  endDay
} from './day.js';

import {
  startVoting,
  handleVote,
  resolveVoting,
  isVotingComplete,
  remindMissingVotes,
  autoFillMissingVotes
} from './voting.js';

import {
  checkGameEnd
} from './game.js';

const lobbies = new Map();
const finishedWillLobbies = new Map();

const ROLE_STICKER_PATHS = {
  'Werewolf': '../assets/role-stickers/werewolf.webp',
  'Alpha Werewolf': '../assets/role-stickers/werewolf%20alpha.webp',
  'Seer': '../assets/role-stickers/seer.webp',
  'Doctor': '../assets/role-stickers/doctor.webp',
  'Witch': '../assets/role-stickers/witch.webp',
  'Hunter': '../assets/role-stickers/Hunter.webp',
  'Guardian': '../assets/role-stickers/guardian.webp',
  'Jester': '../assets/role-stickers/jester.webp',
  'Cupid': '../assets/role-stickers/role-cupid.webp',
  'Sorcerer': '../assets/role-stickers/role-sorcerer.webp',
  'Detective': '../assets/role-stickers/role-detective.webp',
  'Villager': '../assets/role-stickers/vilager.webp'
};

function getRoleSticker(role) {
  const stickerPath = ROLE_STICKER_PATHS[role];

  if (!stickerPath) {
    throw new Error(`Stiker untuk role "${role}" tidak ditemukan.`);
  }

  return fs.readFileSync(new URL(stickerPath, import.meta.url));
}


function getLobbyRoleComposition() {
  const icons = {
    'Werewolf': '🐺',
    'Alpha Werewolf': '👑🐺',
    'Sorcerer': '🔇',
    'Seer': '🔮',
    'Doctor': '🩺',
    'Witch': '🧙',
    'Hunter': '🏹',
    'Guardian': '🛡️',
    'Cupid': '💘',
    'Detective': '🔍',
    'Villager': '👤',
    'Jester': '🤡'
  };

  function renderComposition(total, compact = false) {
    const assignments = createRoles(
      Array.from({ length: total }, (_, i) => `preview-${i}@simulation`)
    );

    const counts = {};

    for (const player of assignments) {
      counts[player.role] = (counts[player.role] || 0) + 1;
    }

    const wolves = Object.entries(counts)
      .filter(([role]) =>
        ['Werewolf', 'Alpha Werewolf', 'Sorcerer'].includes(role)
      )
      .map(([role, count]) => `${icons[role]} ×${count}`)
      .join(' ');

    const village = Object.entries(counts)
      .filter(([role]) =>
        !['Werewolf', 'Alpha Werewolf', 'Sorcerer', 'Jester', 'Villager'].includes(role)
      )
      .map(([role, count]) => `${icons[role]} ×${count}`);

    if (compact) {
      village.push('👤 ×1–3');
    } else if (counts.Villager) {
      village.push(`👤 ×${counts.Villager}`);
    }

    const jester = counts.Jester
      ? `${icons.Jester} ×${counts.Jester}`
      : '';

    return [
      `👥 *${compact ? '13–15' : total} PEMAIN*`,
      wolves ? `🔴 ${wolves}` : '',
      village.length ? `🔵 ${village.join(' ')}` : '',
      jester ? `🟣 ${jester}` : ''
    ].filter(Boolean).join('\n');
  }

  const sections = [];

  for (let total = 5; total <= 12; total++) {
    sections.push(renderComposition(total));
  }

  sections.push(renderComposition(13, true));

  return sections.join('\n\n');
}

function createHybridPlayers(humanJid) {
  return [
    humanJid,
    'virtual-1@simulation',
    'virtual-2@simulation',
    'virtual-3@simulation',
    'virtual-4@simulation'
  ];
}

function normalizeJid(jid) {
  if (!jid) return '';

  const [user, server] = jid.split('@');

  if (!user || !server) return jid;

  return `${user.split(':')[0]}@${server}`;
}

function sameJid(first, second) {
  return normalizeJid(first) === normalizeJid(second);
}

async function isGroupAdmin(sock, groupJid, senderJids) {
  const metadata = await sock.groupMetadata(groupJid);
  const candidates = Array.isArray(senderJids)
    ? senderJids
    : [senderJids];

  const participant = metadata.participants.find(p =>
    candidates.some(jid =>
      sameJid(jid, p.id) ||
      sameJid(jid, p.lid)
    )
  );

  return participant?.admin === 'admin' ||
         participant?.admin === 'superadmin';
}

function findPlayerJid(lobby, senderJids) {
  const candidates = Array.isArray(senderJids)
    ? senderJids
    : [senderJids];

  return lobby.players.find(player => {
    if (candidates.some(jid => sameJid(player, jid))) {
      return true;
    }

    if (
      lobby.hybrid &&
      player === lobby.humanJid
    ) {
      return (lobby.humanJids || []).some(alias =>
        candidates.some(jid => sameJid(alias, jid))
      );
    }

    return false;
  }) || null;
}

function archiveLastWillState(lobby, groupJid) {
  if (
    !lobby?.hybrid &&
    lobby.latestEliminationBatch instanceof Set &&
    lobby.latestEliminationBatch.size > 0
  ) {
    finishedWillLobbies.set(groupJid, lobby);
  }
}

async function handleWillMessage(sock, senderJids, rawCommand) {
  const match = rawCommand.trim().match(/^\\.ww\\s+will(?:\\s+([\\s\\S]*))?$/i);
  if (!match) return false;

  const willText = (match[1] || '').trim();
  if (!willText) {
    await sock.sendMessage(Array.isArray(senderJids) ? senderJids[0] : senderJids, {
      text: 'Gunakan .ww will <isi wasiat> untuk mengirim wasiat.'
    });
    return true;
  }

  const candidates = [
    ...lobbies.entries(),
    ...finishedWillLobbies.entries()
  ];

  for (const [groupJid, lobby] of candidates) {
    if (lobby.hybrid) continue;

    const playerJid = findPlayerJid(lobby, senderJids);
    if (!playerJid) continue;

    const player = lobby.roleAssignments?.find(item => item.jid === playerJid);
    if (!player) continue;

    if (lobby.alivePlayers?.has(playerJid)) {
      await sock.sendMessage(playerJid, {
        text: '⛔ Wasiat hanya dapat dikirim setelah kamu gugur.'
      });
      return true;
    }

    if (!lobby.latestEliminationBatch?.has(playerJid)) {
      await sock.sendMessage(playerJid, {
        text: '⌛ Kesempatan Wasiat kamu telah berakhir karena ada pemain lain yang gugur setelahmu.'
      });
      return true;
    }

    lobby.willUsed ||= new Set();
    if (lobby.willUsed.has(playerJid)) {
      await sock.sendMessage(playerJid, {
        text: '⚠️ Kamu sudah mengirim Wasiat. Setiap pemain hanya dapat mengirim satu kali.'
      });
      return true;
    }

    lobby.willUsed.add(playerJid);
    const playerName = lobby.playerNames?.[playerJid] || 'Pemain';
    await sock.sendMessage(groupJid, {
      text:
        '📜 *WASIAT TERAKHIR*\n\n' +
        '🕯️ ' + playerName + ' meninggalkan pesan terakhir:\n\n' +
        '“' + willText + '”'
    });
    await sock.sendMessage(playerJid, {
      text: '✅ Wasiat kamu berhasil disampaikan kepada seluruh pemain.'
    });
    return true;
  }

  return false;
}

export async function handleEliminatedGroupMessage(sock, groupJid, senderJids, messageKey) {
  const lobby = lobbies.get(groupJid);
  if (
    !lobby ||
    lobby.status !== 'playing' ||
    lobby.hybrid ||
    !lobby.alivePlayers
  ) return false;

  const playerJid = findPlayerJid(lobby, senderJids);
  if (!playerJid || lobby.alivePlayers.has(playerJid)) return false;

  try {
    const metadata = await sock.groupMetadata(groupJid);
    const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean);
    const bot = metadata.participants.find(participant =>
      botIds.some(id =>
        sameJid(id, participant.id) || sameJid(id, participant.lid)
      )
    );
    if (bot?.admin !== 'admin' && bot?.admin !== 'superadmin') {
      return false;
    }

    await sock.sendMessage(groupJid, { delete: messageKey });
    return true;
  } catch (error) {
    console.error('[AUTO DELETE ELIMINATED MESSAGE]', error);
    return false;
  }
}

async function finishNightPhase(sock, lobby, groupJid, force = false) {
  if (lobby.status !== 'playing' || lobby.phase !== 'night') return false;

  const resolved = await resolveNight(
    sock,
    lobby,
    groupJid,
    force ? { force: true } : {}
  );

  if (!resolved || lobby.pendingHunterShot) return resolved;

  const finished = await checkGameEnd(sock, lobby, groupJid);
  if (finished) {
    archiveLastWillState(lobby, groupJid);
    lobbies.delete(groupJid);
  } else {
    await startDay(sock, lobby, groupJid);
  }

  return true;
}

async function finishVotingPhase(sock, lobby, groupJid) {
  if (lobby.status !== 'playing' || lobby.phase !== 'voting') return false;

  const resolved = await resolveVoting(sock, lobby, groupJid);
  if (!resolved || lobby.pendingHunterShot) return resolved;

  const finished = await checkGameEnd(sock, lobby, groupJid);
  if (finished) {
    archiveLastWillState(lobby, groupJid);
    lobbies.delete(groupJid);
  } else {
    await startNightAndAutoResolve(sock, lobby, groupJid);
  }

  return true;
}

async function startNightAndAutoResolve(sock, lobby, groupJid) {
  await startNight(sock, lobby, groupJid);

  if (
    lobby.status === 'playing' &&
    lobby.phase === 'night' &&
    isNightActionsComplete(lobby)
  ) {
    await finishNightPhase(sock, lobby, groupJid);
  }
}

async function startVotingAndAutoResolve(sock, lobby, groupJid) {
  await startVoting(sock, lobby, groupJid);

  if (
    lobby.status === 'playing' &&
    lobby.phase === 'voting' &&
    isVotingComplete(lobby)
  ) {
    await finishVotingPhase(sock, lobby, groupJid);
  }
}

async function handleHunterAction(sock, lobby, playerJid, command, groupJid) {
  if (!lobby.pendingHunterShot || !sameJid(lobby.pendingHunterShot, playerJid)) return false;
  const args = command.trim().toLowerCase().split(/\s+/);
  const action = args[1];
  let targetJid = null;
  if (action === 'skip') {
    // Hunter memilih melewati Last Shot.
  } else if (action === 'shoot') {
    const input = args[2] || '';
    if (!input) {
      await sock.sendMessage(playerJid, {
        text: lobby.hybrid
          ? 'Gunakan .ww shoot NOMOR untuk memilih target.'
          : 'Gunakan .ww shoot NAMA untuk memilih target.'
      });
      return true;
    }
    if (lobby.hybrid) {
      const number = Number(input);
      if (!Number.isInteger(number) || number < 1 || number > lobby.players.length) {
        await sock.sendMessage(playerJid, { text: '❌ Nomor pemain tidak valid.' });
        return true;
      }
      targetJid = lobby.players[number - 1];
   } else {
  if (/^[a-z0-9]+$/.test(input)) {
    targetJid = lobby.players.find(jid =>
      (lobby.playerNames?.[jid] || '').toLowerCase() === input
    );
  }
}
    if (!targetJid || !lobby.alivePlayers.has(targetJid) || sameJid(targetJid, playerJid)) {
      await sock.sendMessage(playerJid, { text: '❌ Target tidak valid atau sudah gugur. Pilih pemain yang masih hidup.' });
      return true;
    }
    eliminatePlayer(lobby, targetJid);
  } else {
    return false;
  }
  const nextPhase = lobby.pendingAfterHunterPhase || 'day';
  lobby.pendingHunterShot = null;
  lobby.pendingAfterHunterPhase = null;
  let announcement;
  if (targetJid) {
    const target = lobby.roleAssignments.find(p => p.jid === targetJid);
    const label = lobby.hybrid
      ? (targetJid === lobby.humanJid ? 'Pemain Manusia' : 'Pemain Virtual ' + lobby.players.indexOf(targetJid))
      : (lobby.playerNames?.[targetJid] || 'Pemain');
    announcement = '🏹 *HUNTER LAST SHOT*\n\n🎯 _' + label + ' ikut gugur._\n🎭 _Role: ' + target.role + '_\n\n🔥 _Dengan sisa kekuatannya, Hunter melepaskan tembakan terakhir. Sebuah keputusan terakhir yang menyeret ' + label + ' menuju nasib yang sama._';
  } else {
    announcement = '🏹 *HUNTER LAST SHOT*\n\n_Hunter melewati kesempatan untuk memilih target._';
  }
  await sock.sendMessage(groupJid, { text: announcement });
  const finished = await checkGameEnd(sock, lobby, groupJid);
  if (finished) {
    archiveLastWillState(lobby, groupJid);
    lobbies.delete(groupJid);
  } else if (nextPhase === 'night') {
    await startNightAndAutoResolve(sock, lobby, groupJid);
  } else {
    await startDay(sock, lobby, groupJid);
  }
  return true;
}

export async function handlePrivateNightMessage(sock, senderJid, command) {
  if (await handleWillMessage(sock, senderJid, command)) return true;

  for (const [groupJid, lobby] of lobbies.entries()) {
    if (lobby.status !== 'playing') continue;
    const playerJid = findPlayerJid(lobby, senderJid);
    if (!playerJid) continue;
    const normalizedCommand = command.trim().toLowerCase();
    if (lobby.pendingHunterShot && (normalizedCommand === '.ww shoot' || normalizedCommand.startsWith('.ww shoot ') || normalizedCommand === '.ww skip')) {
      const handled = await handleHunterAction(sock, lobby, playerJid, command, groupJid);
      if (handled) return true;
    }
    if (
      normalizedCommand.startsWith('.ww kill ') ||
      normalizedCommand.startsWith('.ww mute ') ||
      normalizedCommand.startsWith('.ww inspect ') ||
      normalizedCommand.startsWith('.ww protect ') ||
      normalizedCommand.startsWith('.ww heal ') ||
      normalizedCommand.startsWith('.ww poison ') ||
      normalizedCommand.startsWith('.ww guard ') ||
      normalizedCommand.startsWith('.ww lovers ') ||
      normalizedCommand === '.ww skip'
    ) {
      const handled = await handleNightAction(sock, lobby, playerJid, command);
      if (handled) {
        if (
          lobby.status === 'playing' &&
          lobby.phase === 'night' &&
          isNightActionsComplete(lobby)
        ) {
          await finishNightPhase(sock, lobby, groupJid);
        }
        return true;
      }
    }
    if (normalizedCommand.startsWith('.ww pilih ')) {
      const handled = await handleVote(sock, lobby, playerJid, command);
      if (handled) {
        if (
          lobby.status === 'playing' &&
          lobby.phase === 'voting' &&
          isVotingComplete(lobby)
        ) {
          await finishVotingPhase(sock, lobby, groupJid);
        }
        return true;
      }
    }
  }
  return false;
}
export async function handleLobby(
  sock,
  groupJid,
  senderJid,
  command,
  senderJids = [senderJid]
) {
  const allSenderJids = [...new Set([
    senderJid,
    ...(senderJids || [])
  ].filter(Boolean))];

  const args = command.trim().toLowerCase().split(/\s+/);
  const action = args[1];

  if (!action) return false;

  // MENU BANTUAN COMMAND
  if (action === 'admin') {
    const admin = await isGroupAdmin(
      sock,
      groupJid,
      allSenderJids
    );

    const playerHelp =
      '*🐺 BANTUAN PEMAIN*\n\n' +
      '*PEMAIN — GRUP*\n' +
      '_.ww join NAMA_ — Bergabung ke lobby\n' +
      '_.ww leave_ — Keluar dari lobby\n' +
      '_.ww players_ — Melihat daftar pemain\n\n' +
      '*PEMAIN — CHAT PRIBADI BOT*\n' +
      '_.ww pilih NAMA/NOMOR_ — Mengirim pilihan voting\n' +
      '_.ww kill NAMA/NOMOR_ — Memilih target Werewolf\n' +
      '_.ww inspect NAMA/NOMOR_ — Memeriksa pemain sebagai Seer\n' +
      '_.ww protect NAMA/NOMOR_ — Melindungi pemain sebagai Doctor\n' +
      '_.ww heal NAMA/NOMOR_ — Menggunakan ramuan penyembuh\n' +
      '_.ww poison NAMA/NOMOR_ — Menggunakan ramuan racun\n' +
      '_.ww guard NAMA/NOMOR_ — Melindungi pemain sebagai Guardian\n' +
      '_.ww skip_ — Melewati aksi yang tersedia\n' +
      '_.ww shoot NAMA/NOMOR_ — Tembakan terakhir Hunter jika tersedia\n\n' +
      '_Gunakan NAMA pada mode normal dan NOMOR pada mode hybrid._';

    const adminHelp =
      '*👑 BANTUAN ADMIN GRUP*\n\n' +
      '_.ww papanda_ — Membuka lobby baru\n' +
      '_.ww start_ — Memulai permainan\n' +
      '_.ww day_ — Memulai fase siang\n' +
      '_.ww vote_ — Memulai fase voting\n' +
      '_.ww night_ — Memulai fase malam\n' +
      '_.ww check_ — Memeriksa aksi dan mengingatkan pemain yang belum bertindak\n' +
      '_.ww count-_ — Mengisi voting kosong dan menyelesaikan voting\n' +
      '_.ww resolve-_ — Memaksa penyelesaian malam dengan aksi yang sudah tercatat\n' +
      '_.ww hybrid_ — Menjalankan mode hybrid\n' +
      '_.ww test [5–15]_ — Menjalankan simulasi\n' +
      '_.ww stop_ — Menghentikan permainan\n\n' +
      '_Gunakan command sesuai fase permainan._';

    await sock.sendMessage(groupJid, {
      text: playerHelp + (admin ? '\n\n' + adminHelp : '')
    });

    return true;
  }

  const adminOnly = [
    'papanda',
    'start',
    'stop',
    'test',
    'night',
    'check',
    'resolve-',
    'count-',
    'hybrid',
    'day',
    'vote'
  ];

  if (adminOnly.includes(action)) {
    const admin = await isGroupAdmin(
      sock,
      groupJid,
      allSenderJids
    );

    if (!admin) {
      await sock.sendMessage(groupJid, {
        text: '⛔ Perintah ini hanya bisa digunakan admin grup.'
      });

      return true;
    }
  }

  // ROLE DM PREVIEW
  if (action === 'check' && args.length >= 3) {
    const requestedRole = args.slice(2).join(' ').trim().toLowerCase();

    const roles = [
      'Werewolf',
      'Alpha Werewolf',
      'Sorcerer',
      'Seer',
      'Detective',
      'Doctor',
      'Witch',
      'Hunter',
      'Guardian',
      'Cupid',
      'Jester',
      'Villager'
    ];

    const role = roles.find(
      item => item.toLowerCase() === requestedRole
    );

    if (!role) {
      await sock.sendMessage(groupJid, {
        text:
          '⚠️ Role tidak ditemukan. Gunakan nama role yang tersedia.\\n' +
          roles.join(', ')
      });
      return true;
    }

    try {
      // PESAN 1: STIKER ROLE
      await sock.sendMessage(senderJid, {
        sticker: getRoleSticker(role)
      });

      // PESAN 2: INFORMASI ROLE
      await sock.sendMessage(senderJid, {
        text: getRoleInfo(role) +
          '\n\n_🔒 Jangan beritahu role kamu kepada pemain lain!_'
      });

      // PESAN 3: SIMULASI INSTRUKSI MALAM
      const target = 'NAMA';
      const instructions = {
        Werewolf: '.ww kill ' + target,
        'Alpha Werewolf': '.ww kill ' + target,
        Sorcerer: '.ww mute ' + target,
        Seer: '.ww inspect ' + target,
        Detective: '.ww inspect ' + target,
        Doctor: '.ww protect ' + target,
        Guardian: '.ww guard ' + target
      };

      let nightText = '🌙 *NIGHT PHASE*\n\n' +
        '_Silakan lakukan aksi sesuai role kamu._\n\n';

      if (role === 'Witch') {
        nightText +=
          '_.ww heal ' + target + '_\n' +
          '_.ww poison ' + target + '_\n' +
          '_.ww skip_';
      } else if (instructions[role]) {
        nightText += '_' + instructions[role] + '_';

        if (role === 'Guardian') {
          nightText +=
            '\n\n_Kamu tidak bisa melindungi diri sendiri atau target yang sama dua malam berturut-turut._';
        }
      } else {
        nightText += '_Role ini tidak memiliki perintah aksi malam._';
      }

      await sock.sendMessage(senderJid, {
        text: nightText
      });

      await sock.sendMessage(groupJid, {
        text: '✅ Preview pesan DM ' + role + ' sudah dikirim ke admin.'
      });
    } catch (error) {
      console.error('Gagal mengirim role preview:', error);

      await sock.sendMessage(groupJid, {
        text: '❌ Gagal mengirim preview role ke DM.'
      });
    }
    return true;
  }

  // MEMBUKA LOBBY
  if (action === 'papanda') {
    if (lobbies.has(groupJid)) {
      await sock.sendMessage(groupJid, {
        text:
          '⚠️ Lobby sudah tersedia.\n' +
          'Gunakan .ww players untuk melihat pemain.'
      });

      return true;
    }

    finishedWillLobbies.delete(groupJid);
    lobbies.set(groupJid, {
      players: [],
      status: 'waiting'
    });

    await sock.sendMessage(groupJid, {
      sticker: fs.readFileSync(
        new URL('../assets/papanda-werewolf-sticker.webp', import.meta.url)
      )
    });

    await sock.sendMessage(groupJid, {
      text:
        '🐺 *PAPANDA WEREWOLF* 🐼\n' +
        '_WELCOME TO THE GAME_\n\n' +
        '👥 *5–15 PEMAIN*\n\n' +
        '📜 *KOMPOSISI ROLE*\n' +
        getLobbyRoleComposition() +
        '\n\n' +
        'Ketik *.ww join NAMA* untuk bergabung.\n' +
        '_Gunakan .ww players untuk melihat daftar pemain._'
    });

    return true;
  }

  // MODE SIMULASI
  if (action === 'test') {
    const count = Number(args[2] || 8);

    if (
      !Number.isInteger(count) ||
      count < 5 ||
      count > 15
    ) {
      await sock.sendMessage(groupJid, {
        text: 'Gunakan .ww test 5 sampai .ww test 15.'
      });

      return true;
    }

    const virtualPlayers = Array.from(
      { length: count },
      (_, i) => `virtual-${i + 1}@simulation`
    );

    const assignments = createRoles(virtualPlayers);
    const roleCounts = {};

    for (const player of assignments) {
      roleCounts[player.role] =
        (roleCounts[player.role] || 0) + 1;
    }

    const result = assignments.map((player, i) =>
      `${i + 1}. Pemain Virtual ${i + 1} — ${player.role}`
    ).join('\n');

    await sock.sendMessage(groupJid, {
      text:
        '🧪 WEREWOLF SIMULATION\n\n' +
        `Jumlah pemain virtual: ${count}\n\n` +
        '📊 KOMPOSISI ROLE\n' +
        Object.entries(roleCounts)
          .map(([role, total]) => `${role}: ${total}`)
          .join('\n') +
        '\n\n🎭 HASIL PENGACAKAN\n' +
        result +
        '\n\n✅ Simulasi selesai!\n' +
        'Tidak ada pesan pribadi yang dikirim.'
    });

    return true;
  }

  // MODE HYBRID
  if (action === 'hybrid') {
    if (lobbies.has(groupJid)) {
      await sock.sendMessage(groupJid, {
        text:
          '⚠️ Masih ada lobby aktif.\n' +
          'Gunakan .ww stop terlebih dahulu.'
      });

      return true;
    }

    const players = createHybridPlayers(senderJid);
    const assignments = createRoles(players);

    const human = assignments.find(
      player => player.jid === senderJid
    );

    const lobby = {
      players,
      roleAssignments: assignments,
      alivePlayers: new Set(players),
      roleDelivery: new Set([senderJid]),
      humanJid: senderJid,
      humanJids: allSenderJids,
      hybrid: true,
      lovers: null,
      cupidUsed: false,
      status: 'playing',
      phase: 'night',
      nightActions: {
        wolves: new Map(),
        seer: null,
        doctor: null
      }
    };

    lobbies.set(groupJid, lobby);

    await sock.sendMessage(senderJid, {
      sticker: getRoleSticker(human.role)
    });

    const hasAlpha = assignments.some(
      player => player.role === 'Alpha Werewolf'
    );

    const showWolfTeam =
      human.role === 'Alpha Werewolf' ||
      human.role === 'Sorcerer' ||
      (human.role === 'Werewolf' && !hasAlpha);

    const messageParts = [getRoleInfo(human.role)];

    if (showWolfTeam) {
      const wolfTeam = assignments
        .filter(player =>
          ['Werewolf', 'Alpha Werewolf'].includes(player.role)
        )
        .map(player => {
          if (player.jid === senderJid) return '_Kamu_';

          const number = players.indexOf(player.jid);
          return '_Pemain Virtual ' + number + '_';
        });

      messageParts.push(
        '🐺 *IDENTITAS TIM WEREWOLF*\n' +
        wolfTeam.join('\n') +
        '\n\n🔒 _Informasi ini rahasia._'
      );
    }

    messageParts.push(
      '🔒 _Jangan beritahu role kamu kepada siapa pun!_'
    );

    await sock.sendMessage(senderJid, {
      text: messageParts.join('\n\n')
    });

    await sock.sendMessage(groupJid, {
      text:
        '🐼 PAPANDA WEREWOLF BOT\n\n' +
        '🎮 MODE HYBRID BERHASIL DIBUAT!\n\n' +
        '👤 Pemain manusia: 1\n' +
        '🤖 Pemain virtual: 4\n' +
        '🎭 Role telah diacak.\n\n' +
        '🌙 Permainan dimulai pada malam pertama.'
    });

    await startNightAndAutoResolve(sock, lobby, groupJid);

    return true;
  }

  const lobby = lobbies.get(groupJid);

  if (!lobby) {
    await sock.sendMessage(groupJid, {
      text:
        '❌ Belum ada lobby.\n' +
        'Admin dapat membuka dengan .ww papanda.'
    });

    return true;
  }

  // MEMULAI MALAM
  if (action === 'night') {
    await startNightAndAutoResolve(sock, lobby, groupJid);
    return true;
  }

  // MEMERIKSA AKSI SESUAI FASE
  if (action === 'check') {
    if (lobby.phase === 'night') {
      if (!isNightActionsComplete(lobby)) {
        const missing = await remindMissingNightActions(sock, lobby);
        await sock.sendMessage(groupJid, {
          text: '⏳ *AKSI MALAM BELUM LENGKAP*\n\n' +
            '_Masih ada ' + missing.length + ' aksi yang belum diterima._\n' +
            '_Pengingat telah dikirim melalui chat pribadi bot._'
        });
      } else {
        await finishNightPhase(sock, lobby, groupJid);
      }
      return true;
    }

    if (lobby.phase === 'voting') {
      if (!isVotingComplete(lobby)) {
        const missing = await remindMissingVotes(sock, lobby);
        await sock.sendMessage(groupJid, {
          text: '⏳ *VOTING BELUM LENGKAP*\n\n' +
            '_Masih ada ' + missing.length + ' pemain yang belum voting._\n' +
            '_Pengingat telah dikirim melalui chat pribadi bot._'
        });
      } else {
        await finishVotingPhase(sock, lobby, groupJid);
      }
      return true;
    }

    await sock.sendMessage(groupJid, {
      text: '❌ .ww check hanya dapat digunakan saat fase malam atau voting.'
    });
    return true;
  }

  // MEMAKSA PENYELESAIAN MALAM TANPA MENGISI AKSI KOSONG
  if (action === 'resolve-') {
    if (lobby.phase !== 'night') {
      await sock.sendMessage(groupJid, {
        text: '❌ .ww resolve- hanya dapat digunakan saat fase malam.'
      });
      return true;
    }

    await finishNightPhase(sock, lobby, groupJid, true);
    return true;
  }

  // MENCEGAH PERUBAHAN FASE SAAT HUNTER MENUNGGU LAST SHOT
  if (
    lobby.pendingHunterShot &&
    (action === 'day' || action === 'vote')
  ) {
    await sock.sendMessage(groupJid, {
      text: '🏹 *HUNTER LAST SHOT*\n\n_Hunter masih memiliki kesempatan. Tunggu sampai pilihannya selesai._'
    });
    return true;
  }

  // MEMULAI DISKUSI SIANG
  if (action === 'day') {
    await startDay(sock, lobby, groupJid);
    return true;
  }

  // MEMULAI VOTING
  if (action === 'vote') {
    if (lobby.phase === 'day') {
      const ended = await endDay(sock, lobby, groupJid);
      if (!ended) return true;
    }

    await startVotingAndAutoResolve(sock, lobby, groupJid);
    return true;
  }

  // MENGISI VOTING KOSONG DAN MENGHITUNG HASIL
  if (action === 'count-') {
    if (lobby.phase !== "voting" || !lobby.voting?.started) {
      await sock.sendMessage(groupJid, {
        text: '❌ .ww count- hanya dapat digunakan saat fase voting.'
      });
      return true;
    }

    const filled = autoFillMissingVotes(lobby);
    await sock.sendMessage(groupJid, {
      text: '🎲 Voting otomatis mengisi ' + filled +
        ' suara yang belum masuk.'
    });
    await finishVotingPhase(sock, lobby, groupJid);
    return true;
  }

  // BERGABUNG
  if (action === 'join') {
    const playerName = args[2] || '';
    lobby.playerNames ||= {};

    if (!/^[a-z0-9]+$/.test(playerName)) {
      await sock.sendMessage(groupJid, {
        text: '❌ Nama hanya boleh huruf dan angka tanpa spasi. Contoh: .ww join bagas'
      });
      return true;
    }

    if (playerName.length > 7) {
      await sock.sendMessage(groupJid, {
        text: '❌ Nama terlalu panjang!\n_Nama pemain maksimal 7 karakter.'
      });
      return true;
    }

    if (lobby.status !== 'waiting') {
      await sock.sendMessage(groupJid, {
        text: '❌ Lobby sudah ditutup untuk pemain baru.'
      });
      return true;
    }

    if (lobby.players.some(p => sameJid(p, senderJid))) {
      await sock.sendMessage(groupJid, {
        text: '⚠️ Kamu sudah terdaftar di lobby!'
      });
      return true;
    }

    if (Object.values(lobby.playerNames).includes(playerName)) {
      await sock.sendMessage(groupJid, {
        text: '❌ Nama tersebut sudah digunakan.'
      });
      return true;
    }

    if (lobby.players.length >= 15) {
      await sock.sendMessage(groupJid, {
        text: '❌ Lobby sudah penuh! Maksimal 15 pemain.'
      });
      return true;
    }

    lobby.players.push(senderJid);
    lobby.playerNames[senderJid] = playerName;

    await sock.sendMessage(groupJid, {
      text: '✅ PEMAIN BERGABUNG: ' + playerName + '\n\n' +
        'Jumlah pemain: ' + lobby.players.length +
        '/15\nKetik .ww players untuk melihat pemain.'
    });
    return true;
  }

  // KELUAR
  if (action === 'leave') {
    if (lobby.status !== 'waiting') {
      await sock.sendMessage(groupJid, {
        text: '❌ Lobby sudah dikunci.'
      });

      return true;
    }

    if (!lobby.players.some(p => sameJid(p, senderJid))) {
      await sock.sendMessage(groupJid, {
        text: 'Kamu belum bergabung ke lobby.'
      });

      return true;
    }

    lobby.playerNames ||= {};
    const leavingJid = lobby.players.find(player => sameJid(player, senderJid));
    if (leavingJid) delete lobby.playerNames[leavingJid];

    lobby.players = lobby.players.filter(
      player => !sameJid(player, senderJid)
    );

    await sock.sendMessage(groupJid, {
      text:
        '👋 Kamu keluar dari lobby.\n' +
        'Pemain tersisa: ' +
        lobby.players.length
    });

    return true;
  }

  // DAFTAR PEMAIN
  if (action === 'players') {
    lobby.playerNames ||= {};

    const list = lobby.players.length
      ? lobby.players.map((player, i) =>
          (i + 1) + '. ' + (lobby.playerNames[player] || 'pemain')
        ).join('\n')
      : 'Belum ada pemain.';

    await sock.sendMessage(groupJid, {
      text: '🐺 DAFTAR PEMAIN\n\n' + list +
        '\n\nJumlah: ' + lobby.players.length +
        '/15\nStatus: ' + lobby.status
    });

    return true;
  }

  // MEMULAI DAN MEMBAGIKAN ROLE
  if (action === 'start') {
    if (lobby.status === 'playing') {
      await sock.sendMessage(groupJid, {
        text: '⚠️ Permainan sudah dimulai.'
      });

      return true;
    }

    if (
      lobby.status !== 'waiting' &&
      lobby.status !== 'dealing'
    ) {
      await sock.sendMessage(groupJid, {
        text: '⚠️ Lobby tidak dapat dimulai.'
      });

      return true;
    }

    if (
      lobby.status === 'waiting' &&
      lobby.players.length < 5
    ) {
      await sock.sendMessage(groupJid, {
        text: '❌ Minimal 5 pemain untuk memulai permainan.'
      });

      return true;
    }

    if (!lobby.roleAssignments) {
      lobby.roleAssignments = createRoles(lobby.players);
      lobby.roleDelivery = new Set();
    }

    lobby.status = 'dealing';

    const failed = [];

    lobby.roleDelivery ||= new Set();
  lobby.roleWelcomeDelivery ||= new Set();
  lobby.roleStickerDelivery ||= new Set();
  lobby.roleInfoDelivery ||= new Set();

  for (const player of lobby.roleAssignments) {
    if (lobby.roleDelivery.has(player.jid)) continue;

    try {
      if (!lobby.roleStickerDelivery.has(player.jid)) {
        await sock.sendMessage(player.jid, {
          sticker: getRoleSticker(player.role)
        });

        lobby.roleStickerDelivery.add(player.jid);
      }

      if (!lobby.roleInfoDelivery.has(player.jid)) {
        const hasAlpha = lobby.roleAssignments.some(
          p => p.role === 'Alpha Werewolf'
        );

        const showWolfTeam =
          player.role === 'Alpha Werewolf' ||
          player.role === 'Sorcerer' ||
          (player.role === 'Werewolf' && !hasAlpha);

        const messageParts = [];

        messageParts.push(getRoleInfo(player.role));

        if (showWolfTeam) {
          const wolfTeamEntries = await Promise.all(
            lobby.roleAssignments
              .filter(w =>
                ['Werewolf', 'Alpha Werewolf'].includes(w.role)
              )
              .map(async (w) => {
                let phoneJid = w.jid;

                if (phoneJid.endsWith('@lid')) {
                  try {
                    phoneJid = await sock.signalRepository.lidMapping.getPNForLID(phoneJid) || '';
                  } catch {
                    phoneJid = '';
                  }
                }

                const number = phoneJid.endsWith('@s.whatsapp.net')
                  ? phoneJid.split('@')[0].split(':')[0]
                  : '';

                const name = lobby.playerNames?.[w.jid] || 'Pemain';

                return number
                  ? '_' + name + '_ (@' + number + ')'
                  : '_' + name + '_';
              })
          );

          messageParts.push(
            '🐺 *IDENTITAS TIM WEREWOLF*\n' +
            wolfTeamEntries.join('\n') +
            '\n\n🔒 _Informasi ini rahasia._'
          );
        }

        messageParts.push(
          '_🔒 Jangan beritahu role kamu kepada pemain lain!_'
        );

        await sock.sendMessage(player.jid, {
          text: messageParts.join('\n\n')
        });

        lobby.roleInfoDelivery.add(player.jid);
      }

      lobby.roleDelivery.add(player.jid);

    } catch (error) {
      console.error(
        'Gagal mengirim role:',
        player.jid,
        error
      );

      failed.push(player.jid);
    }
  }

  if (failed.length > 0) {
      await sock.sendMessage(groupJid, {
        text:
          '⚠️ Pembagian role belum selesai.\n\n' +
          'Ada ' +
          failed.length +
          ' pemain yang belum menerima role.\n' +
          'Admin dapat mencoba kembali dengan .ww start\n\n' +
          'Role pemain yang sudah menerima pesan tidak akan diacak ulang.'
      });

      return true;
    }

    lobby.alivePlayers = new Set(lobby.players);
    lobby.lovers = null;
    lobby.cupidUsed = false;
    lobby.phase = 'night';
    lobby.status = 'playing';

    lobby.nightActions = {
      wolves: new Map(),
      seer: null,
      doctor: null
    };

    await sock.sendMessage(groupJid, {
      text:
        '🐼 WELCOME TO PAPANDA WEREWOLF BOT\n\n' +
        '🎭 PEMBAGIAN ROLE BERHASIL!\n\n' +
        'Semua pemain telah menerima role melalui chat pribadi.\n\n' +
        '🌙 Permainan dimulai pada malam pertama.'
    });

    await startNightAndAutoResolve(sock, lobby, groupJid);

    return true;
  }

  // MENUTUP LOBBY
  if (action === 'stop') {
    lobbies.delete(groupJid);

    await sock.sendMessage(groupJid, {
      text: '🛑 Lobby Werewolf telah dihentikan oleh admin.'
    });

    return true;
  }

  return false;
}
