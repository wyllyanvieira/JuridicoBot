const { Message, ChannelType } = require('discord.js');
const client = require('../index');
const db = require('../lib/db');
const talkedRecently = new Set();



// Evento feito para sistema de nível. Se o seu bot não possui sistema de níveis, você pode remover esse arquivo!

// Event made for leveling system. If your bot dont have this system, you can delet this file!


client.on('messageCreate', async Message => {

    if (!Message.guild) return;
    if (Message.author.bot) return;
    if (talkedRecently.has(Message.author.id)) return;

    talkedRecently.add(Message.author.id);
    setTimeout(() => {
        talkedRecently.delete(Message.author.id);
    }, 5000)

        try {
            const channel = Message.channel;
            // If message is inside a forum topic thread, try to map to a case
            if (channel && channel.isThread && channel.isThread()) {
                const threadId = String(channel.id);
                const caseRow = await db.get('SELECT * FROM cases WHERE thread_id = ?', [threadId]);
                if (caseRow) {
                    // handle attachments
                    if (Message.attachments && Message.attachments.size > 0) {
                        const axios = require('axios');
                        const fs = require('fs');
                        const path = require('path');
                        const storageDir = path.resolve(__dirname, '..', 'storage', 'attachments');
                        try { fs.mkdirSync(storageDir, { recursive: true }); } catch (e) {}

                        for (const attach of Message.attachments.values()) {
                            // basic validation: size limit 8MB and allowed types (pdf, png, jpg, jpeg, docx)
                            const maxSize = 8 * 1024 * 1024;
                            if (attach.size > maxSize) {
                                Message.reply({ content: `Arquivo ${attach.name} excede o limite de 8MB e não foi salvo.`, ephemeral: true }).catch(() => null);
                                continue;
                            }
                            const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.doc'];
                            const lower = (attach.name || '').toLowerCase();
                            if (!allowed.some(ext => lower.endsWith(ext))) {
                                Message.reply({ content: `Tipo de arquivo não permitido: ${attach.name}`, ephemeral: true }).catch(() => null);
                                continue;
                            }

                            // download file
                            const outPath = path.join(storageDir, `${Date.now()}_${attach.id}_${attach.name}`.replace(/[^a-zA-Z0-9._-]/g, '_'));
                            try {
                                const res = await axios({ url: attach.url, method: 'GET', responseType: 'stream' });
                                const writer = fs.createWriteStream(outPath);
                                res.data.pipe(writer);
                                await new Promise((resolve, reject) => writer.on('finish', resolve).on('error', reject));
                            } catch (err) {
                                console.error('download error', err);
                            }

                            await db.addDocument(caseRow.id, { filename: attach.name, url: attach.url, uploaded_by: `${Message.author.tag} (${Message.author.id})` });
                            // update documents table to include local path (quick update)
                            // note: documents table currently doesn't have local_path column; we can extend in future. For now, details in activity log
                            await db.addLog(caseRow.id, 'upload_document', Message.author.id, Message.author.tag, `Arquivo anexado: ${attach.name} (salvo em ${outPath})`);
                            // notify public movements (use config id if present)
                            let publicChannel = null;
                            try { const cfg = require('../config.json'); if (cfg && cfg.channels && cfg.channels.movements) publicChannel = Message.guild.channels.cache.get(cfg.channels.movements); } catch (e) {}
                            if (!publicChannel) publicChannel = Message.guild.channels.cache.find(c => c.name === '📢-movimentações');
                            if (publicChannel) {
                                publicChannel.send({ content: `📎 Documento protocolado em ${caseRow.case_number}: **${attach.name}**` }).catch(() => null);
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error('messageCreate error:', err);
        }

})
