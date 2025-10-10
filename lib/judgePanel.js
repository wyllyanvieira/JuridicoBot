const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { buildCaseEmbed } = require('../Templates/caseEmbed');
const { parseParticipants } = require('./habilitationPanel');

const CASES_PER_PAGE = 3;

function sliceCases(cases, page) {
  const start = page * CASES_PER_PAGE;
  const end = start + CASES_PER_PAGE;
  return cases.slice(start, end);
}

function buildOverviewEmbed(cases, page, totalPages) {
  const embed = new EmbedBuilder()
    .setTitle('⚖️ Painel do Juiz')
    .setColor('#f1c40f')
    .setDescription(
      cases.length
        ? 'Selecione um processo abaixo para gerenciar suas informações.'
        : '🗂️ Nenhum processo sob sua responsabilidade foi encontrado.'
    );

  const visible = sliceCases(cases, page);

  if (visible.length) {
    visible.forEach((caseRow, index) => {
      const status = caseRow.status || 'Pendente';
      const instance = caseRow.instance || '1ª';
      const title = caseRow.title || 'Sem título';

      embed.addFields({
        name: `📁 ${index + 1 + page * CASES_PER_PAGE} • ${caseRow.case_number}`,
        value: `**${title}**\n> ⚖️ **Status:** ${status}\n> 🏛️ **Instância:** ${instance}`,
        inline: false,
      });
    });
  }

  embed.setFooter({
    text: `Página ${page + 1} de ${totalPages || 1} | Total de casos: ${cases.length}`,
  });

  return embed;
}

function buildOverviewComponents(cases, page, userId) {
  const totalPages = Math.max(1, Math.ceil(cases.length / CASES_PER_PAGE));
  const visible = sliceCases(cases, page);
  const prevPage = Math.max(0, page - 1);
  const nextPage = Math.min(totalPages - 1, page + 1);

  // 🔹 Navegação
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`judge_panel_nav_prev:${userId}:${prevPage}`)
      .setEmoji('⬅️')
      .setLabel('Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`judge_panel_refresh:${userId}:${page}`)
      .setEmoji('🔄')
      .setLabel('Atualizar')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`judge_panel_nav_next:${userId}:${nextPage}`)
      .setEmoji('➡️')
      .setLabel('Próximo')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );

  // 🔹 Seleção de Processo
  let selectRow = new ActionRowBuilder();
  if (visible.length) {
    const selectMenu = new (require('discord.js').StringSelectMenuBuilder)()
      .setCustomId(`judge_panel_select:${userId}:${page}`)
      .setPlaceholder('Selecione um processo');
    visible.forEach((caseRow, index) => {
      selectMenu.addOptions({
        label: `Caso ${index + 1} • ${caseRow.case_number}`,
        description: caseRow.title || 'Sem título',
        value: `${caseRow.id}:${index}`,
      });
    });
    selectRow.addComponents(selectMenu);
  }

  // 🔹 Fechar painel
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`judge_panel_close:${userId}`)
      .setLabel('Fechar Painel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  return selectRow.components.length
    ? [navRow, selectRow, closeRow]
    : [navRow, closeRow];
}

function buildOverviewMessage(cases, page, userId) {
  const totalPages = Math.max(1, Math.ceil(cases.length / CASES_PER_PAGE));
  return {
    embeds: [buildOverviewEmbed(cases, page, totalPages)],
    components: buildOverviewComponents(cases, page, userId),
  };
}

function buildCaseDetailMessage(caseRow, userId, page) {
  const embed = buildCaseEmbed(caseRow);
  embed.setFooter({
    text: `${embed.data.footer?.text || ''}`.trim(),
  });

  const mainRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`judge_panel_action:${userId}:${caseRow.id}:${page}:instance`)
      .setLabel('⚖️ Alterar Instância')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`judge_panel_action:${userId}:${caseRow.id}:${page}:names`)
      .setLabel('🧾 Alterar Nomes das Partes')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`judge_panel_action:${userId}:${caseRow.id}:${page}:ids`)
      .setLabel('🆔 Alterar IDs das Partes')
      .setStyle(ButtonStyle.Secondary)
  );

  const extraRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`judge_panel_action:${userId}:${caseRow.id}:${page}:details`)
      .setLabel('📝 Editar Dados Gerais')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`judge_panel_back:${userId}:${page}`)
      .setLabel('⬅️ Voltar')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    content: `📄 Gerenciando processo **${caseRow.case_number}** — escolha uma ação abaixo:`,
    embeds: [embed],
    components: [mainRow, extraRow],
  };
}

function filterCasesByJudge(cases, judgeId) {
  return cases.filter((caseRow) => {
    const participants = parseParticipants(caseRow.participants);
    const judge = participants.judge;
    if (!judge) return false;
    if (typeof judge === 'object' && judge.id) return judge.id === judgeId;
    if (typeof judge === 'string') return judge === judgeId;
    return false;
  });
}

module.exports = {
  CASES_PER_PAGE,
  buildOverviewMessage,
  buildCaseDetailMessage,
  filterCasesByJudge,
};
