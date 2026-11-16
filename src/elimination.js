export function eliminatePlayer(lobby, targetJid) {
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

export function eliminatePlayers(lobby, targets) {
  const eliminated = [];

  for (const target of targets) {
    for (const jid of eliminatePlayer(lobby, target)) {
      if (!eliminated.includes(jid)) {
        eliminated.push(jid);
      }
    }
  }

  return eliminated;
}
