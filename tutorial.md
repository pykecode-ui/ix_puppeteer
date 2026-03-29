# 🚀 Tutorial py_ix: Funções do Projeto por Etapas

Este tutorial apresenta um resumo direto e organizado em etapas de todas as principais funções e módulos que compõem o ecossistema **py_ix** (Painel Web + Bot Python).

---

## 🛠️ Etapa 1: Preparação e Conexão (Setup)

Nesta fase, a comunicação entre o painel central e as máquinas rodando os bots é estabelecida.

- **Conexão via API Key:** O Painel Web e os Bots se autenticam utilizando uma chave de API (`api_key`).
- **Registro do Bot (Heartbeat):** Cada script Python iniciado gera um `bot_uid` único e começa a enviar alertas de status ("heartbeats") a cada 5 segundos para o painel.
- **Detecção de Status:** O painel recebe os heartbeats e exibe se o bot remoto está **Online** ou **Offline** (timeout de 15s).
- **Renomeação de Bots:** No painel, você pode dar nomes amigáveis para identificar facilmente em qual PC/servidor o bot está rodando.

---

## 👥 Etapa 2: Gerenciamento e Sincronização de Perfis

Antes de automatizar, o sistema precisa conhecer os perfis do ixBrowser existentes na máquina do bot.

- **Sincronização:** O bot extrai e envia os dados dos perfis (Nome, IP, País, Região, etc.) direto do ixBrowser para o Painel.
- **Configuração de Limites (Fila):** No painel, você define o **limite de execuções simultâneas** (quantos perfis abrem agrupados de uma vez) e o **limite de repetições** individual para cada perfil.
- **Edição em Massa:** Você pode atualizar configurações e repetições de múltiplos perfis com um clique através do painel.

---

## 🧩 Etapa 3: Sistema de Módulos (Ações Pós-Abertura)

Os módulos ditam o que o perfil deve fazer automaticamente após ser aberto pelo ixBrowser.

- **Criação de Módulos:** No painel (menu *Módulos*), você cria regras contendo:
  - **URL do Site:** Qual link abrir.
  - **Delay:** Pode ser Fixo (ex: 5s cravados) ou Aleatório (ex: entre 2s e 10s) para simular comportamento humano.
- **Atribuição:** Você vincula os módulos aos perfis. É possível fazer essa atribuição de forma individual ou em massa (tanto na criação quanto na adição aos bots).
- **Gerenciamento:** Módulos podem ser criados, ativados/inativados, clonados para facilitar novas regras, ou excluídos.

---

## 🚀 Etapa 4: Execução da Fila (O fluxo do Bot)

Esta é a etapa onde a mágica acontece na máquina onde o ixBrowser e o Bot rodam.

1. **Leitura da Fila:** O Bot entra em estado `Running`, checa a fila no banco de dados e seleciona os próximos perfis respeitando o limite simultâneo estabelecido.
2. **Abertura:** O Bot chama a API Local do ixBrowser para abrir o perfil.
3. **Atualização de Status e Contador:** Retorna para o painel dizendo que o perfil abriu (Status Verde) e incrementa uma execução no contador.
4. **Execução do Módulo:** O Bot verifica qual módulo está vinculado ao perfil. Se houver:
   - Aguarda o delay (fixo ou aleatório) estabelecido.
   - Navega com o Selenium de forma oculta até a URL do módulo configurado.
5. **Fechamento e Repetição:** Quando o perfil é fechado, o bot avisa o painel. Se ainda houver limite de repetições ("infinito" ou "maior que a contagem atual"), ele o devolve no fim da fila para abrir de novo futuramente.

---

## 📊 Etapa 5: Controle e Monitoramento

Enquanto os bots estão operando e as filas rodando, o administrador controla tudo.

- **Dashboard Principal:** Visão global com todos os bots da sua operação, cards de acesso rápido e contador de robôs ativos.
- **Painel de Controle do Bot:** Controle individual de Start/Pause/Stop do fluxo do bot direto de forma remota.
- **Status Real-time:** A página atualiza sozinha via AJAX para mostrar IPs, tempo aberto de cada perfil e se o ícone está verde (operando) ou vermelho (fechado).
- **Console de Logs:** Registros completos (logs) enviados pelo robô reportando sucessos, erros e avisos detalhados que você lê direto no painel web, eliminando a precisão de acesso ao PC do bot para ver erros.
