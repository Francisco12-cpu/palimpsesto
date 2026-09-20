# Palimpsesto — estado do projeto

> Jogo multiplayer de escrita: cada jogador recebe uma **vanguarda literária** secreta, escreve um texto no
> estilo dela e os outros tentam adivinhar qual foi.
> Criação: **Francisco Audir** — @filho.af

**Jogue agora:** https://francisco12-cpu.github.io/palimpsesto/ (nada para instalar; funciona no celular)
**Código:** https://github.com/Francisco12-cpu/palimpsesto

Este documento descreve o projeto **como ele está hoje** (a especificação original foi substituída por ele).
Os números da seção 9 vêm do analisador (`npm run analyze`) e podem ser regenerados a qualquer momento.

**Status:** motor, conteúdo, rede local, **modo online sem servidor (GitHub Pages)**, visual, sons, celular e
empacotamento estão implementados e **verificados em navegador real** (Edge) com dois "aparelhos" jogando uma
partida completa — inclusive **no site publicado, pelos brokers públicos de verdade**. Restam pendências que só uma
pessoa pode fechar (celulares físicos, revisão de conteúdo, balanceamento) — ver seção 10.

---

## 1. Como usar

| Quero… | Como |
|---|---|
| **Jogar com amigos (mais fácil)** | abrir o link do Pages, “Criar sala”, mostrar o **QR code**; os amigos escaneiam. Precisa de internet |
| **Jogar sem internet (mesmo Wi-Fi)** | no PC do host, `iniciar.bat` → “Criar sala” → QR code. Se alguém não entrar: `liberar-firewall.bat` (uma vez) |
| Rodar sem `.bat` | `npm run serve` |
| Levar num pendrive (com Node dentro) | `npm run pack` → `dist/Palimpsesto/` e `.zip` (~33 MB) |
| Testar (rápido, ~15 s) | `npm test` (84 testes) |
| Testar em navegador real | `npm run test:e2e` (Edge/Chrome; grava screenshots com `SHOTS=pasta`) |
| Verificar o site publicado | `npm run verify:pages` (dois navegadores jogam uma partida online no Pages) |
| Analisar o projeto | `npm run analyze` (`-- --out=arquivo.md` grava; `-- --no-tests` é mais rápido) |
| Ver uma tela | `npm run shot -- <url> saida.png [celular\|desktop]` |
| **Publicar mudanças** | `git add -A && git commit -m "..." && git push` — o Pages republica sozinho em ~20 s |

Requisitos: **Node 22+** só para quem hospeda em rede local e para desenvolver. Jogadores só precisam de navegador.
`npm install` instala apenas dependências **de desenvolvimento** (`jsdom`, `puppeteer-core`, para os testes); o jogo não tem
dependências de execução.

---

## 2. Regras como estão implementadas

### Fases de uma rodada
`escrevendo → (revelando → palpitando) × cada texto → denunciando → pontuando`, por `rodadas`; depois, **fim de jogo**.

- Cada jogador recebe **uma vanguarda própria**, um **tema**, um **tipo de texto** e, opcionalmente, um **modificador** e
  **palavras-chave**.
- **Botão Pronto** em todas as fases de jogador: se **todos os conectados** marcarem, a fase avança na hora. Na escrita, Pronto
  **trava** o texto. Quem cai da conexão não segura a fase.
- O texto é capturado como está quando o tempo acaba (com **400 ms de tolerância** para o último trecho digitado chegar) ou
  quando todos marcam Pronto. O resultado dos palpites fica **oculto** até a pontuação.
- **Espectadores:** quem chega com a partida em andamento assiste (sem ver vanguardas nem agir) e joga na próxima.

### Pontuação
- **+1** para cada jogador que acerta a vanguarda de um texto (no máx. 1 acerto por texto, mesmo com vários palpites).
- **+1** para o autor por cada pessoa que acertou. Sem bônus de velocidade.
- **Denúncia válida** (quórum, no máx. “jogadores − 1”): o autor perde `reportPenalty` pontos (padrão 2), com **piso em 0**, e ainda
  recebe os pontos dos acertos.
- **Palavras-chave** (opcional): as já usadas ficam marcadas ao vivo na escrita e o resultado mostra “2/3 — faltou: …”. Com
  `keywordPenalty` > 0, faltar alguma custa esses pontos (piso em 0). Padrão 0 = só informativo.

### Títulos de fim de jogo (só aparecem se a condição for cumprida)
Fã do *X* (mesma vanguarda chutada N vezes, padrão 3) · Fora da Realidade (texto mais denunciado) · Sniper (≤1 erro e ≥1 acerto) ·
Mestre do Blefe (todos os outros chutaram e ninguém acertou) · Zero Chute (rodada sem palpite) · Denunciado e Sobreviveu.

### Configuração da sala (o host edita)
Vanguardas em jogo (com presets), mínimo de **caracteres** (0–3000), palavras-chave por tema (0–5) e penalidade, tipo de texto
fixo ou sorteado, modificadores, **filtro de palavrões** (troca por asteriscos), rodadas, palpites por texto, quórum e penalidade de
denúncia, facilitador (autocomplete e/ou lista de nomes), tempo de cada fase. O host só inicia se houver **pelo menos uma
vanguarda por jogador**.

### Diferenças em relação à spec original
- **Mínimo de caracteres** em vez de linhas (pedido do autor); é **informativo** (contador e barra), o jogo não bloqueia.
- **19 vanguardas:** a spec listava 18; a 19ª é o **Classicismo** (escolha minha; trocar é editar uma entrada em
  `src/data/vanguards.js`).
- **Rede:** em vez de um servidor WebSocket rodado pelo host (impossível num navegador), há **dois transportes** com o mesmo
  protocolo (seção 4).

---

## 3. Estrutura de arquivos

```
index.html · sw.js · manifest · ícones   página (com CSP), service worker (PWA offline em https/localhost), ícones PNG/SVG
iniciar.bat · liberar-firewall.bat       atalhos Windows       serve.mjs  servidor local (arquivos + relay WS + /api/info)
fonts/                                   Cinzel, IM Fell English, Noto Sans Runic (OFL, locais)
src/
  brand.js                               nome, frase do anel, autoria, runas, chave de emojis
  engine/  motor PURO   engine.js (fases/ações/pontos) · config.js · titles.js · view.js (visão por jogador)
                        text.js (palavras-chave, filtro) · rng.js
  net/     relay.js (salas, roteamento, relógio, token, limites, persistência)   ws-server.js (WebSocket sem dependências)
           host.js (GameHost: autoridade, snapshot, espectadores, expulsar)      client.js (GameClient)
           online.js (OnlineSession: modo sem servidor)   mqtt.js (cliente MQTT)   cipher.js (AES-GCM)
  solo/    bots.js · solo.js              modo solo com bots
  data/    vanguards.js · themes.js · content.js
  ui/      app.js (menu, como jogar, áudio/leitura) · game-views.js (fases) · net-mode.js · solo-mode.js · room-config.js
           icons.js · fx.js · sound.js · qr.js · theme.css · effects.css
  vendor/qrcode.mjs                      gerador de QR (MIT)
test/  84 testes rápidos + e2e/ (navegador real) + helpers/mini-broker.js (broker MQTT de teste)
tools/ pack · analyze · shot · verify-pages · broker-check · browser (ajudante de navegador real)
```

---

## 4. Arquitetura

O **motor** é um conjunto de funções puras sobre um estado 100% serializável (sem rede, DOM nem relógio global): o mesmo
motor roda no solo, na rede local e online. Em cima dele:

- **GameHost** (autoridade): só o host aplica ações, valida tudo e manda **a cada jogador a sua visão** (vanguardas, rascunhos
  e palpites alheios não saem do host). Guarda um **snapshot** (sem o banco de temas, ~8 KB) para migração.
- **GameClient**: fala o protocolo (`create|join|ping|act` ↔ `joined|msg|from|peer-*|promote|pong|error`), sincroniza o relógio
  por ping/pong e vira host se for promovido. O timer é por **timestamp absoluto** do relógio do host/relay.
- **Relay**: salas, roteamento, token por jogador, limites de taxa/sala/servidor, promoção de host, exportar/importar estado.

### Dois transportes, mesma lógica
| | Rede local (`iniciar.bat`) | Online (GitHub Pages) |
|---|---|---|
| Ponte | `serve.mjs` (Node) com o `Relay` | broker **MQTT público** (EMQX, Mosquitto, HiveMQ) por WSS |
| Host | navegador de quem cria a sala | idem — e **o `Relay` roda dentro dele** |
| Precisa de internet | não | sim |
| Código da sala | 4 letras | **6 letras** |
| Segurança do canal | rede local | **AES-GCM**, chave derivada do código (PBKDF2); o broker só vê bytes |
| Se o host cair | o relay promove o próximo com o último snapshot (tolerância de 4 s) | **eleição**: o próximo da lista assume, restaura o snapshot que o host antigo lhe mandava e ajusta o relógio; os outros reentram sozinhos |
| Se o servidor cair | salas voltam do disco (`data/rooms.json`) | (não há servidor nosso) |

O modo é escolhido sozinho: se a página vem de um `serve.mjs` (`/api/info` responde) usa a rede local; em `https` (Pages) usa
online. Dá para forçar em “Opções de conexão”. Brokers próprios: `localStorage['palimpsesto.brokers'] = ["wss://…"]`.

### Segurança (implementada)
- **Token secreto por jogador** (o `id` é público nas visões): ninguém toma o lugar de outro. Limites: 80 msg/s por conexão,
  16 jogadores/sala, 100 salas, 4 MB por mensagem, derrubada de conexão muda (45 s).
- Servidor estático com **lista de arquivos permitidos**; ETag + gzip; **Content-Security-Policy** na página (só scripts do próprio
  site; testada em navegador real); configuração da sala **normalizada** no host; todo texto de jogador passa por `esc()`.
- Online: mensagens cifradas de ponta a ponta entre jogadores; o tópico usa hash do código (o código não aparece no broker).

---

## 5. Conteúdo
**19 vanguardas** (com explicação só do estilo, sem trechos protegidos), **120 temas** (22–26 por tom, 3 palavras-chave cada,
tom sorteado primeiro para misturar) e **16 modificadores**. Para expandir: `src/data/themes.js` e `content.js`.

---

## 6. Interface
Pergaminho escuro e dourado (do menu de exemplo do autor), fontes locais, nome do autor em runas, logo com anel dizendo
*“Raspe · Reescreva · Adivinhe”*. Telas: menu (nome, cor, criar/entrar/solo, como jogar, sobre, créditos), sala de espera (código,
**QR**, link, jogadores, expulsar, configuração), escrita, revelação, palpite, denúncias, pontuação, **pódio + títulos +
antologia** (copiar/baixar).
- **Efeitos:** anel de tempo, texto revelado linha a linha, splash de fase, contagem 3-2-1, vinheta no fim do tempo, confete,
  contagem de pontos, holofote no vencedor, marca-d'água giratória.
- **Sons** (sintetizados): cliques, fases, pena ao digitar, contagem, acerto/erro, fanfarra e **música ambiente**; painel de
  volume/música/vibração e **tamanho do texto**.
- **Celular:** botão Pronto colado embaixo, toques ≥ 44 px, áreas seguras, tela acesa, vibração, sem rolagem lateral (testado a
  390 px), teclado que não cobre a barra.
- **Acessibilidade:** foco visível, `aria-live`, movimento reduzido respeitado, **contraste AA verificado por teste**.

---

## 7. Testes e qualidade
`npm test` — **84 testes** (motor, palavras-chave, filtro, Pronto, espectadores, sigilo, relay, persistência, MQTT, cifra, modo
online completo com migração de host, servidor, áudio com AudioContext falso, contraste, interface em jsdom).
`npm run test:e2e` — **5 testes em Edge real** (menu no celular sem erros de CSP e sem rolagem lateral, fontes locais, partida solo,
**duas páginas** jogando em rede local e **online**). `npm run verify:pages` repete isso contra o site publicado.

---

## 8. Achados da análise já corrigidos
Tomada de lugar por `id` (agora token) · configuração bruta do host exibida sem escape · relay sem limites · migração instantânea
por piscar de Wi-Fi · carga sem cache · rascunho tardio gerando erro · **promoção do relay embutido interferindo na eleição
online** · **snapshot final não enviado na saída voluntária do host** · contraste baixo em textos pequenos · aviso duplicado ao trocar
de porta · 404 no console do Pages (procura de servidor local em https).

---

## 9. Métricas (regenere com `npm run analyze`)
- **51 arquivos próprios, ~5.800 linhas** (testes 1.640 · interface 1.530 · rede 1.190 · motor 520 · ferramentas 390 · conteúdo 230 ·
  solo 140); sem ciclos de importação, sem módulos órfãos, motor puro, sem `TODO`.
- **Cobertura:** ~83% de linhas (motor/rede/host acima de 90%; menos cobertos: `net-mode.js` 79%, `fx.js` 87%).
- **Carga:** ~533 KB (240 KB JS, 28 KB CSS, 179 KB fontes, 84 KB ícones), ~160 KB com gzip estimado.
- **Desempenho:** ~0,27 ms por ação; partida de 8 jogadores × 3 rodadas simula em ~210 ms; visão de ~3,5 KB por jogador.
- **No site real:** criar sala + convidado entrar + partida completa em ~27 s (com Pronto automático).

---

## 10. O que ainda falta (só uma pessoa pode fechar) e riscos

### Pendências
1. **Celulares físicos** (Android e iPhone). O navegador real testado é o Edge em modo celular (390 px, toque); o que ainda
   pode diferir: teclado virtual do iOS, política de áudio do Safari, vibração, câmera lendo o QR, economia de bateria.
2. **Revisar o conteúdo:** a 19ª vanguarda, as explicações (escritas por mim) e os 120 temas.
3. **Balanceamento com pessoas:** quórum (2), penalidades, limiar do “Fã” (3), tempos das fases.

### Não implementado (decisão consciente)
- **Internacionalização:** textos em português espalhados pelo código; migrar para dicionário compensa só se houver outro idioma.
- **Minificar/empacotar os JS:** ~35 arquivos, ~160 KB gzip; irrelevante com HTTP/2 e cache.
- **Retomar a sala em outro aparelho** (hoje a identidade é por aba/navegador) e **auditoria completa com leitor de tela**.
- **HTTPS na rede local:** o modo online no Pages já dá PWA/offline em HTTPS; na LAN pura o service worker é ignorado (limite do navegador).

### Riscos e pontos importantes
- **O modo online depende de brokers públicos gratuitos** (EMQX, Mosquitto, HiveMQ): sem SLA, podem limitar ou cair. O jogo tenta
  os três em ordem. Para independência total: hospedar um broker próprio (Mosquitto) e apontar em `palimpsesto.brokers`.
- **Chave = código de 6 letras:** protege contra curiosos, não contra quem capturar o tráfego e quebrar offline (191 milhões de
  combinações × PBKDF2). Aceitável para um jogo; não para segredos.
- **O host vê todos os segredos** da partida (inerente ao modelo “host no navegador”); o **sucessor** também recebe o estado.
  Entre amigos é aceitável; não impede trapaça deliberada.
- **Sem autenticação forte:** o token impede tomada de lugar, mas quem tem o código entra.
- **Queda súbita do host:** o sucessor restaura um snapshot com até ~150 ms + latência de atraso (na saída voluntária o snapshot é final).
- **Tema/nome:** `BRAND` em `src/brand.js`; `index.html`, `manifest` e `LEIA-ME` têm textos fixos.

---

## 11. Decisões tomadas (histórico resumido)
- Cada jogador recebe **uma vanguarda diferente**; denúncia válida tira 2 pontos (piso 0); acerto vale 1 por texto.
- JavaScript puro (módulos ES, **sem build**), WebSocket e MQTT **sem bibliotecas**, motor testável em Node.
- Nome **Palimpsesto**. Interface **sem emojis** por padrão (`BRAND.emoji`).
- “Pronto” em todas as fases de jogador.
- **Online sem servidor** via MQTT público cifrado, reaproveitando `Relay` + `GameHost` + `GameClient` no navegador do host.
- Fontes e QR embutidos para funcionar **sem internet** (no modo local).
- Testes em **navegador real** com **dois navegadores** (numa mesma janela a aba em segundo plano não recebe cliques).
