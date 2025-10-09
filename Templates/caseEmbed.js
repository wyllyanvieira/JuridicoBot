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
      { name: 'Participantes', value: (Object.keys(data.participants).length ? Object.entries(data.participants).map(([k,v]) => `**${k}**: ${v}`).join('\n') : '—'), inline: true }
    )
    .setFooter({ text: `Registrado por ${caseRow.created_by || '—'} • ${new Date(caseRow.created_at || Date.now()).toLocaleString()}` });

  // Próxima audiência se houver no metadata
  if (data.metadata && data.metadata.next_hearing) {
    embed.addFields({ name: 'Próxima Audiência', value: new Date(data.metadata.next_hearing).toLocaleString(), inline: true });
  }

  return embed;
}

module.exports = { buildCaseEmbed };
