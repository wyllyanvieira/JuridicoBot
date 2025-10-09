const { EmbedBuilder } = require('discord.js');

function statusEmoji(status) {
  const map = {
    Pendente: '🟡',
    Ativo: '🟢',
    Arquivado: '⚫',
    Suspenso: '⏸️',
    Julgado: '✅',
  };
  return map[status] || '🟡';
}

function parseJSON(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function buildPartiesDisplay(metadata = {}, fallback = []) {
  const info = metadata.parties || {};
  const lines = [];

  if (info.active?.name || info.active?.stateId) {
    const pieces = [];
    if (info.active?.name) pieces.push(info.active.name);
    if (info.active?.stateId) pieces.push(`State ID: ${info.active.stateId}`);
    lines.push(`**Polo Ativo:** ${pieces.join(' — ') || '—'}`);
  }

  if (info.passive?.name || info.passive?.stateId) {
    const pieces = [];
    if (info.passive?.name) pieces.push(info.passive.name);
    if (info.passive?.stateId) pieces.push(`State ID: ${info.passive.stateId}`);
    lines.push(`**Polo Passivo:** ${pieces.join(' — ') || '—'}`);
  }

  if (!lines.length && Array.isArray(fallback) && fallback.length) {
    return fallback;
  }

  return lines.length ? lines : ['—'];
}

const PARTICIPANT_LABELS = {
  judge: 'Juiz',
  author: 'Advogado Polo Ativo',
  passive: 'Advogado Polo Passivo',
};

function formatParticipantValue(value) {
  if (!value) return '—';
  if (typeof value === 'object') {
    if (value.id) {
      const mention = `<@${value.id}>`;
      return value.tag ? `${mention} (${value.tag})` : mention;
    }
    if (value.mention) return value.mention;
    if (value.name) return value.name;
  }
  return String(value);
}

function formatParticipants(participants = {}) {
  const entries = [];
  const handledKeys = new Set();
  for (const key of Object.keys(PARTICIPANT_LABELS)) {
    if (participants[key]) {
      entries.push([key, participants[key]]);
      handledKeys.add(key);
    }
  }
  for (const [key, value] of Object.entries(participants)) {
    if (!handledKeys.has(key)) {
      entries.push([key, value]);
    }
  }

  if (!entries.length) return '—';

  return entries
    .map(([key, value]) => {
      const label = PARTICIPANT_LABELS[key] || key;
      return `**${label}**: ${formatParticipantValue(value)}`;
    })
    .join('\n');
}

function buildCaseEmbed(caseRow) {
  const participants = parseJSON(caseRow.participants, {});
  const metadata = parseJSON(caseRow.metadata, {});
  const partiesList = buildPartiesDisplay(metadata, parseJSON(caseRow.parties, []));
  const timeline = parseJSON(caseRow.timeline, []);
  const lastUpdate = timeline.length
    ? new Date(timeline[timeline.length - 1].at || caseRow.updated_at || caseRow.created_at || Date.now())
    : new Date(caseRow.created_at || Date.now());

  const embed = new EmbedBuilder()
    .setTitle(`${caseRow.case_number} — ${caseRow.title || 'Sem título'}`)
    .setColor('#2F3136')
    .setDescription(
      caseRow.description ? caseRow.description.substring(0, 2048) : '\u200b'
    )
    .addFields(
      {
        name: 'Status',
        value: `${statusEmoji(caseRow.status)} ${caseRow.status || 'Pendente'}`,
        inline: true,
      },
      {
        name: 'Instância',
        value: `${caseRow.instance || 1}ª Instância`,
        inline: true,
      },
      {
        name: 'Tipo',
        value: caseRow.type || metadata.type || '—',
        inline: true,
      },
      {
        name: 'Partes',
        value: partiesList.join('\n'),
        inline: false,
      },
      {
        name: 'Participantes',
        value: formatParticipants(participants),
        inline: false,
      }
    )
    .setFooter({
      text: `Registrado por ${caseRow.created_by || '—'} • ${new Date(
        caseRow.created_at || Date.now()
      ).toLocaleString()}`,
    });

  if (metadata.next_hearing) {
    embed.addFields({
      name: 'Próxima Audiência',
      value: new Date(metadata.next_hearing).toLocaleString(),
      inline: true,
    });
  }

  embed.setTimestamp(lastUpdate);

  return embed;
}

module.exports = { buildCaseEmbed, buildPartiesDisplay };
