function recordEliminationBatch(lobby, eliminated) {
  if (!lobby?.hybrid && eliminated.length > 0) {
    lobby.latestEliminationBatch = new Set(eliminated);
  }
}

function eliminateOne(lobby, targetJid) {
  if (!lobby?.alivePlayers?.has(targetJid)) {
    return [];
  }

  const eliminated = [];
  const queue = [targetJid];

  while (queue.length > 0) {
    const jid = queue.shift();

    if (!lobby.alivePlayers.has(jid)) continue;

    lobby.alivePlayers.delete(jid);
    eliminated.push(jid);

    const lovers = lobby.lovers;

    if (Array.isArray(lovers) && lovers.length === 2 && lovers.includes(jid)) {
      const partner = lovers.find(item => item !== jid);

      if (partner && lobby.alivePlayers.has(partner)) {
        queue.push(partner);
      }
    }
  }

  return eliminated;
}

export function eliminatePlayer(lobby, targetJid) {
  const eliminated = eliminateOne(lobby, targetJid);
  recordEliminationBatch(lobby, eliminated);
  return eliminated;
}

export function eliminatePlayers(lobby, targets) {
  const eliminated = [];

  for (const target of targets) {
    for (const jid of eliminateOne(lobby, target)) {
      if (!eliminated.includes(jid)) {
        eliminated.push(jid);
      }
    }
  }

  // Semua korban dalam satu resolusi dieliminasi sebagai satu kejadian,
  // sehingga masing-masing tetap memiliki kesempatan mengirim Wasiat.
  recordEliminationBatch(lobby, eliminated);
  return eliminated;
}
