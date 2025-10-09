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
    .setTitle('Painel do Juiz')
    .setColor('#2F3136')
    .setDescription(
      cases.length
        ? 'Selecione um processo abaixo para gerenciar as informações.'
        : 'Nenhum processo sob sua responsabilidade foi encontrado.'
    );

  const visible = sliceCases(cases, page);
  if (visible.length) {
    visible.forEach((caseRow, index) => {
      embed.addFields({
        name: `${index + 1 + page * CASES_PER_PAGE} • ${caseRow.case_number}`,
        value: `**${caseRow.title || 'Sem título'}**\nStatus: ${
          caseRow.status || 'Pendente'
        } • Instância: ${caseRow.instance || 1}ª`,
      });
    });
  }

  embed.setFooter({
    text: `Página ${page + 1} de ${totalPages || 1}`,
  });

  return embed;
}

function buildOverviewComponents(cases, page, userId) {
  const totalPages = Math.max(1, Math.ceil(cases.length / CASES_PER_PAGE));
  const visible = sliceCases(cases, page);
  const prevPage = Math.max(0, page - 1);
  const nextPage = Math.min(totalPages - 1, page + 1);
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`judge_panel_nav:${userId}:${prevPage}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`judge_panel_refresh:${userId}:${page}`)
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`judge_panel_nav:${userId}:${nextPage}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );

  const selectRow = new ActionRowBuilder();
  if (visible.length) {
    visible.forEach((caseRow, index) => {
      selectRow.addComponents(
        new ButtonBuilder()
          .setCustomId(
            `judge_panel_select:${userId}:${caseRow.id}:${page}:${index}`
          )
          .setLabel(String(index + 1))
          .setStyle(ButtonStyle.Primary)
      );
    });
  }

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`judge_panel_close:${userId}`)
      .setLabel('Fechar Painel')
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
      .setCustomId(
        `judge_panel_action:${userId}:${caseRow.id}:${page}:instance`
      )
      .setLabel('Alterar Instância')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(
        `judge_panel_action:${userId}:${caseRow.id}:${page}:names`
      )
      .setLabel('Alterar Nomes das Partes')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`judge_panel_action:${userId}:${caseRow.id}:${page}:ids`)
      .setLabel('Alterar IDs das Partes')
      .setStyle(ButtonStyle.Secondary)
  );

  const extraRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `judge_panel_action:${userId}:${caseRow.id}:${page}:details`
      )
      .setLabel('Editar Dados Gerais')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`judge_panel_back:${userId}:${page}`)
      .setLabel('⬅️ Voltar')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    content: `Gerenciando processo **${caseRow.case_number}**. Escolha uma ação abaixo.`,
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
