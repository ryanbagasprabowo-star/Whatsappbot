const fs = require('fs');

const nightFile = 'src/night.js';
const lobbyFile = 'src/lobby.js';

let night = fs.readFileSync(nightFile, 'utf8');
let lobby = fs.readFileSync(lobbyFile, 'utf8');

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: ditemukan ${count} anchor, seharusnya 1`);
  }
  return source.replace(anchor, replacement);
}

function replaceCount(source, anchor, replacement, expected, label) {
  const count = source.split(anchor).length - 1;
  if (count !== expected) {
    throw new Error(`${label}: ditemukan ${count} anchor, seharusnya ${expected}`);
  }
  return source.split(anchor).join(replacement);
}

console.log('Persiapan patch Cupid selesai.');
// Helper notifikasi pasangan Lovers.
async function notifyLovers(sock, lobby, pair) {
  for (const jid of pair) {
    const partnerJid = pair.find(id => id !== jid);
    const partner = lobby.roleAssignments.find(p => p.jid === partnerJid);
    const partnerName = lobby.playerNames?.[partnerJid] || 'Pemain';
    const partnerRole = partner?.role || 'Unknown';

    await sock.sendMessage(jid, {
      text:
        '💘 *KAMU MENJADI LOVERS!*\n\n' +
        `Pasanganmu: *${partnerName}*\n` +
        `Role pasangan: *${partnerRole}*\n\n` +
        '_Jika salah satu gugur, pasangannya ikut gugur._'
    });
  }
}

// Tambahkan status aksi Cupid.
night = replaceOnce(
  night,
  '    witchDone: false,\n    guardianDone: false',
  '    witchDone: false,\n    guardianDone: false,\n    cupidDone: false',
  'Status aksi Cupid'
);

// Cupid harus menyelesaikan pilihan pada malam pertama.
night = replaceOnce(
  night,
  `  const sorcerer = alive.find(p => p.role === 'Sorcerer');
  if (sorcerer && !actions.sorcerer) missing.push(sorcerer);

  return missing;`,
  `  const sorcerer = alive.find(p => p.role === 'Sorcerer');
  if (sorcerer && !actions.sorcerer) missing.push(sorcerer);

  const cupid = alive.find(p => p.role === 'Cupid');
  if (
    lobby.cupidFirstNight === true &&
    cupid &&
    cupid.jid !== mutedTarget &&
    alive.filter(p => p.jid !== cupid.jid).length >= 2 &&
    !actions.cupidDone
  ) missing.push(cupid);

  return missing;`,
  'Pemeriksaan giliran Cupid'
);
// Tambahkan instruksi Cupid pada malam pertama (mode normal).
night = replaceOnce(
  night,
  `    Guardian:
      '.ww guard ' + targetFormat + '\\n.ww skip'
  };

  for (const player of alive) {`,
  `    Guardian:
      '.ww guard ' + targetFormat + '\\n.ww skip'
  };

  if (lobby.cupidFirstNight === true) {
    instructions.Cupid = '.ww lovers Nama Pemain 1 | Nama Pemain 2';
  }

  for (const player of alive) {`,
  'Instruksi Cupid mode normal'
);

console.log('Instruksi Cupid mode normal berhasil disiapkan.');
// Instruksi Cupid untuk pemain manusia di Hybrid Mode.
night = replaceOnce(
  night,
  `  const instructions = {
    Werewolf: '.ww kill NOMOR',
    'Alpha Werewolf': '.ww kill NOMOR',
    Sorcerer: '.ww mute NOMOR',
    Seer: '.ww inspect NOMOR',
    Detective: '.ww inspect NOMOR',
    Doctor: '.ww protect NOMOR',
    Witch: '.ww heal NOMOR\\n.ww poison NOMOR\\n.ww skip',
    Guardian: '.ww guard NOMOR\\n.ww skip'
  };`,
  `  const instructions = {
    Werewolf: '.ww kill NOMOR',
    'Alpha Werewolf': '.ww kill NOMOR',
    Sorcerer: '.ww mute NOMOR',
    Seer: '.ww inspect NOMOR',
    Detective: '.ww inspect NOMOR',
    Doctor: '.ww protect NOMOR',
    Witch: '.ww heal NOMOR\\n.ww poison NOMOR\\n.ww skip',
    Guardian: '.ww guard NOMOR\\n.ww skip'
  };

  if (lobby.cupidFirstNight === true) {
    instructions.Cupid = '.ww lovers NOMOR1 NOMOR2';
  }`,
  'Instruksi Cupid Hybrid Mode'
);

console.log('Instruksi Cupid Hybrid Mode berhasil disiapkan.');


