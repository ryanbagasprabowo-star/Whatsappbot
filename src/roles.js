export function createRoles(players) {
  const total = players.length;

  if (!Number.isInteger(total) || total < 5 || total > 15) {
    throw new Error('Jumlah pemain harus 5 sampai 15 orang.');
  }

  let roles = [];

  if (total <= 6) {
    roles = [
      'Werewolf',
      'Seer',
      'Doctor'
    ];
  } else if (total === 7) {
    roles = [
      'Werewolf',
      'Werewolf',
      'Seer',
      'Doctor'
    ];
  } else if (total <= 10) {
    roles = [
      'Werewolf',
      'Werewolf',
      'Seer',
      'Doctor',
      'Witch',
      'Hunter',
      'Guardian'
    ];
  } else {
    roles = [
      'Werewolf',
      'Werewolf',
      'Alpha Werewolf',
      'Seer',
      'Doctor',
      'Witch',
      'Hunter',
      'Guardian',
      'Jester'
    ];
  }

  roles.push(...Array(total - roles.length).fill('Villager'));

  // Acak urutan role
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  return players.map((jid, i) => ({
    jid,
    role: roles[i]
  }));
}

export function getRoleInfo(role) {
  const descriptions = {
    Werewolf:
      '🐺 WEREWOLF\n\nKamu adalah Werewolf.\nPada malam hari, pilih target bersama Werewolf lainnya.',

    'Alpha Werewolf':
      '🐺 ALPHA WEREWOLF\n\nKamu adalah pemimpin tim Werewolf.\nPada malam hari, pilih target bersama Werewolf lainnya.\nKamu juga mengetahui identitas seluruh anggota tim Werewolf.',

    Seer:
      '🔮 SEER\n\nKamu adalah Seer.\nPada malam hari, kamu dapat memeriksa identitas seorang pemain.',

    Doctor:
      '🩺 DOCTOR\n\nKamu adalah Doctor.\nPada malam hari, kamu dapat memilih seorang pemain untuk dilindungi dari serangan.',

    Witch:
      '🧙 WITCH\n\nKamu adalah Witch.\nKamu memiliki satu ramuan penyembuh dan satu ramuan racun.\nMasing-masing ramuan hanya dapat digunakan satu kali selama permainan.',

    Hunter:
      '🏹 HUNTER\n\nKamu adalah Hunter.\nJika kamu gugur, kamu mendapatkan kesempatan Last Shot untuk mengeliminasi satu pemain yang masih hidup.',

    Guardian:
      '🛡️ GUARDIAN\n\nKamu adalah Guardian.\nPada malam hari, kamu dapat melindungi seorang pemain dari serangan Werewolf.\nKamu tidak dapat melindungi target yang sama dua malam berturut-turut.',

    Jester:
      '🃏 JESTER\n\nKamu adalah Jester.\nTujuanmu adalah membuat dirimu sendiri tereliminasi melalui voting agar bisa memenangkan permainan.',

    Villager:
      '👨‍🌾 VILLAGER\n\nKamu adalah Villager.\nDiskusikan siapa yang mencurigakan dan gunakan voting untuk menemukan Werewolf.'
  };

  return descriptions[role] || 'Role tidak ditemukan.';
}
