const client = require('..');
const ms = require('ms');
const sqlite3 = require('sqlite3').verbose();
const chalk = require('chalk');
const scheduler = require('../lib/scheduler');
const {all} = require('../lib/db.js');

const processosNumber = all.length;

const activities_list = [
  `Encontrou BUG? Reporte para ser corrijido!`,  
  `Gerenciando ${processosNumber} processos`,  
  `Desenvolvido por @wyllyan.br`, 
];

client.on("clientReady", () => {
  const { user } = client;
  setInterval(() => {
    const index = Math.floor(Math.random() * activities_list.length);
    user.setActivity({ name: `${activities_list[index]}`, type: 3 });
  }, ms("5s"));

  // Conexão com SQLite
  const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
      console.error(chalk.red('Erro ao conectar ao SQLite:'), err.message);
    } else {
      console.log(chalk.green('Conectado ao SQLite!'));
    }
  });

  console.log(chalk.blue(`${client.user.username} online!`));
  
  // start scheduler
  try {
    scheduler.start(client).catch(() => null);
  } catch (e) { }
});
