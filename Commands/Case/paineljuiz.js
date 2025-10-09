const { ApplicationCommandType } = require( "discord.js");
const db = require( "../../lib/db.js");
const roles = require( "../../lib/roles.js");
const  {
  buildOverviewMessage,
  filterCasesByJudge,
} = require("../../lib/judgePanel.js");

module.exports = {
  name: "paineljuiz",
  description: "Cria o painel de ações para um processo (painel com botões).",
  type: ApplicationCommandType.ChatInput,
  run: async (client, interaction) => {
    if (
      !roles.memberHasRoleByKey(interaction.member, "judge") &&
      !roles.memberHasRoleByKey(interaction.member, "admin")
    ) {
      return interaction.reply({
        content:
          "Somente usuários com o cargo de Juiz ou Administrador podem abrir este painel.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const rows = await db.all("SELECT * FROM cases ORDER BY id DESC LIMIT 100");
    const cases = filterCasesByJudge(rows, interaction.user.id);
    const response = buildOverviewMessage(cases, 0, interaction.user.id);

    return interaction.editReply(response);
  },
};
