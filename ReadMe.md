
# ⚖️ JuridicoBot

Um bot avançado para **gestão de casos jurídicos no Discord**, desenvolvido em **Node.js**.  
Ele automatiza funções como criação de casos, painéis de juízes, auditorias e comunicação entre membros de equipes jurídicas dentro de servidores do Discord.

---

## 📘 Funcionalidades Principais

- 📂 **Gerenciamento de casos** — Criação, acompanhamento e atualização de processos.
- ⚖️ **Painel do juiz** — Interface para juízes gerenciarem e julgarem casos.
- 🧑‍💼 **Sistema de permissões** — Controle de papéis e autorizações.
- 🧾 **Logs e auditorias** — Registro detalhado de todas as ações importantes.
- ⏰ **Agendamentos automáticos** — Tarefas programadas com o `scheduler`.
- 💬 **Comandos Slash e de mensagem** — Suporte completo para comandos modernos do Discord.

---

## 🧩 Estrutura do Projeto

```

JuridicoBot/
├── Commands/
│   ├── Case/
│   │   ├── case.js
│   │   ├── criarmensagem.js
│   │   └── paineljuiz.js
│   └── Information/
│       └── ping.js
│
├── Events/
│   ├── interactionProcess.js
│   ├── messageCreate.js
│   └── ready.js
│
├── Handlers/
│   ├── events.js
│   └── slashCommand.js
│
├── Templates/
│   ├── caseEmbed.js
│   ├── comando.js
│   └── eventos.js
│
├── lib/
│   ├── audit.js
│   ├── caseActions.js
│   ├── db.js
│   ├── debug.js
│   ├── habilitationPanel.js
│   ├── judgePanel.js
│   ├── roles.js
│   └── scheduler.js
│
├── config.json
├── index.js
├── package.json
├── pnpm-lock.yaml
└── README.md

````

---

## ⚙️ Requisitos

- **Node.js** v18 ou superior  
- **npm** ou **pnpm** (gerenciador de pacotes)
- Um **bot registrado no Discord Developer Portal**
- Token do bot configurado no `config.json`

---

## 🧰 Instalação

### 1️⃣ Clonar o repositório
```bash
git clone https://github.com/wyllyanvieira/JuridicoBot.git
cd JuridicoBot-main
````

### 2️⃣ Instalar dependências

Usando **npm**:

```bash
npm install
```

ou, se preferir **pnpm**:

```bash
pnpm install
```

### 3️⃣ Configurar o arquivo `config.json`

Abra o arquivo `config.json` e edite conforme necessário:

```json
{
  "token": "SEU_TOKEN_DO_DISCORD",
  "clientId": "ID_DO_CLIENTE_DO_DISCORD",
  "guildId": "ID_DO_SERVIDOR_DISCORD",
  "prefix": "!"
}
```

> ⚠️ **Não compartilhe seu token!**
> Ele dá controle total sobre o seu bot.

---

## 🚀 Executando o Bot

Após configurar tudo, inicie o bot com:

```bash
node index.js
```

Ou, se quiser monitorar automaticamente com **nodemon** (instale com `npm install -g nodemon`):

```bash
nodemon index.js
```

---

## 🧪 Testando o Bot

1. Entre no seu servidor Discord.
2. Verifique se o bot está **online**.
3. Use `/ping` para confirmar que está respondendo.
4. Experimente os comandos de **casos jurídicos** (como `/case` ou `/paineljuiz`).

---

## 🔍 Logs e Auditoria

O arquivo `lib/audit.js` controla o sistema de auditoria, registrando:

* Ações de criação e exclusão de casos.
* Atualizações e julgamentos.
* Interações entre usuários e o bot.

---

## 📅 Tarefas Agendadas

O arquivo `lib/scheduler.js` é responsável por executar tarefas automáticas em horários definidos, ideal para:

* Limpeza de casos antigos.
* Notificações automáticas.

---

## 🧠 Desenvolvimento

O projeto segue um padrão modular:

* Cada comando fica em `Commands/`
* Eventos do Discord em `Events/`
* Lógica interna em `lib/`
* Carregamento automático de comandos via `Handlers/`

---

## 👥 Créditos

Desenvolvido por **Hope Studios**
Contribuições e melhorias são bem-vindas!

---

## 📄 Licença

Este projeto é distribuído sob a licença **MIT**.
Sinta-se livre para usar, modificar e distribuir — apenas mantenha os créditos.

---

### 💬 Contato e Suporte

Caso precise de ajuda, entre em contato via:

* Discord: `@wyllyan.br`
* GitHub Issues: [Abrir Issue](https://github.com/seuusuario/JuridicoBot/issues)

```


