const {
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const client = require("../index");
const db = require("../lib/db");
const roles = require("../lib/roles");
const caseActions = require("../lib/caseActions");
const audit = require("../lib/audit");
const scheduler = require("../lib/scheduler");
const { sendDebugMessage } = require("../lib/debug");
const {
  PANEL_ROLES,
  parseParticipants,
  formatParticipantDisplay,
  isParticipantAssigned,
  buildPanelEmbed,
  buildPanelButtons,
  updatePanelMessage,
} = require("../lib/habilitationPanel");
const {
  buildCaseEmbed,
  buildPartiesDisplay,
} = require("../Templates/caseEmbed");
const {
  CASES_PER_PAGE,
  buildOverviewMessage,
  buildCaseDetailMessage,
  filterCasesByJudge,
} = require("../lib/judgePanel");

async function loadJudgeCases(userId) {
  const rows = await db.all("SELECT * FROM cases ORDER BY id DESC LIMIT 100");
  return filterCasesByJudge(rows, userId);
}

function extractParticipantId(entry) {
  if (!entry) return null;
  if (typeof entry === "object") {
    if (entry.id) return String(entry.id);
    if (entry.userId) return String(entry.userId);
    if (entry.mention) {
      const match = entry.mention.match(/\d{5,}/);
      if (match) return match[0];
    }
  }
  if (typeof entry === "string") {
    const mentionMatch = entry.match(/\d{5,}/);
    if (mentionMatch) return mentionMatch[0];
    return entry;
  }
  return null;
}

function isJudgeOfCase(caseRow, userId) {
  if (!caseRow || !userId) return false;
  const participants = parseParticipants(caseRow.participants);
  const judge = participants?.judge;
  const judgeId = extractParticipantId(judge);
  return judgeId ? judgeId === String(userId) : false;
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

        const partiesMetadata = {
          parties: {
            active: { name: activeName, stateId: activeState },
            passive: { name: passiveName, stateId: passiveState },
          },
          type: procType,
        };

        const parties = buildPartiesDisplay(partiesMetadata);

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
          instance,
          court: null,
          parties,
          participants: {},
          metadata: partiesMetadata,
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
        console.log(forum);
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
          const initialParticipants = parseParticipants(created.participants);
          const panelEmbed = buildPanelEmbed(initialParticipants);
          const caseEmbed = buildCaseEmbed(created);

          const forumPost = await forum.threads
            .create({
              name: `${title}`.slice(0, 100),
              message: {
                content:
                  "**PAINEL DE HABILITAÇÃO** — Utilize os botões abaixo para liberar as partes aptas a atuar neste processo.",
                embeds: [panelEmbed, caseEmbed],
                components: buildPanelButtons(created.id, initialParticipants),
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
            await updatePanelMessage(thread, updated);
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
            .addFields({
              name: "Instância",
              value: `${instance}ª Instância`,
              inline: true,
            })
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

      if (interaction.customId.startsWith("judge_panel_modal_")) {
        const parts = interaction.customId.split("_");
        const action = parts[3];
        const caseId = parseInt(parts[4]);
        const page = parseInt(parts[5]) || 0;
        const ownerId = parts[6];

        if (ownerId !== interaction.user.id) {
          return interaction.reply({
            content: "Este painel pertence a outro Juiz.",
            ephemeral: true,
          });
        }

        const caseRow = await db.getCaseById(caseId);
        if (!caseRow) {
          return interaction.reply({
            content: "Processo não encontrado.",
            ephemeral: true,
          });
        }

        const allowed = filterCasesByJudge([caseRow], ownerId).length > 0;
        if (!allowed) {
          return interaction.reply({
            content: "Você não está habilitado como Juiz neste processo.",
            ephemeral: true,
          });
        }

        const metadata = (() => {
          try {
            return JSON.parse(caseRow.metadata || "{}");
          } catch (err) {
            return {};
          }
        })();
        metadata.parties = metadata.parties || {
          active: {},
          passive: {},
        };
        metadata.parties.active = metadata.parties.active || {};
        metadata.parties.passive = metadata.parties.passive || {};

        const timeline = (() => {
          try {
            return JSON.parse(caseRow.timeline || "[]");
          } catch (err) {
            return [];
          }
        })();

        let updatedCase = null;
        const now = new Date().toISOString();

        if (action === "instance") {
          const raw = interaction.fields.getTextInputValue("instance_value");
          const value = parseInt(raw, 10);
          if (!Number.isInteger(value) || value < 1) {
            return interaction.reply({
              content: "Informe um número de instância válido (>= 1).",
              ephemeral: true,
            });
          }

          timeline.push({
            action: "instance_updated",
            from: caseRow.instance,
            to: value,
            by: interaction.user.id,
            at: now,
          });

          updatedCase = await db.updateCase(caseId, {
            instance: value,
            timeline,
          });

          await db.addLog(
            caseId,
            "update_instance",
            interaction.user.id,
            interaction.user.tag,
            `Instância alterada para ${value}`
          );
          await audit.logAction(
            interaction.guild,
            caseId,
            "update_instance",
            interaction.user,
            `Instância alterada para ${value}`
          );

          await interaction.reply({
            content: `Instância atualizada para ${value}ª.`,
            ephemeral: true,
          });
        } else if (action === "names" || action === "ids") {
          if (action === "names") {
            const activeName =
              interaction.fields.getTextInputValue("active_name");
            const passiveName =
              interaction.fields.getTextInputValue("passive_name");
            if (!activeName.trim() || !passiveName.trim()) {
              return interaction.reply({
                content: "Os nomes das partes são obrigatórios.",
                ephemeral: true,
              });
            }
            metadata.parties.active.name = activeName.trim();
            metadata.parties.passive.name = passiveName.trim();
            timeline.push({
              action: "parties_names_updated",
              by: interaction.user.id,
              at: now,
              active: activeName.trim(),
              passive: passiveName.trim(),
            });
          } else {
            const activeId = interaction.fields.getTextInputValue("active_id");
            const passiveId =
              interaction.fields.getTextInputValue("passive_id");
            if (!activeId.trim() || !passiveId.trim()) {
              return interaction.reply({
                content: "Os IDs das partes são obrigatórios.",
                ephemeral: true,
              });
            }
            metadata.parties.active.stateId = activeId.trim();
            metadata.parties.passive.stateId = passiveId.trim();
            timeline.push({
              action: "parties_ids_updated",
              by: interaction.user.id,
              at: now,
              active: activeId.trim(),
              passive: passiveId.trim(),
            });
          }

          const partiesList = buildPartiesDisplay(metadata);
          updatedCase = await db.updateCase(caseId, {
            metadata,
            parties: partiesList,
            timeline,
          });

          await db.addLog(
            caseId,
            action === "names" ? "update_parties_names" : "update_parties_ids",
            interaction.user.id,
            interaction.user.tag,
            action === "names"
              ? "Atualizou nomes das partes"
              : "Atualizou IDs das partes"
          );
          await audit.logAction(
            interaction.guild,
            caseId,
            action === "names" ? "update_parties_names" : "update_parties_ids",
            interaction.user,
            action === "names"
              ? "Atualizou nomes das partes"
              : "Atualizou IDs das partes"
          );

          await interaction.reply({
            content:
              action === "names"
                ? "Nomes das partes atualizados."
                : "IDs das partes atualizados.",
            ephemeral: true,
          });
        } else if (action === "details") {
          const title = interaction.fields
            .getTextInputValue("case_title")
            .trim();
          const type = interaction.fields.getTextInputValue("case_type").trim();
          const status = interaction.fields
            .getTextInputValue("case_status")
            .trim();
          const description = interaction.fields
            .getTextInputValue("case_description")
            .trim();

          if (!title || !type || !status) {
            return interaction.reply({
              content:
                "Título, tipo e status são obrigatórios para atualizar o processo.",
              ephemeral: true,
            });
          }

          metadata.type = type;
          timeline.push({
            action: "case_details_updated",
            by: interaction.user.id,
            at: now,
            status,
          });

          updatedCase = await db.updateCase(caseId, {
            title,
            type,
            status,
            description,
            metadata,
            timeline,
          });

          await db.addLog(
            caseId,
            "update_case_details",
            interaction.user.id,
            interaction.user.tag,
            "Atualizou dados gerais do processo"
          );
          await audit.logAction(
            interaction.guild,
            caseId,
            "update_case_details",
            interaction.user,
            "Atualizou dados gerais do processo"
          );

          await interaction.reply({
            content: "Dados gerais atualizados.",
            ephemeral: true,
          });
        }

        if (updatedCase) {
          let thread = null;
          if (updatedCase.thread_id && interaction.guild) {
            thread =
              interaction.guild.channels.cache.get(
                String(updatedCase.thread_id)
              ) || null;
            if (!thread) {
              try {
                thread = await interaction.guild.channels.fetch(
                  String(updatedCase.thread_id)
                );
              } catch (err) {
                thread = null;
              }
            }
          }
          if (thread) await updatePanelMessage(thread, updatedCase);

          if (interaction.message) {
            try {
              await interaction.message.edit(
                buildCaseDetailMessage(updatedCase, ownerId, page)
              );
            } catch (err) {
              await sendDebugMessage(
                interaction,
                "Falha ao atualizar painel do juiz",
                err
              );
            }
          }
        }

        return;
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

      if (interaction.customId.startsWith("intimation_modal_")) {
        const caseId = parseInt(interaction.customId.split("_").pop());
        const caseRow = await db.getCaseById(caseId);
        if (!caseRow)
          return interaction.reply({
            content: "`❌` | Processo não encontrado.",
            ephemeral: true,
          });

        if (
          !isJudgeOfCase(caseRow, interaction.user.id) &&
          !roles.memberHasRoleByKey(interaction.member, "admin")
        ) {
          return interaction.reply({
            content: "`❌` | Você não é o Juiz responsável por este processo.",
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        const intimado =
          interaction.fields.getTextInputValue("intimation_target");
        const motivo =
          interaction.fields.getTextInputValue("intimation_reason");
        const prazoRaw = interaction.fields.getTextInputValue(
          "intimation_deadline"
        );
        const prazo = parseInt(prazoRaw, 10);
        if (!Number.isInteger(prazo) || prazo <= 0) {
          return interaction.editReply({
            content:
              "`⚠️` | Informe um prazo válido em dias (número inteiro positivo).",
          });
        }

        let config = {};
        try {
          config = require("../config.json");
        } catch (e) {}

        const channelId = config.channels?.intimations;
        const guildChannel = channelId
          ? await interaction.guild.channels.fetch(channelId).catch(() => null)
          : null;

        if (!guildChannel) {
          return interaction.editReply({
            content:
              "`❌` | Canal de intimações não configurado ou inacessível. Ajuste `channels.intimations` no config.json.",
          });
        }

        const metadata = (() => {
          try {
            return JSON.parse(caseRow.metadata || "{}");
          } catch (e) {
            return {};
          }
        })();
        const parties = metadata.parties || {};
        const ativo = parties.active?.name || "—";
        const passivo = parties.passive?.name || "—";

        const limite = new Date(Date.now() + prazo * 24 * 60 * 60 * 1000);
        const embed = new EmbedBuilder()
          .setTitle("📨 Intimação Judicial")
          .setColor("#f1c40f")
          .addFields(
            {
              name: "Processo",
              value: `**${caseRow.case_number}**`,
              inline: true,
            },
            { name: "Prazo", value: `${prazo} dia(s)`, inline: true },
            {
              name: "Data limite",
              value: limite.toLocaleDateString(),
              inline: true,
            },
            { name: "Intimado", value: intimado, inline: false },
            { name: "Motivo", value: motivo, inline: false },
            {
              name: "Partes",
              value: `Polo Ativo: ${ativo}\nPolo Passivo: ${passivo}`,
              inline: false,
            }
          )
          .setTimestamp()
          .setFooter({ text: `Emitido por ${interaction.user.tag }` });

        await guildChannel.send({ embeds: [embed] }).catch((err) => {
          console.error("send intimation error", err);
        });

        const timeline = (() => {
          try {
            return JSON.parse(caseRow.timeline || "[]");
          } catch (e) {
            return [];
          }
        })();
        const now = new Date().toISOString();
        timeline.push({
          action: "intimation_issued",
          at: now,
          by: interaction.user.id,
          target: intimado,
          deadline_days: prazo,
        });

        await db.updateCase(caseRow.id, { timeline });
        await db.addLog(
          caseRow.id,
          "intimation_issued",
          interaction.user.id,
          interaction.user.tag,
          `Intimado ${intimado} com prazo de ${prazo} dia(s)`
        );
        await audit.logAction(
          interaction.guild,
          caseRow.id,
          "intimation_issued",
          interaction.user,
          `Intimação enviada para ${intimado}`
        );

        if (caseRow.thread_id) {
          const thread = await interaction.guild.channels
            .fetch(String(caseRow.thread_id))
            .catch(() => null);
          thread
            ?.send({
              content: `📨 Uma intimação foi emitida para **${intimado}** com prazo de ${prazo} dia(s).`,
            })
            .catch(() => null);
        }

        return interaction.editReply({
          content: "`✅` | Intimação emitida e registrada com sucesso.",
        });
      }

      if (interaction.customId.startsWith("hearing_quick_modal_")) {
        const caseId = parseInt(interaction.customId.split("_").pop());
        const caseRow = await db.getCaseById(caseId);
        if (!caseRow)
          return interaction.reply({
            content: "`❌` | Processo não encontrado.",
            ephemeral: true,
          });

        if (
          !isJudgeOfCase(caseRow, interaction.user.id) &&
          !roles.memberHasRoleByKey(interaction.member, "admin")
        ) {
          return interaction.reply({
            content: "`❌` | Você não é o Juiz responsável por este processo.",
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        const tipo =
          interaction.fields.getTextInputValue("hearing_type") || "Audiência";
        const dataRaw = interaction.fields.getTextInputValue("hearing_date");
        const horaRaw = interaction.fields.getTextInputValue("hearing_time");
        const local =
          interaction.fields.getTextInputValue("hearing_location") || "—";

        const [dia, mes, ano] = dataRaw
          .split(/[\/-]/)
          .map((v) => parseInt(v.trim(), 10));
        const [hora, minuto] = horaRaw
          .split(":")
          .map((v) => parseInt(v.trim(), 10));

        if (
          !ano ||
          !mes ||
          !dia ||
          typeof hora !== "number" ||
          typeof minuto !== "number"
        ) {
          return interaction.editReply({
            content:
              "`⚠️` | Informe data e horário válidos no formato solicitado.",
          });
        }

        const when = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto));
        if (Number.isNaN(when.getTime())) {
          return interaction.editReply({
            content:
              "`⚠️` | Não foi possível interpretar a data/horário informados.",
          });
        }

        const metadata = (() => {
          try {
            return JSON.parse(caseRow.metadata || "{}");
          } catch (e) {
            return {};
          }
        })();
        metadata.next_hearing = when.toISOString();
        metadata.next_hearing_label = tipo;

        const timeline = (() => {
          try {
            return JSON.parse(caseRow.timeline || "[]");
          } catch (e) {
            return [];
          }
        })();
        const now = new Date().toISOString();
        timeline.push({
          action: "hearing_scheduled",
          at: now,
          when: when.toISOString(),
          type: tipo,
          by: interaction.user.id,
        });

        const hearing = await db.addHearing(caseRow.id, {
          hearing_at: when.toISOString(),
          duration_minutes: 60,
          location: local,
          created_by: `${interaction.user.tag} (${interaction.user.id})`,
        });

        await db.updateCase(caseRow.id, {
          metadata,
          timeline,
        });
        await db.addLog(
          caseRow.id,
          "hearing_scheduled",
          interaction.user.id,
          interaction.user.tag,
          `${tipo} marcada para ${when.toISOString()} em ${local}`
        );
        await audit.logAction(
          interaction.guild,
          caseRow.id,
          "hearing_scheduled",
          interaction.user,
          `${tipo} marcada para ${when.toLocaleString()}`
        );
        scheduler.scheduleHearing(client, hearing).catch(() => null);

        let config = {};
        try {
          config = require("../config.json");
        } catch (e) {}
        const hearingChannelId = config.channels?.hearings;
        const hearingChannel = hearingChannelId
          ? await interaction.guild.channels
              .fetch(hearingChannelId)
              .catch(() => null)
          : null;

        const parties = metadata.parties || {};
        const ativo = parties.active?.name || "—";
        const passivo = parties.passive?.name || "—";
        const message =
          `📅 **${tipo} marcada**\n` +
          `> Processo: **${caseRow.case_number}**\n` +
          `> Partes: ${ativo} x ${passivo}\n` +
          `> Data: ${dia.toString().padStart(2, "0")}/${mes
            .toString()
            .padStart(2, "0")}/${ano} às ${horaRaw}\n` +
          `> Local: ${local}`;

        await hearingChannel?.send({ content: message }).catch(() => null);

        if (caseRow.thread_id) {
          const thread = await interaction.guild.channels
            .fetch(String(caseRow.thread_id))
            .catch(() => null);
          await thread
            ?.send({
              content: `📅 ${tipo} agendada para ${when.toLocaleString()} em ${local}.`,
            })
            .catch(() => null);
        }

        return interaction.editReply({
          content:
            "`✅` | Audiência/Julgamento agendado e publicado com sucesso.",
        });
      }

      if (interaction.customId.startsWith("case_edit_modal_")) {
        const caseId = parseInt(interaction.customId.split("_").pop());
        const caseRow = await db.getCaseById(caseId);
        if (!caseRow)
          return interaction.reply({
            content: "`❌` | Processo não encontrado.",
            ephemeral: true,
          });

        if (
          !isJudgeOfCase(caseRow, interaction.user.id) &&
          !roles.memberHasRoleByKey(interaction.member, "admin")
        ) {
          return interaction.reply({
            content: "`❌` | Você não é o Juiz responsável por este processo.",
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        const parsePartyField = (raw) => {
          if (!raw) return { name: "", stateId: "" };
          const parts = raw.split("|");
          const name = parts[0]?.trim() || "";
          const stateId = parts[1]?.trim() || "";
          return { name, stateId };
        };

        const activeField =
          interaction.fields.getTextInputValue("case_edit_active");
        const passiveField =
          interaction.fields.getTextInputValue("case_edit_passive");
        const typeField =
          interaction.fields.getTextInputValue("case_edit_type");
        const statusField =
          interaction.fields.getTextInputValue("case_edit_status");

        if (!activeField?.trim() || !passiveField?.trim()) {
          return interaction.editReply({
            content: "`⚠️` | Informe os dados completos das partes.",
          });
        }

        const metadata = (() => {
          try {
            return JSON.parse(caseRow.metadata || "{}");
          } catch (e) {
            return {};
          }
        })();
        metadata.parties = metadata.parties || { active: {}, passive: {} };
        metadata.parties.active = parsePartyField(activeField);
        metadata.parties.passive = parsePartyField(passiveField);
        metadata.type = typeField;

        const timeline = (() => {
          try {
            return JSON.parse(caseRow.timeline || "[]");
          } catch (e) {
            return [];
          }
        })();
        const now = new Date().toISOString();
        timeline.push({
          action: "case_updated",
          at: now,
          by: interaction.user.id,
        });

        const partiesDisplay = buildPartiesDisplay(metadata, []);
        const updated = await db.updateCase(caseRow.id, {
          type: typeField,
          status: statusField,
          metadata,
          parties: partiesDisplay,
          timeline,
        });

        await db.addLog(
          caseRow.id,
          "case_updated",
          interaction.user.id,
          interaction.user.tag,
          "Dados do processo atualizados via painel do Juiz"
        );
        await audit.logAction(
          interaction.guild,
          caseRow.id,
          "case_updated",
          interaction.user,
          "Dados principais do processo atualizados"
        );

        if (caseRow.thread_id) {
          const thread = await interaction.guild.channels
            .fetch(String(caseRow.thread_id))
            .catch(() => null);
          if (thread) {
            await updatePanelMessage(thread, updated);
            await thread
              .send({
                content:
                  "✏️ As informações principais do processo foram atualizadas pelo Juiz.",
              })
              .catch(() => null);
          }
        }

        return interaction.editReply({
          content: "`✅` | Informações do processo atualizadas com sucesso.",
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
      await sendDebugMessage(interaction, "Erro ao processar modal", err);
      if (interaction.deferred || interaction.replied)
        return interaction.followUp({
          content: "Ocorreu um erro ao processar o modal.",
          ephemeral: true,
        });
      return interaction.reply({
        content: "Ocorreu um erro ao processar o modal.",
        ephemeral: true,
      });
    }
  }
  if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
    try {
      const id = interaction.customId;
      // Suporte ao painel do juiz via select menu
      if (id.startsWith("case_actions_")) {
        const caseId = parseInt(id.replace("case_actions_", ""), 10);
        const caseRow = await db.getCaseById(caseId);
        if (!caseRow) {
          return interaction.reply({
            content: "`❌` | Processo não encontrado.",
            ephemeral: true,
          });
        }

        const isAssignedJudge = isJudgeOfCase(caseRow, interaction.user.id);
        const isAdmin = roles.memberHasRoleByKey(interaction.member, "admin");
        if (!isAssignedJudge && !isAdmin) {
          return interaction.reply({
            content:
              "`❌` | Apenas o Juiz responsável por este processo pode usar este menu.",
            ephemeral: true,
          });
        }

        const action = interaction.values[0];
        if (action === "alter_instance") {
          if (caseRow.instance >= 2) {
            return interaction.reply({
              content:
                "`⚠️` | Este processo já está na 2ª instância ou superior.",
              ephemeral: true,
            });
          }

          await interaction.deferReply({ ephemeral: true });
          try {
            const promotionMessage =
              `⚖️ O Juiz <@${interaction.user.id}> promoveu este processo à 2ª instância.\n` +
              "O processo seguirá com as mesmas informações e sistemas nesta instância.";
            await caseActions.escalateCase(
              caseRow,
              2,
              client,
              interaction.user,
              { customMessage: promotionMessage, includeActorMention: true }
            );
            //await interaction.send({
            //  content: `\`✅\` | ${caseRow.title} promovido para a 2ª instância.`,
            //});
          } catch (err) {
            console.error("alter_instance error", err);
            //await interaction.send({
            //  content: `\`❌\` | Não foi possível promover o ${caseRow.title} para a próxima instância. Verifique com a administração e tente novamente.`,
            //});
          }
          return;
        }

        if (action === "emit_intimation") {
          const modal = new ModalBuilder()
            .setCustomId(`intimation_modal_${caseRow.id}`)
            .setTitle("Emitir Intimação");

          const targetInput = new TextInputBuilder()
            .setCustomId("intimation_target")
            .setLabel("Intimado (Nome | ID)")
            .setPlaceholder("Nome Sobrenome | 12345")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(150);

          const reasonInput = new TextInputBuilder()
            .setCustomId("intimation_reason")
            .setLabel("Motivo da Intimação")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500);

          const deadlineInput = new TextInputBuilder()
            .setCustomId("intimation_deadline")
            .setLabel("Prazo para cumprimento (dias)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("5");

          modal.addComponents(
            new ActionRowBuilder().addComponents(targetInput),
            new ActionRowBuilder().addComponents(reasonInput),
            new ActionRowBuilder().addComponents(deadlineInput)
          );

          return interaction.showModal(modal);
        }

        if (action === "schedule_hearing") {
          const modal = new ModalBuilder()
            .setCustomId(`hearing_quick_modal_${caseRow.id}`)
            .setTitle("Agendar Audiência/Julgamento");

          const typeInput = new TextInputBuilder()
            .setCustomId("hearing_type")
            .setLabel("Tipo (Audiência/Julgamento)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
            .setValue("Audiência");

          const dateInput = new TextInputBuilder()
            .setCustomId("hearing_date")
            .setLabel("Data (DD/MM/AAAA)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("25/12/2024");

          const timeInput = new TextInputBuilder()
            .setCustomId("hearing_time")
            .setLabel("Horário (HH:MM)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("14:30");

          const locationInput = new TextInputBuilder()
            .setCustomId("hearing_location")
            .setLabel("Local da audiência")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder("Tribunal do Júri");

          modal.addComponents(
            new ActionRowBuilder().addComponents(typeInput),
            new ActionRowBuilder().addComponents(dateInput),
            new ActionRowBuilder().addComponents(timeInput),
            new ActionRowBuilder().addComponents(locationInput)
          );

          return interaction.showModal(modal);
        }

        if (action === "edit_case") {
          const metadata = (() => {
            try {
              return JSON.parse(caseRow.metadata || "{}");
            } catch (e) {
              return {};
            }
          })();
          const parties = metadata.parties || {
            active: { name: "", stateId: "" },
            passive: { name: "", stateId: "" },
          };

          const activeValue = [
            parties.active?.name || "",
            parties.active?.stateId || "",
          ]
            .filter(Boolean)
            .join(" | ");
          const passiveValue = [
            parties.passive?.name || "",
            parties.passive?.stateId || "",
          ]
            .filter(Boolean)
            .join(" | ");

          const modal = new ModalBuilder()
            .setCustomId(`case_edit_modal_${caseRow.id}`)
            .setTitle("Editar Informações do Processo");

          const activeInput = new TextInputBuilder()
            .setCustomId("case_edit_active")
            .setLabel("Polo Ativo (Nome | State ID)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
          if (activeValue) activeInput.setValue(activeValue);

          const passiveInput = new TextInputBuilder()
            .setCustomId("case_edit_passive")
            .setLabel("Polo Passivo (Nome | State ID)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
          if (passiveValue) passiveInput.setValue(passiveValue);

          const typePrefill = caseRow.type || metadata.type || "";
          const typeInput = new TextInputBuilder()
            .setCustomId("case_edit_type")
            .setLabel("Tipo do Processo")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
          if (typePrefill) typeInput.setValue(typePrefill);

          const statusPrefill = caseRow.status || "Ativo";
          const statusInput = new TextInputBuilder()
            .setCustomId("case_edit_status")
            .setLabel("Status do Processo")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(statusPrefill);

          modal.addComponents(
            new ActionRowBuilder().addComponents(activeInput),
            new ActionRowBuilder().addComponents(passiveInput),
            new ActionRowBuilder().addComponents(typeInput),
            new ActionRowBuilder().addComponents(statusInput)
          );

          return interaction.showModal(modal);
        }

        return interaction.deferUpdate().catch(() => null);
      }

      if (id.startsWith("judge_panel_")) {
        const segments = id.split(":");
        const root = segments[0];
        const ownerId = segments[1];
        if (ownerId !== interaction.user.id) {
          return interaction.reply({
            content: "Este painel pertence a outro Juiz.",
            ephemeral: true,
          });
        }

        if (root === "judge_panel_select") {
          // Espera-se que o valor selecionado seja o ID do caso
          const selected = interaction.values[0];
          const caseId = parseInt(selected);
          // Recupera todos os casos do juiz para paginação
          const cases = await loadJudgeCases(ownerId);
          const totalPages = Math.max(
            0,
            Math.ceil(cases.length / CASES_PER_PAGE) - 1
          );
          // Tenta encontrar a página do caso selecionado
          let page = 0;
          const idx = cases.findIndex((c) => c.id === caseId);
          if (idx !== -1) page = Math.floor(idx / CASES_PER_PAGE);

          const caseRow = await db.getCaseById(caseId);
          if (!caseRow) {
            return interaction.update(
              buildOverviewMessage(cases, page, ownerId)
            );
          }
          const allowed = filterCasesByJudge([caseRow], ownerId).length > 0;
          if (!allowed) {
            return interaction.update(
              buildOverviewMessage(cases, page, ownerId)
            );
          }
          return interaction.update(
            buildCaseDetailMessage(caseRow, ownerId, page)
          );
        }
      }
    } catch (err) {
      console.error("Select menu interaction error", err);
      await sendDebugMessage(interaction, "Erro ao processar select", err);
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({
          content: "Ocorreu um erro ao processar a interação.",
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: "Ocorreu um erro ao processar a interação.",
        ephemeral: true,
      });
    }
    return;
  }
  if (interaction.isButton && interaction.isButton()) {
    try {
      const id = interaction.customId;
      if (id == "criar_processo") {
        // open modal to create case with requested fields:
        // Nome Polo Ativo, State ID Polo Ativo, Nome Polo Passivo, State ID Polo Passivo, Tipo de Processo
        const modal = new ModalBuilder()
          .setCustomId("case_create_modal")
          .setTitle("Criar Processo | DOJ V1 (BETA)");

        const activeName = new TextInputBuilder()
          .setCustomId("active_name")
          .setLabel("Nome do Polo Ativo")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100);
        const activeState = new TextInputBuilder()
          .setCustomId("active_state")
          .setLabel("State ID do Polo Ativo")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50);
        const passiveName = new TextInputBuilder()
          .setCustomId("passive_name")
          .setLabel("Nome do Polo Passivo")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100);
        const passiveState = new TextInputBuilder()
          .setCustomId("passive_state")
          .setLabel("State ID do Polo Passivo")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50);
        const procType = new TextInputBuilder()
          .setCustomId("case_type")
          .setLabel("Tipo de Processo (Civil/Crim/Ético/Admin)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50);

        // exactly 5 components
        modal.addComponents(
          new ActionRowBuilder().addComponents(activeName),
          new ActionRowBuilder().addComponents(activeState),
          new ActionRowBuilder().addComponents(passiveName),
          new ActionRowBuilder().addComponents(passiveState),
          new ActionRowBuilder().addComponents(procType)
        );

        return interaction.showModal(modal);
      }
      if (id.startsWith("judge_panel_")) {
        const segments = id.split(":");
        const root = segments[0];
        const ownerId = segments[1];
        if (ownerId !== interaction.user.id) {
          return interaction.reply({
            content: "`💀` | Este painel pertence a outro Juiz.",
            ephemeral: true,
          });
        }

        try {
          if (root === "judge_panel_close") {
            return interaction.update({
              content: "`💀` | Painel encerrado.",
              embeds: [],
              components: [],
            });
          }

          const cases = await loadJudgeCases(ownerId);
          const totalPages = Math.max(
            0,
            Math.ceil(cases.length / CASES_PER_PAGE) - 1
          );

          if (
            root.startsWith("judge_panel_nav") ||
            root === "judge_panel_refresh"
          ) {
            const targetPage = Math.min(
              Math.max(0, parseInt(segments[2]) || 0),
              totalPages
            );
            return interaction.update(
              buildOverviewMessage(cases, targetPage, ownerId)
            );
          }

          if (root === "judge_panel_back") {
            const page = Math.min(
              Math.max(0, parseInt(segments[2]) || 0),
              totalPages
            );
            return interaction.update(
              buildOverviewMessage(cases, page, ownerId)
            );
          }

          if (root === "judge_panel_action") {
            const caseId = parseInt(segments[2]);
            const page = Math.min(
              Math.max(0, parseInt(segments[3]) || 0),
              totalPages
            );
            const action = segments[4];
            const caseRow = await db.getCaseById(caseId);
            if (!caseRow) {
              return interaction.update(
                buildOverviewMessage(cases, page, ownerId)
              );
            }

            const metadata = (() => {
              try {
                return JSON.parse(caseRow.metadata || "{}");
              } catch (err) {
                return {};
              }
            })();
            const parties = metadata.parties || {};

            const modalBaseId = `${caseId}_${page}_${ownerId}`;
            if (action === "instance") {
              const modal = new ModalBuilder()
                .setCustomId(`judge_panel_modal_instance_${modalBaseId}`)
                .setTitle("Alterar instância");
              const input = new TextInputBuilder()
                .setCustomId("instance_value")
                .setLabel("Nova instância")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(caseRow.instance || ""));
              modal.addComponents(new ActionRowBuilder().addComponents(input));
              return interaction.showModal(modal);
            }

            if (action === "names") {
              const modal = new ModalBuilder()
                .setCustomId(`judge_panel_modal_names_${modalBaseId}`)
                .setTitle("Alterar nomes das partes");
              const activeName = new TextInputBuilder()
                .setCustomId("active_name")
                .setLabel("Nome do Polo Ativo")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100)
                .setValue(parties.active?.name || "");
              const passiveName = new TextInputBuilder()
                .setCustomId("passive_name")
                .setLabel("Nome do Polo Passivo")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100)
                .setValue(parties.passive?.name || "");
              modal.addComponents(
                new ActionRowBuilder().addComponents(activeName),
                new ActionRowBuilder().addComponents(passiveName)
              );
              return interaction.showModal(modal);
            }

            if (action === "ids") {
              const modal = new ModalBuilder()
                .setCustomId(`judge_panel_modal_ids_${modalBaseId}`)
                .setTitle("Alterar IDs das partes");
              const activeId = new TextInputBuilder()
                .setCustomId("active_id")
                .setLabel("State ID do Polo Ativo")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(parties.active?.stateId || "");
              const passiveId = new TextInputBuilder()
                .setCustomId("passive_id")
                .setLabel("State ID do Polo Passivo")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(parties.passive?.stateId || "");
              modal.addComponents(
                new ActionRowBuilder().addComponents(activeId),
                new ActionRowBuilder().addComponents(passiveId)
              );
              return interaction.showModal(modal);
            }

            if (action === "details") {
              const modal = new ModalBuilder()
                .setCustomId(`judge_panel_modal_details_${modalBaseId}`)
                .setTitle("Editar dados do processo");
              const titleInput = new TextInputBuilder()
                .setCustomId("case_title")
                .setLabel("Título do processo")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100)
                .setValue(caseRow.title || "");
              const typeInput = new TextInputBuilder()
                .setCustomId("case_type")
                .setLabel("Tipo de processo")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(50)
                .setValue(caseRow.type || "");
              const statusInput = new TextInputBuilder()
                .setCustomId("case_status")
                .setLabel("Status")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(30)
                .setValue(caseRow.status || "Pendente");
              const descriptionInput = new TextInputBuilder()
                .setCustomId("case_description")
                .setLabel("Descrição")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setValue(caseRow.description || "");
              modal.addComponents(
                new ActionRowBuilder().addComponents(titleInput),
                new ActionRowBuilder().addComponents(typeInput),
                new ActionRowBuilder().addComponents(statusInput),
                new ActionRowBuilder().addComponents(descriptionInput)
              );
              return interaction.showModal(modal);
            }

            return interaction.reply({
              content: "`💀` | Ação não suportada.",
              ephemeral: true,
            });
          }
        } catch (err) {
          console.error("Judge panel button error", err);
          await sendDebugMessage(interaction, "Erro no painel do juiz", err);
          if (interaction.deferred || interaction.replied) {
            return interaction.followUp({
              content: "`💀` | Não foi possível processar esta ação.",
              ephemeral: true,
            });
          }
          return interaction.reply({
            content: "`💀` | Não foi possível processar esta ação.",
            ephemeral: true,
          });
        }
      }
      // protocol_<caseId>
      if (id.startsWith("protocol_")) {
        const caseId = parseInt(id.split("_")[1]);
        const caseRow = await db.get("SELECT * FROM cases WHERE id = ?", [
          caseId,
        ]);
        if (!caseRow)
          return interaction.reply({
            content: "`💀` | Processo não encontrado.",
            ephemeral: true,
          });
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
            content: "`💀` | Processo não encontrado.",
            ephemeral: true,
          });
        // we expect this interaction to happen in guild context
        const guild = interaction.guild;
        let thread = null;
        if (
          interaction.channel &&
          interaction.channel.id === String(caseRow.thread_id)
        ) {
          thread = interaction.channel;
        } else {
          thread = guild.channels.cache.get(String(caseRow.thread_id)) || null;
          if (!thread) {
            try {
              thread = await guild.channels.fetch(String(caseRow.thread_id));
            } catch (fetchErr) {
              thread = null;
            }
          }
        }
        if (!thread)
          return interaction.reply({
            content: "`💀` | Tópico do processo não encontrado.",
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
                "`💀` | Você precisa possuir o cargo de Juiz ou Administrador para se habilitar como Juiz neste processo.",
              ephemeral: true,
            });
          }
        } else if (
          !roles.memberHasRoleByKey(interaction.member, "defender") &&
          !roles.memberHasRoleByKey(interaction.member, "admin")
        ) {
          return interaction.reply({
            content:
              "`❌` | Apenas usuários com o cargo de Defensor/Advogado ou Administrador podem se habilitar por este botão.",
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
            content: `\`❌\` | Este cargo já está ocupado por <@${existingId}>. Caso seja necessário substituir, solicite a um administrador.`,
            ephemeral: true,
          });
        }
        if (existingId === interaction.user.id) {
          return interaction.reply({
            content:
              "`❌` | Você já está habilitado neste cargo para o processo.",
            ephemeral: true,
          });
        }
        if (
          !existingId &&
          typeof existing === "string" &&
          existing.trim().length
        ) {
          return interaction.reply({
            content: "`❌` | Este cargo já foi preenchido para o processo.",
            ephemeral: true,
          });
        }

        participants[roleKey] = {
          id: interaction.user.id,
          tag: interaction.user.tag,
        };

        try {
          if (thread.permissionOverwrites?.edit) {
            await thread.permissionOverwrites
              .edit(interaction.user.id, {
                SendMessages: true,
                ViewChannel: true,
              })
              .catch(() => null);
          } else if (
            typeof thread.isThread === "function" &&
            thread.isThread() &&
            thread.members?.add
          ) {
            await thread.members.add(interaction.user.id).catch(() => null);
          }

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

          const panelEmbed = buildPanelEmbed(participants);
          const caseEmbed = buildCaseEmbed(updatedCase);
          const panelComponents = buildPanelButtons(caseRow.id, participants);

          await interaction.update({
            embeds: [panelEmbed, caseEmbed],
            components: panelComponents,
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
              formatParticipantDisplay(authorEntry) || "Defensor do Polo Ativo";
            const passiveMention =
              formatParticipantDisplay(passiveEntry) ||
              "Defensor do Polo Passivo";
            await thread
              .send({
                content: `\`✅\` |  ${judgeMention}, ${activeMention} e ${passiveMention}, todas as partes estão habilitadas. Polo Ativo, por favor, protocole a Petição Inicial para dar sequência ao processo.`,
              })
              .catch(() => null);
          }
        } catch (err) {
          console.error("enable participant error", err);
          await sendDebugMessage(
            interaction,
            "Erro ao habilitar participante",
            err
          );
          if (interaction.deferred || interaction.replied) {
            return interaction.followUp({
              content: "`❌` | Erro ao habilitar participante.",
              ephemeral: true,
            });
          }
          return interaction.reply({
            content: "`❌` | Erro ao habilitar participante.",
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
            content: "`❌` | Processo não encontrado.",
            ephemeral: true,
          });
        // check permission: only Judge or Administrator
        if (
          !roles.memberHasRoleByKey(interaction.member, "judge") &&
          !roles.memberHasRoleByKey(interaction.member, "admin")
        ) {
          return interaction.reply({
            content:
              "`❌` | Você não tem permissão para escalonar este processo.",
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
            "`⚠️` | Editar via painel ainda não implementado. Use /case manage para editar.",
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
            content: "`❌` | Processo não encontrado.",
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
            "`✅` | Solicitação de habilitação recebida. Use /case enroll para especificar cargo.",
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error("Button interaction error", err);
      await sendDebugMessage(interaction, "Erro ao processar botão", err);
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({
          content: "`❌` | Ocorreu um erro ao processar a interação.",
          ephemeral: true,
        });
      }
    }
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "`❌` | Ocorreu um erro ao processar a interação.",
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
    try {
      const id = interaction.customId;
      if (id.startsWith("action_select_")) {
        const val = interaction.values[0];
        await interaction.deferUpdate();
        return interaction.followUp({
          content: `Ação selecionada: ${val}. Use o painel para confirmar.`,
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error("Select menu interaction error", err);
      await sendDebugMessage(interaction, "Erro ao processar select", err);
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({
          content: "`❌` |Ocorreu um erro ao processar a interação.",
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: "`❌` | Ocorreu um erro ao processar a interação.",
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.isAutocomplete && interaction.isAutocomplete()) {
    const slashCommand = client.slashCommands.get(interaction.commandName);
    if (slashCommand && typeof slashCommand.autocomplete === "function") {
      try {
        const choices = [];
        await slashCommand.autocomplete(interaction, choices);
      } catch (err) {
        console.error("Autocomplete error", err);
        await sendDebugMessage(interaction, "Erro no autocomplete", err);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand || !interaction.isChatInputCommand())
    return;
  if (!interaction.guild) return;

  const slashCommand = client.slashCommands.get(interaction.commandName);
  if (!slashCommand) {
    client.slashCommands.delete(interaction.commandName);
    return;
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
            "`❌` | Eu não possuo a permissão `" +
              (slashCommand.botPerms || "") +
              "`"
          )
          .setColor("Red");
        return interaction.reply({ embeds: [botPerms], ephemeral: true });
      }
    }

    if (slashCommand.ownerOnly) {
      if (!process.env.OWNER.includes(interaction.user.id)) {
        return interaction.reply({
          content: "`❌` | Apenas meu dono pode executar esse comando!",
          ephemeral: true,
        });
      }
    }

    await slashCommand.run(client, interaction);
  } catch (error) {
    console.log(error);
    await sendDebugMessage(interaction, "Erro ao executar comando", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "`❌` | Ocorreu um erro ao executar este comando.",
        ephemeral: true,
      });
    }
  }
});
