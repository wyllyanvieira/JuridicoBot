const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { buildCaseEmbed, buildPartiesDisplay } = require('../Templates/caseEmbed');

const PANEL_ROLES = {
  judge: {
    label: 'Juiz',
    waiting: 'Aguardando habilitação do Juiz.',
  },
  author: {
    label: 'Defensor do Polo Ativo',
    waiting: 'Aguardando defensor do Polo Ativo.',
  },
  passive: {
    label: 'Defensor do Polo Passivo',
    waiting: 'Aguardando defensor do Polo Passivo.',
  },
};

function parseJSON(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function parseParticipants(raw) {
  return parseJSON(raw, {});
}

function formatParticipantDisplay(entry) {
  if (!entry) return null;
  if (typeof entry === 'object') {
    if (entry.id) {
      const mention = `<@${entry.id}>`;
      return entry.tag ? `${mention} (${entry.tag})` : mention;
    }
    if (entry.mention) return entry.mention;
    if (entry.name) return entry.name;
  }
  return String(entry);
}

function isParticipantAssigned(entry) {
  if (!entry) return false;
  if (typeof entry === 'object') {
    if (entry.id || entry.mention || entry.name) return true;
  }
  return String(entry).trim().length > 0;
}

function allParticipantsAssigned(participants = {}) {
  return Object.keys(PANEL_ROLES).every((key) =>
    isParticipantAssigned(participants[key])
  );
}

function buildPanelEmbed(participants = {}) {
  const embed = new EmbedBuilder()
    .setTitle('Painel de Habilitação')
    .setColor('#f1c40f')
    .setDescription(
      'Clique nos botões abaixo para se habilitar no processo. Somente perfis com os cargos apropriados podem se habilitar.'
    );

  const fields = Object.keys(PANEL_ROLES).map((key) => {
    const data = PANEL_ROLES[key];
    const display = formatParticipantDisplay(participants[key]);
    return {
      name: data.label,
      value: display || data.waiting,
      inline: true,
    };
  });

  embed.addFields(fields);
  return embed;
}

function buildJudgeActionsRow(caseId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`case_actions_${caseId}`)
    .setPlaceholder('Ações disponíveis para o Juiz')
    .addOptions(
      {
        label: '⚖️ Alterar Instância',
        value: 'alter_instance',
        description: 'Promover o processo para a 2ª instância com o histórico anexado.',
      },
      {
        label: '📨 Emitir Intimação',
        value: 'emit_intimation',
        description: 'Notificar uma parte com prazo e motivo definidos.',
      },
      {
        label: '📅 Agendar Audiência/Julgamento',
        value: 'schedule_hearing',
        description: 'Registrar audiência e avisar as partes.',
      },
      {
        label: '✏️ Editar Informações do Processo',
        value: 'edit_case',
        description: 'Atualizar dados principais do processo.',
      }
    );

  return [new ActionRowBuilder().addComponents(select)];
}

function buildPanelButtons(caseId, participants = {}) {
  if (allParticipantsAssigned(participants)) {
    return buildJudgeActionsRow(caseId);
  }

  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`enable_judge_${caseId}`)
      .setLabel('⚖️ Juiz')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isParticipantAssigned(participants.judge)),
    new ButtonBuilder()
      .setCustomId(`enable_author_${caseId}`)
      .setLabel('🛡️ Defensor do Polo Ativo')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isParticipantAssigned(participants.author)),
    new ButtonBuilder()
      .setCustomId(`enable_passive_${caseId}`)
      .setLabel('🛡️ Defensor do Polo Passivo')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isParticipantAssigned(participants.passive))
  );

  return [row];
}

function buildPanelMessage(caseRow) {
  const participants = parseParticipants(caseRow.participants);
  const everyoneReady = allParticipantsAssigned(participants);
  return {
    content: everyoneReady
      ? '**PAINEL DE HABILITAÇÃO** — Todas as partes estão habilitadas. Utilize o menu abaixo para acessar as ferramentas do Juiz.'
      : '**PAINEL DE HABILITAÇÃO** — Utilize os botões abaixo para liberar as partes aptas a atuar neste processo.',
    embeds: [buildPanelEmbed(participants), buildCaseEmbed(caseRow)],
    components: buildPanelButtons(caseRow.id, participants),
  };
}

async function updatePanelMessage(thread, caseRow) {
  if (!thread) return;
  try {
    const panelMessage = buildPanelMessage(caseRow);
    await thread.messages
      .fetch({ limit: 1 })
      .then(async (messages) => {
        const firstMessage = messages.first();
        if (!firstMessage) return null;
        return firstMessage.edit(panelMessage);
      })
      .catch(() => null);
  } catch (err) {
    console.error('updatePanelMessage error', err);
  }
}

function refreshPartiesMetadata(caseRow) {
  const metadata = parseJSON(caseRow.metadata, {});
  const partiesInfo = metadata.parties || {};
  const list = buildPartiesDisplay(metadata);
  return { metadata: { ...metadata, parties: partiesInfo }, parties: list };
}

module.exports = {
  PANEL_ROLES,
  parseParticipants,
  formatParticipantDisplay,
  isParticipantAssigned,
  allParticipantsAssigned,
  buildPanelEmbed,
  buildPanelButtons,
  buildPanelMessage,
  updatePanelMessage,
  refreshPartiesMetadata,
  buildJudgeActionsRow,
};
