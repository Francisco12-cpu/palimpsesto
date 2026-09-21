# Palimpsesto — estado do projeto

> Jogo multiplayer de escrita: cada jogador recebe uma **vanguarda literária** secreta, escreve um texto no
> estilo dela e os outros tentam adivinhar qual foi.
> Criação: **Francisco Audir** — @filho.af

**Jogue agora:** https://francisco12-cpu.github.io/palimpsesto/ (nada para instalar; funciona no celular)
**Código:** https://github.com/Francisco12-cpu/palimpsesto

Este documento descreve o projeto **como ele está hoje**. Os números da seção 9 saem do analisador
(`npm run analyze`) e podem ser regenerados a qualquer momento.

**Status:** motor, conteúdo, rede local, modo online sem servidor, visual, sons, celular e empacotamento estão
implementados e verificados em **navegador real** (Edge/Chromium e Firefox/Gecko), inclusive duas máquinas
jogando uma partida completa no site publicado. Pendências que dependem de uma pessoa estão na seção 10.

---

## 1. Como usar

| Quero… | Como |
|---|---|
| **Jogar com amigos (mais fácil)** | abrir o link do Pages, “Criar sala”, mostrar o **QR code**; os amigos escaneiam. Precisa de internet |
| **Jogar sem internet (mesmo Wi-Fi)** | no PC do host, `iniciar.bat` → “Criar sala” → QR code. Se alguém não entrar: `liberar-firewall.bat` (uma vez) |
| Rodar sem `.bat` | `npm run serve` |
| Levar num pendrive (com Node dentro) | `npm run pack` → `dist/Palimpsesto/` e `.zip` |
| Testar (rápido, ~20 s) | `npm test` (95 testes) |
| Testar em navegadores reais | `npm run test:e2e` (Edge/Chrome e Firefox; `SHOTS=pasta` grava telas) |
| Verificar o site publicado | `npm run verify:pages` |
| Analisar o projeto | `npm run analyze` (`-- --out=arquivo.md` grava; `-- --no-tests` é mais rápido) |
| **Publicar mudanças** | `git add -A && git commit -m "..." && git push` — o Pages republica em ~20 s |

Requisitos: **Node 22+** só para hospedar em rede local e para desenvolver. Jogadores só precisam de navegador.
`npm install` instala apenas dependências **de desenvolvimento** (testes e ferramentas); o jogo não tem
dependências de execução.

---

## 2. Regras como estão implementadas

### Uma rodada
1. **Escrita** — todos escrevem ao mesmo tempo, com o mesmo relógio.
2. Depois, **um texto por vez**, na ordem sorteada:
   - **Leitura (preview)** — o texto aparece por alguns segundos, só para ler.
   - **Palpite** — cada jogador tem de 1 a 3 palpites (configurável) *naquele* texto. Errou, o jogo diz
     **“não é X”** sem revelar a resposta e ele pode tentar de novo. Acertou, o avatar dele **acende em dourado**
     com “conseguiu! +N” para todos — sem mostrar o que ele chutou. A fase acaba quando todos acertam ou
     esgotam os palpites (ou quando o tempo acaba).
   - **Resposta** — revela a vanguarda daquele texto, o tema, o tipo, quem acertou (com os pontos) e quem errou.
   - **Denúncia** — só daquele texto: quem achar que fugiu do tema denuncia ali.
3. **Placar da rodada** — barras que crescem e pontos subindo, estilo Kahoot.
4. Repete até acabar as rodadas; depois vêm **pódio, destaques e antologia**.

O botão **Pronto** existe em todas as fases de jogador: quando todos marcam, a fase avança na hora.

### Pontuação
- Quem acerta ganha **pelo lugar em que acertou naquele texto**: **3** para o primeiro, **2** para o segundo,
  **1** para os demais (escala configurável em `hitPoints`).
- O **autor** ganha **+1** por cada pessoa que acertou a vanguarda dele.
- **Denúncia válida** (quórum, no máx. “jogadores − 1”): o autor perde `reportPenalty` (padrão 2), piso em 0.
- **Palavras-chave** (opcional): marcadas ao vivo enquanto se escreve; se `keywordPenalty` > 0, faltar alguma
  custa esses pontos. Padrão 0 = só informativo.

### Destaques de fim de partida
No máximo **3 badges por jogador**, os mais notáveis primeiro (campo `destaque` em `data/titulos.json`), e
nenhum se a pessoa não cumpriu condição alguma. Tocar ou passar o mouse mostra a explicação.

| Badge | Condição |
|---|---|
| 🃏 Mestre do Blefe | ninguém acertou a vanguarda dele |
| 🎯 Sniper | no máximo 1 erro na partida, com pelo menos 1 acerto |
| 🔥 Denunciado e Sobreviveu | denúncia válida e ainda assim ninguém acertou |
| 🚬 Inimigo da Sogra | acertou um texto escrito em Poesia Marginal |
| 🥀 Último Romântico | 3 vezes o Romantismo no lugar errado (chutou e errou, ou escreveu e confundiram) |
| 🎭 Fã do *X* | chutou a mesma vanguarda 3+ vezes |
| 🌀 Fora da Realidade | escreveu o texto mais denunciado |
| 🐌 Zero Chute | passou uma rodada sem palpitar |

### Configuração da sala (o host edita)
Vanguardas em jogo (com presets), mínimo de caracteres, palavras-chave por tema e penalidade, tipo de texto,
modificadores, filtro de palavrões, rodadas, palpites por texto (1–3), quórum e penalidade de denúncia,
facilitador (autocomplete / lista de nomes) e o tempo de **cada** fase. O host só inicia com pelo menos uma
vanguarda por jogador.

---

## 3. Conteúdo — tudo em JSON, sem tocar em código

```
data/vanguardas.json    21 vanguardas: resumo, explicação em texto corrido, "como escrever" e exemplo
data/temas.json         120 temas com tom e 3 palavras-chave cada
data/modificadores.json 16 intenções que o texto precisa carregar
data/tiposTexto.json    poema, carta, conto, diário, manifesto, discurso, bilhete
data/titulos.json       conquistas: emoji, nome, explicação e destaque
```

Acrescentar um tema é acrescentar uma entrada no JSON. `src/data/content.js` carrega esses arquivos (por HTTP
no navegador, do disco no Node) e entrega o conteúdo pronto ao motor.

**As 21 explicações** seguem o mesmo formato: um parágrafo explicando a lógica interna do estilo, uma linha de
“como escrever” e um exemplo de 2 a 5 linhas. Todos os exemplos partem do **mesmo tema e modificador**
(*uma xícara de café esfriando na mesa* + *fale sobre a dor de uma perda*), para dar de comparar lado a lado
como o mesmo ponto de partida vira 19 textos diferentes. Um teste garante que nenhum exemplo se repete.

---

## 4. Estrutura de arquivos

```
index.html · 404.html · sw.js · manifest · icon.svg/png · og.png   página, erro, PWA, ícones e imagem de link
iniciar.bat · liberar-firewall.bat · serve.mjs                     hospedar em rede local
data/                                                              conteúdo do jogo (JSON)
fonts/            Cinzel, IM Fell English, Noto Sans Runic, Atkinson Hyperlegible, OpenDyslexic (OFL)
src/
  brand.js        nome, frase do anel, autoria, runas
  engine/         motor PURO: engine.js (fases/ações/pontos) · config.js · titles.js · view.js · text.js · rng.js
  net/            relay.js · ws-server.js · host.js · client.js · online.js (MQTT) · mqtt.js · cipher.js
  solo/           bots.js · solo.js
  data/content.js carrega os JSON
  ui/             app.js · game-views.js · net-mode.js · solo-mode.js · room-config.js
                  icons.js · fx.js · sound.js · qr.js · theme.css · effects.css
test/             95 testes + e2e/ (navegadores reais) + helpers/mini-broker.js
tools/            pack · analyze · shot · browser · verify-pages · broker-check
```

---

## 5. Arquitetura

O **motor** é um conjunto de funções puras sobre um estado serializável (sem rede, DOM nem relógio global): o
mesmo motor roda no solo, na rede local e online.

- **GameHost** (autoridade): só ele aplica ações e manda **a cada jogador a sua visão**. A vanguarda de um texto
  só entra na visão a partir da **resposta daquele texto**; os acertos (`hits`) são públicos desde o palpite,
  porque é o que acende os avatares.
- **GameClient**: protocolo, relógio sincronizado por ping/pong, vira host se for promovido.
- **Relay**: salas, roteamento, token por jogador, limites, promoção de host, estado em disco.
  O host tem orçamento de mensagens proporcional ao número de jogadores (cada mudança vira uma mensagem por pessoa).

### Dois transportes, mesma lógica
| | Rede local (`iniciar.bat`) | Online (GitHub Pages) |
|---|---|---|
| Ponte | `serve.mjs` (Node) com o `Relay` | broker **MQTT público** (EMQX, Mosquitto, HiveMQ) por WSS |
| Host | navegador de quem cria a sala | idem — e o `Relay` roda dentro dele |
| Internet | não precisa | precisa |
| Código da sala | 4 letras | 6 letras |
| Canal | rede local | **AES-GCM**, chave derivada do código (PBKDF2); o broker só vê bytes |
| Host cai | o relay promove o próximo com o último snapshot | eleição: o próximo assume com o snapshot e ajusta o relógio |
| Servidor cai | salas voltam do disco (`.state/rooms.json`) | (não há servidor nosso) |

O modo é escolhido sozinho (em `https` é online; com `serve.mjs` é local) e dá para forçar em “Opções de conexão”.

### Segurança
Token secreto por jogador · limites de taxa, sala e servidor · mensagem WebSocket até 4 MB · conexão muda
derrubada em 45 s · servidor com lista de arquivos permitidos, ETag e gzip · **Content-Security-Policy** na
página (testada em navegador real) · configuração normalizada no host · todo texto de jogador passa por `esc()`.

---

## 6. Interface

Pergaminho escuro e dourado, fontes locais, nome do autor em runas, logotipo = **círculo com uma pena**
(o mesmo ícone do app/PWA), anel do menu com *“Raspe · Reescreva · Adivinhe”*.

- **Escrita:** o nome da vanguarda vem com um resumo curto logo abaixo; **tema, modificador e tipo de texto têm
  o mesmo peso visual** (mesma etiqueta, mesmo destaque); palavras-chave acendem quando usadas; quebra de linha
  automática aqui e na exibição.
- **Palpite:** fila de avatares mostrando quem já acertou, mensagem de erro sem entregar a resposta, autocomplete.
- **Fim:** pódio, 3 badges por jogador com explicação, antologia com todos os textos (copiar/baixar).
- **Efeitos:** anel de tempo, texto surgindo linha a linha, splash de fase, contagem 3-2-1, vinheta no fim do
  tempo, confete, barras e pontos subindo, holofote no vencedor, marca-d’água girando.
- **Sons:** cliques, fases, pena ao digitar, contagem, acerto/erro, fanfarra e **3 faixas de música ambiente**
  (Pergaminho, Tinta, Festa), com volume, escolha de faixa e vibração no painel.
- **Leitura:** tamanho do texto ajustável e **3 fontes** — a do jogo, uma “mais legível” (Atkinson Hyperlegible)
  e uma **para dislexia** (OpenDyslexic, só baixa se escolhida).
- **Celular:** botão Pronto colado embaixo, toques ≥ 44 px, áreas seguras, tela acesa, vibração, sem rolagem
  lateral a 390 px.
- **Acessibilidade:** foco visível, `aria-live`, movimento reduzido respeitado, contraste AA verificado por teste.

---

## 7. Testes

`npm test` — **95 testes**: motor e fluxo por texto, sigilo por fase, pontuação por ordem, palavras-chave,
filtro de palavrões, espectadores, títulos e badges, conteúdo (formato das 21 explicações), relay, persistência,
MQTT, cifra, modo online completo com migração de host, servidor, áudio, contraste e interface em jsdom.

`npm run test:e2e` — **6 testes em navegador real**: menu no celular (sem erros de CSP, sem rolagem lateral,
fontes locais), desktop, partida solo até o pódio, **duas máquinas** em rede local, **duas máquinas** online, e um
teste em **Firefox** (motor diferente). `npm run verify:pages` repete a partida online contra o site publicado.

---

## 8. Checklist de publicação

| Item | Estado |
|---|---|
| Favicon e ícones (SVG + PNG 192/512 + apple-touch) | ✓ círculo com pena |
| `manifest.webmanifest` completo (nome, ícones, cores, `start_url`, `scope`, `id`, screenshots) | ✓ |
| Open Graph + Twitter card com imagem 1200×630 (`og.png`) | ✓ |
| Service worker com cache do essencial (inclui os JSON) | ✓ `palimpsesto-v4` |
| `404.html` com a identidade do site | ✓ |
| `README.md` | ✓ |
| `LICENSE` | ✓ MIT (código) + CC BY-NC-SA 4.0 (conteúdo) |
| `lang="pt-br"`, `<title>`, `description`, `canonical` | ✓ |
| Nada sensível no código | ✓ (sem chaves nem segredos; o token de jogador é sorteado no navegador) |
| Testado em outro navegador | ✓ Firefox (Gecko), além de Edge/Chromium |
| Testado em tela pequena | ✓ 390×844 com toque emulado — **ainda não num aparelho físico** |

---

## 9. Métricas (regenere com `npm run analyze`)

- **50 arquivos próprios, ~6.050 linhas** (testes 1.830 · interface 1.650 · rede 1.190 · motor 600 · ferramentas 410).
- Sem ciclos de importação, sem módulos órfãos, motor puro, sem `TODO`.
- **Cobertura:** ~83% de linhas (motor e rede acima de 90%; menos cobertos: `net-mode.js` 79%, `fx.js` 82%).
- **Carga:** ~800 KB no total, mas a fonte de dislexia (230 KB) só baixa se escolhida; ~240 KB com gzip.
- **Desempenho:** ~0,27 ms por ação; partida de 8 jogadores × 3 rodadas simula em ~340 ms; visão de ~3,5 KB.

---

## 10. O que ainda falta e riscos

### Pendências
1. **Aparelho físico** (Android e iPhone). O teste automático usa 390×844 com toque emulado em dois motores de
   navegador; faltam teclado do iOS, política de áudio do Safari, vibração real, câmera lendo o QR e bateria.
2. **Revisar o conteúdo:** as vanguardas que escolhi (Classicismo, Literatura de Cordel, Romance de 30), as 21 explicações e exemplos (escritos
   por mim) e os 120 temas.
3. **Balancear jogando:** a escala 3/2/1 favorece quem responde rápido — pode precisar de ajuste com gente real.

### Não implementado (decisão consciente)
- Internacionalização (só português), minificação dos JS, retomar a sala em outro aparelho, auditoria completa
  com leitor de tela, HTTPS na rede local.

### Riscos
- **Brokers públicos** do modo online não têm garantia de funcionamento; o jogo tenta três em ordem e dá para
  apontar um próprio em `localStorage['palimpsesto.brokers']`.
- **Chave = código de 6 letras:** protege contra curiosos, não contra quem capture o tráfego e ataque offline.
- **O host (e o sucessor) veem os segredos** da partida — inerente ao modelo “host no navegador”.
- **Queda súbita do host:** o sucessor restaura um snapshot com até ~150 ms de atraso.

---

## 11. Decisões tomadas

- Um texto por vez (ler → palpitar → resposta → denunciar), com feedback imediato de erro sem entregar a resposta.
- Pontos por ordem de acerto (3/2/1) e +1 ao autor por acerto recebido.
- Conteúdo em JSON; código e conteúdo com licenças diferentes.
- JavaScript puro (módulos ES, sem build); WebSocket e MQTT escritos à mão.
- Interface sem emojis por padrão (`BRAND.emoji`), com ícones SVG.
- Online sem servidor via MQTT público cifrado, reaproveitando `Relay` + `GameHost` + `GameClient` no navegador.
- Testes em dois motores de navegador; dois “aparelhos” exigem dois navegadores (aba em segundo plano não recebe cliques).
