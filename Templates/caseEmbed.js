const { EmbedBuilder } = require('discord.js');

function statusEmoji(status) {
  const map = {
    'Pendente': '🟡',
    'Ativo': '🟢',
    'Arquivado': '⚫',
    'Suspenso': '⏸️',
    'Julgado': '✅'
  };
  return map[status] || '🟡';
}

function priorityEmoji(priority) {
  const map = { 'Baixa': '🟦', 'Média': '🟨', 'Alta': '🔴', 'Urgente': '🚨' };
  return map[priority] || '🟨';
}

const PARTICIPANT_LABELS = {
  judge: 'Juiz',
  author: 'Advogado Polo Ativo',
  passive: 'Advogado Polo Passivo'
};

function formatParticipantValue(value) {
  if (!value) return '—';
  if (typeof value === 'object' && value !== null) {
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
  const data = Object.assign({}, caseRow);
  // Parse JSON fields
  try { data.parties = JSON.parse(caseRow.parties || '[]'); } catch(e){ data.parties = []; }
  try { data.participants = JSON.parse(caseRow.participants || '{}'); } catch(e){ data.participants = {}; }
  try { data.metadata = JSON.parse(caseRow.metadata || '{}'); } catch(e){ data.metadata = {}; }
  try { data.timeline = JSON.parse(caseRow.timeline || '[]'); } catch(e){ data.timeline = []; }

  const embed = new EmbedBuilder()
    .setTitle(`${caseRow.case_number} — ${caseRow.title || 'Sem título'}`)
    .setColor('#2F3136')
    .setDescription(caseRow.description ? (caseRow.description.substring(0, 2048)) : '\u200b')
    .addFields(
      { name: 'Status', value: `${statusEmoji(caseRow.status)} ${caseRow.status || 'Pendente'}`, inline: true },
      { name: 'Prioridade', value: `${priorityEmoji(caseRow.priority)} ${caseRow.priority || 'Média'}`, inline: true },
      { name: 'Instância', value: `${caseRow.instance || 1}ª Instância`, inline: true },
      { name: 'Tribunal', value: caseRow.court || '—', inline: true },
      { name: 'Partes', value: (data.parties.length ? data.parties.join('\n') : '—'), inline: true },
      { name: 'Participantes', value: formatParticipants(data.participants), inline: true }
    )
    .setFooter({ text: `Registrado por ${caseRow.created_by || '—'} • ${new Date(caseRow.created_at || Date.now()).toLocaleString()}` });

  // Próxima audiência se houver no metadata
  if (data.metadata && data.metadata.next_hearing) {
    embed.addFields({ name: 'Próxima Audiência', value: new Date(data.metadata.next_hearing).toLocaleString(), inline: true });
  }

  return embed;
}

module.exports = { buildCaseEmbed };
