# 🤖 ix-bot — Bot Portável de Automação ixBrowser

Bot standalone que se conecta ao dashboard ix via API REST + Socket.io.
Controla múltiplos perfis ixBrowser em paralelo via Puppeteer.

---

## ✅ Requisitos

| Requisito | Versão |
|---|---|
| Node.js | v18 ou superior |
| ixBrowser | Instalado e aberto nesta máquina |
| Acesso ao dashboard | Rede local ou internet |

---

## ⚙️ Configuração (obrigatória)

Edite o arquivo `config.js` antes de iniciar:

```js
module.exports = {
  // URL do servidor do dashboard
  DASHBOARD_API_URL: 'http://192.168.1.100:3000',  // ← altere aqui

  // Nome amigável exibido no painel
  BOT_NAME: 'Bot VPS-01',  // ← altere aqui

  // API local do ixBrowser (geralmente não precisa alterar)
  IX_API_BASE: 'http://127.0.0.1:53200',
};
```

---

## 🚀 Inicialização

```bash
# 1. Instale as dependências (apenas uma vez)
npm install

# 2. Inicie o bot
node bot.js

# Ou com auto-reload (desenvolvimento)
npm run dev
```

---

## 🔑 Bot ID

Ao iniciar pela primeira vez, um UUID único é gerado e salvo em `.bot-id`.
Este arquivo identifica este bot no dashboard — **não delete ou compartilhe**.

Se quiser criar uma nova instância em outra máquina, basta copiar a pasta
**sem** o arquivo `.bot-id` — um novo ID será gerado automaticamente.

---

## 📡 Comandos disponíveis (via dashboard)

| Comando | Payload | Descrição |
|---|---|---|
| `open_profile` | `{ profileId: 376 }` | Abre perfil no ixBrowser e conecta Puppeteer |
| `close_profile` | `{ profileId: 376 }` | Fecha perfil e desconecta Puppeteer |
| `close_all_profiles` | `{}` | Fecha todos os perfis ativos |
| `list_profiles` | `{}` | Lista perfis abertos e suas URLs |
| `navigate` | `{ profileId: 376, url: "https://..." }` | Navega para uma URL |

---

## 🗂️ Estrutura de Arquivos

```
bot/
  bot.js              ← Entry point (execute este arquivo)
  config.js           ← ⚙️ Configuração (edite antes de iniciar)
  package.json        ← Dependências
  .bot-id             ← UUID único desta instância (gerado automaticamente)
  src/
    api/
      dashboard-client.js  ← Comunicação HTTP + Socket.io com o dashboard
      ixbrowser.js         ← API local do ixBrowser
    bot/
      puppeteer.js         ← Automação multi-perfil via Puppeteer
    modules/
      index.js             ← Dispatcher de comandos (adicione novos aqui)
```

---

## ➕ Adicionar Novos Comandos

Edite `src/modules/index.js` e adicione uma função no objeto `COMMANDS`:

```js
const COMMANDS = {
  // Exemplo de novo comando
  async meu_comando({ profileId, parametro }) {
    log('info', `Executando meu_comando no perfil #${profileId}...`);
    const session = puppeteerBot.getProfileSession(profileId);
    // ... sua lógica aqui
    return { ok: true };
  },
};
```

O comando ficará disponível automaticamente no dashboard.
