const {
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
} = require("discord.js");
const client = require("../index");
const db = require("../lib/db");
const { buildCaseEmbed } = require("../Templates/caseEmbed");
const roles = require("../lib/roles");
const caseActions = require("../lib/caseActions");
const audit = require("../lib/audit");
const scheduler = require("../lib/scheduler");

const PANEL_ROLES = {
  judge: {
    label: "Juiz",
    waiting: "Aguardando habilitação do Juiz.",
  },
  author: {
    label: "Advogado Polo Ativo",
    waiting: "Aguardando advogado do Polo Ativo.",
  },
  passive: {
    label: "Advogado Polo Passivo",
    waiting: "Aguardando advogado do Polo Passivo.",
  },
};

function parseParticipants(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function formatParticipantDisplay(entry) {
  if (!entry) return null;
  if (typeof entry === "object" && entry !== null) {
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
  if (typeof entry === "object" && entry !== null) {
    if (entry.id) return true;
    if (entry.mention) return true;
    if (entry.name) return true;
  }
  return String(entry).trim().length > 0;
}

function buildPanelEmbed(participants = {}) {
  const embed = new EmbedBuilder()
    .setTitle("Painel de Habilitação")
    .setColor("#5865F2")
    .setDescription(
      "Clique nos botões abaixo para se habilitar no processo. Somente perfis com os cargos apropriados podem se habilitar."
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

client.on("interactionCreate", async (interaction) => {
  // Modal submissions (case creation and hearing creation)
  if (interaction.isModalSubmit && interaction.isModalSubmit()) {
    try {
      if (interaction.customId === "case_create_modal") {
        // novos campos: active_name, active_state, passive_name, passive_state, case_type
        const activeName = interaction.fields.getTextInputValue("active_name");
        const activeState =
          interaction.fields.getTextInputValue("active_state");
        const passiveName =
          interaction.fields.getTextInputValue("passive_name");
        const passiveState =
          interaction.fields.getTextInputValue("passive_state");
        const procType = interaction.fields.getTextInputValue("case_type");

        const description = ""; // descrição ficará via protocolo/painel
        const instance = 1; // sempre criada na 1ª instância
        const priority = "A definir"; // será definida posteriormente pelo Juiz via painel

        const parties = [
          `${activeName} (${activeState})`,
          `${passiveName} (${passiveState})`,
        ];

        // Generate sequential case number: PROC-YYYY-XXXX
        const year = new Date().getFullYear();
        // find last by case_number like PROC-YYYY-
        const last = await db.get(
          "SELECT case_number FROM cases WHERE case_number LIKE ? ORDER BY id DESC LIMIT 1",
          [`PROC-${year}-%`]
        );
        let seq = 1;
        if (last && last.case_number) {
          const parts = last.case_number.split("-");
          const lastSeq = parseInt(parts[2]) || 0;
          seq = lastSeq + 1;
        }
        const caseNumber = `PROC-${year}-${String(seq).padStart(4, "0")}`;

        const title = `Processo (${caseNumber}) ${activeName} X ${passiveName}`;

        const created = await db.createCase({
          case_number: caseNumber,
          title,
          description,
          type: procType,
          status: "Ativo",
          priority,
          instance,
          court: null,
          parties,
          participants: {},
          metadata: { activeState, passiveState },
          timeline: [
            {
              action: "created",
              by: interaction.user.id,
              at: new Date().toISOString(),
            },
          ],
          thread_id: null,
          created_by: `${interaction.user.tag} (${interaction.user.id})`,
        });

        // find forum channel by ID from config; prefer instance-specific forum if available
        let forum = null;
        try {
          const cfg = require("../config.json");
          if (cfg && cfg.forums) {
            if (instance === 1 && cfg.forums.instance1)
              forum = interaction.guild.channels.cache.get(
                cfg.forums.instance1
              );
            if (instance === 2 && cfg.forums.instance2)
              forum = interaction.guild.channels.cache.get(
                cfg.forums.instance2
              );
            if (instance === 3 && cfg.forums.instance3)
              forum = interaction.guild.channels.cache.get(
                cfg.forums.instance3
              );
            // fallback to main
            if (!forum && cfg.forums.main)
              forum = interaction.guild.channels.cache.get(cfg.forums.main);
          }
        } catch (e) {}
        if (!forum) {
          // fallback to name
          forum = interaction.guild.channels.cache.find(
            (c) =>
              c.name === "🧾-processos" && c.type === ChannelType.GuildForum
          );
        }
        // === SUBSTITUA TODO O BLOCO DE CRIAÇÃO DO FÓRUM/THREAD PELO TRECHO ABAIXO ===
        let thread = null;

        if (forum) {
          const forumPost = await forum.threads
            .create({
              name: `${caseNumber} — ${title}`.slice(0, 100),
              message: {
                content: " ",
                files: [
                  client.user.displayAvatarURL({
                    extension: "png",
                    size: 1024,
                  }),
                ],
              },
            })
            .catch((e) => {
              console.error("Erro ao criar post no Fórum:", e);
              return null;
            });

          // Em v14, o retorno já é o ThreadChannel do post
          thread = forumPost || null;
        }

        // atualize o case com o thread_id e siga com as mensagens de painel
        if (thread) {
          const updated = await db.updateCase(created.id, {
            thread_id: String(thread.id),
          });

          try {
            // bloquear envio de mensagens por default
            await thread.permissionOverwrites
              .edit(thread.guild.roles.everyone, { SendMessages: false })
              .catch(() => null);

            const {
              ActionRowBuilder,
              ButtonBuilder,
              ButtonStyle,
            } = require("discord.js");

            const panelRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`enable_judge_${created.id}`)
                .setLabel("⚖️ Habilitar Juiz")
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId(`enable_author_${created.id}`)
                .setLabel("🛡️ Habilitar Advogado Polo Ativo")
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`enable_passive_${created.id}`)
                .setLabel("🛡️ Habilitar Advogado Polo Passivo")
                .setStyle(ButtonStyle.Primary)
            );

            const panelEmbed = buildPanelEmbed({});
            const caseEmbed = buildCaseEmbed(updated);

            await thread
              .send({
                content:
                  "**PAINEL DE HABILITAÇÃO** — Utilize os botões abaixo para liberar as partes aptas a atuar neste processo.",
                embeds: [panelEmbed, caseEmbed],
                components: [panelRow],
              })
              .catch(() => null);
          } catch (e) {
            console.error("panel create error", e);
          }
        }

        // publish to public movements channel (use config id if present)
        let publicChannel = null;
        try {
          const cfg = require("../config.json");
          if (cfg && cfg.channels && cfg.channels.movements)
            publicChannel = interaction.guild.channels.cache.get(
              cfg.channels.movements
            );
        } catch (e) {}
        if (!publicChannel)
          publicChannel = interaction.guild.channels.cache.find(
            (c) => c.name === "📢-movimentações"
          );
        if (publicChannel) {
          const b = new EmbedBuilder()
            .setTitle("Novo processo protocolado")
            .setDescription(`${caseNumber} — ${title}`)
            .addFields(
              {
                name: "Instância",
                value: `${instance}ª Instância`,
                inline: true,
              },
              { name: "Prioridade", value: priority, inline: true }
            )
            .setTimestamp();
          if (thread)
            b.addFields({
              name: "Link",
              value: `https://discord.com/channels/${interaction.guild.id}/${thread.id}`,
            });
          publicChannel.send({ embeds: [b] }).catch(() => null);
        }

        // private audit log (use config id if present)
        let audit = null;
        try {
          const cfg = require("../config.json");
          if (cfg && cfg.channels && cfg.channels.audit)
            audit = interaction.guild.channels.cache.get(cfg.channels.audit);
        } catch (e) {}
        if (!audit)
          audit = interaction.guild.channels.cache.find(
            (c) => c.name === "🔒-activity-log"
          );
        if (audit) {
          const l = new EmbedBuilder()
            .setTitle("AUDIT: Novo processo")
            .setDescription(
              `${caseNumber} criado por ${interaction.user.tag} (${interaction.user.id})`
            )
            .addFields(
              { name: "Título", value: title },
              { name: "Partes", value: parties.join("; ") || "—" }
            );
          audit.send({ embeds: [l] }).catch(() => null);
        }

        // Add entry to activity_logs table
        await db.addLog(
          created.id,
          "create_case",
          interaction.user.id,
          interaction.user.tag,
          `Caso criado: ${caseNumber}`
        );

        return interaction.reply({
          content: `Processo ${caseNumber} criado com sucesso.`,
          ephemeral: true,
        });
      }

      // escalate modal
      if (
        interaction.customId &&
        interaction.customId.startsWith("escalate_modal_")
      ) {
        const caseId = parseInt(interaction.customId.split("_").pop());
        const targetRaw =
          interaction.fields.getTextInputValue("escalate_target");
        const target = parseInt(targetRaw);
        const caseRow = await db.get("SELECT * FROM cases WHERE id = ?", [
          caseId,
        ]);
        if (!caseRow)
          return interaction.reply({
            content: "Caso não encontrado.",
            ephemeral: true,
          });
        // permission check
        const roles = require("../lib/roles");
        if (
          !roles.memberHasRoleByKey(interaction.member, "judge") &&
          !roles.memberHasRoleByKey(interaction.member, "admin")
        ) {
          return interaction.reply({
            content: "Você não tem permissão para escalonar.",
            ephemeral: true,
          });
        }
        const caseActions = require("../lib/caseActions");
        try {
          await caseActions.escalateCase(
            caseRow,
            target,
            client,
            interaction.user
          );
          await interaction.reply({
            content: `Processo escalonado para a instância ${target}.`,
            ephemeral: true,
          });
        } catch (err) {
          await interaction.reply({
            content: `Erro ao escalonar: ${err.message}`,
            ephemeral: true,
          });
        }
        return;
      }

      if (
        interaction.customId &&
        interaction.customId.startsWith("protocol_modal_")
      ) {
        const caseId = parseInt(interaction.customId.split("_").pop());
        const name = interaction.fields.getTextInputValue("protocol_name");
        const desc =
          interaction.fields.getTextInputValue("protocol_desc") || "";
        const caseRow = await db.get("SELECT * FROM cases WHERE id = ?", [
          caseId,
        ]);
        if (!caseRow)
          return interaction.reply({
            content: "Caso não encontrado.",
            ephemeral: true,
          });
        await db.addLog(
          caseRow.id,
          "protocol_initiated",
          interaction.user.id,
          interaction.user.tag,
          `Iniciou protocolar: ${name} — ${desc}`
        );
        await audit.logAction(
          interaction.guild,
          caseRow.id,
          "protocol_initiated",
          interaction.user,
          `Iniciou protocolar: ${name}`
        );
        return interaction.reply({
          content: `Documento registrado ("${name}"). Agora envie o arquivo diretamente no tópico do processo ou use /case upload.`,
          ephemeral: true,
        });
      }

      if (
        interaction.customId &&
        interaction.customId.startsWith("set_priority_modal_")
      ) {
        const caseId = parseInt(interaction.customId.split("_").pop());
        const raw =
          interaction.fields.getTextInputValue("priority_value") || "";
        const val = raw.trim();
        const caseRow = await db.get("SELECT * FROM cases WHERE id = ?", [
          caseId,
        ]);
        if (!caseRow)
          return interaction.reply({
            content: "Caso não encontrado.",
            ephemeral: true,
          });
        // permission
        if (
          !roles.memberHasRoleByKey(interaction.member, "judge") &&
          !roles.memberHasRoleByKey(interaction.member, "admin")
        ) {
          return interaction.reply({
            content: "Você não tem permissão para definir prioridade.",
            ephemeral: true,
          });
        }
        const map = {
          baixa: "Baixa",
          media: "Média",
          média: "Média",
          alta: "Alta",
          urgente: "Urgente",
        };
        const normalized =
          map[val.toLowerCase()] ||
          (val.length
            ? val[0].toUpperCase() + val.slice(1).toLowerCase()
            : null);
        if (!normalized)
          return interaction.reply({
            content: "Valor de prioridade inválido.",
            ephemeral: true,
          });

        // update DB priority
        await db.updateCase(caseRow.id, { priority: normalized });

        // update timeline
        const timeline = JSON.parse(caseRow.timeline || "[]");
        timeline.push({
          action: "priority_set",
          by: interaction.user.id,
          at: new Date().toISOString(),
          priority: normalized,
        });
        await db.updateCase(caseRow.id, { timeline });

        // add log and audit
        await db.addLog(
          caseRow.id,
          "set_priority",
          interaction.user.id,
          interaction.user.tag,
          `Prioridade definida: ${normalized}`
        );
        await audit.logAction(
          interaction.guild,
          caseRow.id,
          "set_priority",
          interaction.user,
          `Pri: ${normalized}`
        );

        // notify thread and public movements
        try {
          const thread = interaction.guild.channels.cache.get(
            String(caseRow.thread_id)
          );
          if (thread)
            thread
              .send({
                content: `🔔 Prioridade definida: **${normalized}** por ${interaction.user.tag}`,
              })
              .catch(() => null);
        } catch (e) {}
        try {
          const cfg = require("../config.json");
          const pub =
            cfg && cfg.channels && cfg.channels.movements
              ? interaction.guild.channels.cache.get(cfg.channels.movements)
              : null;
          const publicChannel =
            pub ||
            interaction.guild.channels.cache.find(
              (c) => c.name === "📢-movimentações"
            );
          if (publicChannel) {
            const b = new EmbedBuilder()
              .setTitle("Movimentação: Prioridade")
              .setDescription(
                `${caseRow.case_number} — Prioridade definida para ${normalized}`
              )
              .addFields({
                name: "Prioridade",
                value: normalized,
                inline: true,
              })
              .setTimestamp();
            if (caseRow.thread_id)
              b.addFields({
                name: "Link",
                value: `https://discord.com/channels/${interaction.guild.id}/${caseRow.thread_id}`,
              });
            publicChannel.send({ embeds: [b] }).catch(() => null);
          }
        } catch (e) {}

        return interaction.reply({
          content: `Prioridade atualizada para ${normalized}.`,
          ephemeral: true,
        });
      }

      if (interaction.customId === "hearing_create_modal") {
        const whenRaw = interaction.fields.getTextInputValue("hearing_when");
        const durationRaw =
          interaction.fields.getTextInputValue("hearing_duration");
        const location =
          interaction.fields.getTextInputValue("hearing_location") || "";

        // naive parse - user should include case id in context (this simplified implementation requires the user to run the command inside a thread)
        const thread = interaction.channel;
        if (!thread || !thread.isThread())
          return interaction.reply({
            content: "Este modal deve ser usado dentro do tópico do processo.",
            ephemeral: true,
          });

        // look up case by thread id
        const caseRow = (await db.getCaseByNumber)
          ? await db.get("SELECT * FROM cases WHERE thread_id = ?", [
              String(thread.id),
            ])
          : null;
        if (!caseRow)
          return interaction.reply({
            content: "Caso não encontrado para este tópico.",
            ephemeral: true,
          });

        const when = new Date(whenRaw);
        const duration = parseInt(durationRaw) || 60;
        const hearing = await db.addHearing(caseRow.id, {
          hearing_at: when.toISOString(),
          duration_minutes: duration,
          location,
          created_by: `${interaction.user.tag} (${interaction.user.id})`,
        });
        await db.addLog(
          caseRow.id,
          "create_hearing",
          interaction.user.id,
          interaction.user.tag,
          `Audiência agendada para ${when.toISOString()}`
        );
        // schedule reminders
        scheduler.scheduleHearing(client, hearing).catch(() => null);

        // update timeline
        const timeline = JSON.parse(caseRow.timeline || "[]");
        timeline.push({
          action: "hearing_scheduled",
          at: new Date().toISOString(),
          when: when.toISOString(),
          by: interaction.user.id,
        });
        await db.updateCase(caseRow.id, { timeline });

        // send messages
        thread
          .send({
            content: `Audiência agendada para ${when.toLocaleString()} (${duration} minutos) em ${location}.`,
          })
          .catch(() => null);

        return interaction.reply({
          content: "Audiência criada com sucesso.",
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error("Modal handling error:", err);
      return interaction.reply({
        content: "Ocorreu um erro ao processar o modal.",
        ephemeral: true,
      });
    }
  }

  // Slash command handling
  const slashCommand = client.slashCommands.get(interaction.commandName);
  if (interaction.type == 4) {
    if (slashCommand && slashCommand.autocomplete) {
      const choices = [];
      await slashCommand.autocomplete(interaction, choices);
    }
  }
  if (!interaction.type == 2) return;
  if (!interaction.guild) return;

  if (!slashCommand)
    return client.slashCommands.delete(interaction.commandName);
  // button/select handling: if no slash command but a component interaction
  if (!slashCommand && interaction.isButton && interaction.isButton()) {
    const id = interaction.customId;
    // protocol_<caseId>
    if (id.startsWith("protocol_")) {
      const caseId = parseInt(id.split("_")[1]);
      const caseRow = await db.get("SELECT * FROM cases WHERE id = ?", [
        caseId,
      ]);
      if (!caseRow)
        return interaction.reply({
          content: "Processo não encontrado.",
          ephemeral: true,
        });
      const {
        ModalBuilder,
        TextInputBuilder,
        TextInputStyle,
        ActionRowBuilder,
      } = require("discord.js");
      const modal = new ModalBuilder()
        .setCustomId(`protocol_modal_${caseId}`)
        .setTitle("Protocolar Documento");
      const name = new TextInputBuilder()
        .setCustomId("protocol_name")
        .setLabel("Nome do documento")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const desc = new TextInputBuilder()
        .setCustomId("protocol_desc")
        .setLabel("Descrição / Observações")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);
      modal.addComponents(
        new ActionRowBuilder().addComponents(name),
        new ActionRowBuilder().addComponents(desc)
      );
      await audit.logAction(
        interaction.guild,
        caseRow.id,
        "protocol_button",
        interaction.user,
        `Iniciou protocolar via painel`
      );
      return interaction.showModal(modal);
    }

    if (id.startsWith("set_priority_")) {
      const parts = id.split("_");
      const caseId = parseInt(parts[2]);
      const caseRow = await db.get("SELECT * FROM cases WHERE id = ?", [
        caseId,
      ]);
      if (!caseRow)
        return interaction.reply({
          content: "Processo não encontrado.",
          ephemeral: true,
        });
      // only judge or admin can set priority
      if (
        !roles.memberHasRoleByKey(interaction.member, "judge") &&
        !roles.memberHasRoleByKey(interaction.member, "admin")
      ) {
        return interaction.reply({
          content: "Apenas Juiz/Administrador pode definir prioridade.",
          ephemeral: true,
        });
      }
      const {
        ModalBuilder,
        TextInputBuilder,
        TextInputStyle,
        ActionRowBuilder,
      } = require("discord.js");
      const modal = new ModalBuilder()
        .setCustomId(`set_priority_modal_${caseId}`)
        .setTitle("Definir Prioridade");
      const input = new TextInputBuilder()
        .setCustomId("priority_value")
        .setLabel("Prioridade (Baixa/Média/Alta/Urgente)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await audit.logAction(
        interaction.guild,
        caseRow.id,
        "open_set_priority",
        interaction.user,
        `Abriu modal de prioridade via painel`
      );
      return interaction.showModal(modal);
    }

    if (
      id.startsWith("enable_author_") ||
      id.startsWith("enable_judge_") ||
      id.startsWith("enable_passive_")
    ) {
      const parts = id.split("_");
      const roleKey =
        parts[1] === "author"
          ? "author"
          : parts[1] === "judge"
          ? "judge"
          : "passive";
      const caseId = parseInt(parts.pop());
      const caseRow = await db.get("SELECT * FROM cases WHERE id = ?", [
        caseId,
      ]);
      if (!caseRow)
        return interaction.reply({
          content: "Processo não encontrado.",
          ephemeral: true,
        });
      // we expect this interaction to happen in guild context
      const guild = interaction.guild;
      const thread = guild.channels.cache.get(String(caseRow.thread_id));
      if (!thread)
        return interaction.reply({
          content: "Tópico do processo não encontrado.",
          ephemeral: true,
        });

      const requiresJudgeRole = roleKey === "judge";
      if (requiresJudgeRole) {
        if (
          !roles.memberHasRoleByKey(interaction.member, "judge") &&
          !roles.memberHasRoleByKey(interaction.member, "admin")
        ) {
          return interaction.reply({
            content:
              "Você precisa possuir o cargo de Juiz ou Administrador para se habilitar como Juiz neste processo.",
            ephemeral: true,
          });
        }
      } else if (
        !roles.memberHasRoleByKey(interaction.member, "defender") &&
        !roles.memberHasRoleByKey(interaction.member, "admin")
      ) {
        return interaction.reply({
          content:
            "Apenas usuários com o cargo de Defensor/Advogado ou Administrador podem se habilitar por este botão.",
          ephemeral: true,
        });
      }

      const participants = parseParticipants(caseRow.participants);
      const hadAllBefore = Object.keys(PANEL_ROLES).every((key) =>
        isParticipantAssigned(participants[key])
      );

      const existing = participants[roleKey];
      const existingId =
        existing && typeof existing === "object" ? existing.id : null;
      if (existingId && existingId !== interaction.user.id) {
        return interaction.reply({
          content: `Este cargo já está ocupado por <@${existingId}>. Caso seja necessário substituir, solicite a um administrador.`,
          ephemeral: true,
        });
      }
      if (existingId === interaction.user.id) {
        return interaction.reply({
          content: "Você já está habilitado neste cargo para o processo.",
          ephemeral: true,
        });
      }
      if (!existingId && typeof existing === "string" && existing.trim().length) {
        return interaction.reply({
          content: "Este cargo já foi preenchido para o processo.",
          ephemeral: true,
        });
      }

      participants[roleKey] = {
        id: interaction.user.id,
        tag: interaction.user.tag,
      };

      try {
        await thread.permissionOverwrites
          .edit(interaction.user.id, { SendMessages: true, ViewChannel: true })
          .catch(() => null);

        const timeline = (() => {
          try {
            return JSON.parse(caseRow.timeline || "[]");
          } catch (e) {
            return [];
          }
        })();
        timeline.push({
          action: "enable",
          role: roleKey,
          user: interaction.user.id,
          at: new Date().toISOString(),
        });

        const updatedCase = await db.updateCase(caseRow.id, {
          participants,
          timeline,
        });

        await db.addLog(
          caseRow.id,
          "enable_participant",
          interaction.user.id,
          interaction.user.tag,
          `Habilitado ${PANEL_ROLES[roleKey]?.label || roleKey} por ${
            interaction.user.tag
          }`
        );

        await audit.logAction(
          guild,
          caseRow.id,
          "enable_participant",
          interaction.user,
          `Habilitado ${PANEL_ROLES[roleKey]?.label || roleKey}: ${
            interaction.user.tag
          }`
        );

        const components = interaction.message.components;
        const panelEmbed = buildPanelEmbed(participants);
        const caseEmbed = buildCaseEmbed(updatedCase);

        await interaction.update({
          embeds: [panelEmbed, caseEmbed],
          components,
        });

        await interaction.followUp({
          content: `Você foi habilitado como ${
            PANEL_ROLES[roleKey]?.label || roleKey
          } neste processo e pode enviar mensagens aqui.`,
          ephemeral: true,
        });

        const hasAllNow = Object.keys(PANEL_ROLES).every((key) =>
          isParticipantAssigned(participants[key])
        );
        if (!hadAllBefore && hasAllNow) {
          const judgeEntry = participants.judge;
          const authorEntry = participants.author;
          const passiveEntry = participants.passive;
          const judgeMention = formatParticipantDisplay(judgeEntry) || "Juiz";
          const activeMention =
            formatParticipantDisplay(authorEntry) || "Advogado Polo Ativo";
          const passiveMention =
            formatParticipantDisplay(passiveEntry) ||
            "Advogado Polo Passivo";
          await thread
            .send({
              content: `✅ ${judgeMention}, ${activeMention} e ${passiveMention}, todas as partes estão habilitadas. Polo Ativo, por favor, protocole a Petição Inicial para dar sequência ao processo.`,
            })
            .catch(() => null);
        }
      } catch (err) {
        console.error("enable participant error", err);
        if (interaction.deferred || interaction.replied) {
          return interaction.followUp({
            content: "Erro ao habilitar participante.",
            ephemeral: true,
          });
        }
        return interaction.reply({
          content: "Erro ao habilitar participante.",
          ephemeral: true,
        });
      }

      return;
    }

    if (id.startsWith("escalate_")) {
      const caseId = parseInt(id.split("_")[1]);
      const caseRow = await db.get("SELECT * FROM cases WHERE id = ?", [
        caseId,
      ]);
      if (!caseRow)
        return interaction.reply({
          content: "Processo não encontrado.",
          ephemeral: true,
        });
      // check permission: only Judge or Administrator
      if (
        !roles.memberHasRoleByKey(interaction.member, "judge") &&
        !roles.memberHasRoleByKey(interaction.member, "admin")
      ) {
        return interaction.reply({
          content: "Você não tem permissão para escalonar este processo.",
          ephemeral: true,
        });
      }
      // show modal to ask target instance
      const {
        ModalBuilder,
        TextInputBuilder,
        TextInputStyle,
        ActionRowBuilder,
      } = require("discord.js");
      const modal = new ModalBuilder()
        .setCustomId(`escalate_modal_${caseId}`)
        .setTitle("Escalonar Processo");
      const input = new TextInputBuilder()
        .setCustomId("escalate_target")
        .setLabel("Instância destino (1,2 ou 3)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (id.startsWith("edit_")) {
      return interaction.reply({
        content:
          "Editar via painel ainda não implementado. Use /case manage para editar.",
        ephemeral: true,
      });
    }

    if (id.startsWith("enroll_")) {
      const caseId = parseInt(id.split("_")[1]);
      const caseRow = await db.get("SELECT * FROM cases WHERE id = ?", [
        caseId,
      ]);
      if (!caseRow)
        return interaction.reply({
          content: "Processo não encontrado.",
          ephemeral: true,
        });
      // open instructions
      await audit.logAction(
        interaction.guild,
        caseRow.id,
        "enroll_request",
        interaction.user,
        `Solicitou habilitação via painel`
      );
      return interaction.reply({
        content:
          "Solicitação de habilitação recebida. Use /case enroll para especificar cargo.",
        ephemeral: true,
      });
    }
  }

  if (
    !slashCommand &&
    interaction.isStringSelectMenu &&
    interaction.isStringSelectMenu()
  ) {
    const id = interaction.customId;
    if (id.startsWith("action_select_")) {
      const val = interaction.values[0];
      // emulate pressing the corresponding button
      await interaction.deferUpdate();
      // just reply ephemeral mapping
      return interaction.followUp({
        content: `Ação selecionada: ${val}. Use o painel para confirmar.`,
        ephemeral: true,
      });
    }
  }
  try {
    if (slashCommand.userPerms || slashCommand.botPerms) {
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.resolve(slashCommand.userPerms || [])
        )
      ) {
        const userPerms = new EmbedBuilder()
          .setDescription(
            "Você não possui a permissão `" +
              (slashCommand.userPerms || "") +
              "`"
          )
          .setColor("Red");
        return interaction.reply({ embeds: [userPerms], ephemeral: true });
      }
      if (
        !interaction.guild.members.cache
          .get(client.user.id)
          .permissions.has(
            PermissionsBitField.resolve(slashCommand.botPerms || [])
          )
      ) {
        const botPerms = new EmbedBuilder()
          .setDescription(
            "Eu não possuo a permissão `" + (slashCommand.botPerms || "") + "`"
          )
          .setColor("Red");
        return interaction.reply({ embeds: [botPerms], ephemeral: true });
      }
    }

    if (slashCommand.ownerOnly) {
      if (!process.env.OWNER.includes(interaction.user.id)) {
        return interaction.reply({
          content: `Apenas meu dono pode executar esse comando!`,
          ephemeral: true,
        });
      }
    }

    await slashCommand.run(client, interaction);
  } catch (error) {
    console.log(error);
  }
});
