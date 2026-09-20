# Palimpsesto — estado do projeto

> Jogo multiplayer de escrita em rede local: cada jogador recebe uma **vanguarda literária** secreta,
> escreve um texto no estilo dela e os outros tentam adivinhar qual foi.
> Criação: **Francisco Audir** — @filho.af

Este documento **substitui a especificação original** (`jogo-vanguardas-spec.md`, removida). Ele descreve
o projeto **como ele está hoje**, e não como foi planejado. Onde a implementação difere da spec, está indicado.
Os números da seção 9 vêm do analisador (`npm run analyze`) e podem ser regenerados a qualquer momento.

**Status:** as 4 fases planejadas estão implementadas (motor, conteúdo e configuração, rede, visual), mais o
acabamento da Fase 4b (celular, sons, efeitos, empacotamento). Tudo foi testado por **60 testes automatizados**
e por simulação de interface em DOM falso (jsdom). **Ainda não foi validado em navegador e celular reais**
(ver seção 10, item 1).

---

## 1. Como usar

| Quero… | Comando / arquivo |
|---|---|
| Jogar/hospedar (Windows) | duplo clique em `iniciar.bat` (abre o navegador e mostra o endereço para os amigos) |
| Liberar os amigos no Firewall | `liberar-firewall.bat` (uma vez; pede administrador) |
| Rodar sem `.bat` | `npm run serve` (ou `node serve.mjs --open`) |
| Rodar os testes | `npm test` |
| Gerar pacote para pendrive (com Node dentro) | `npm run pack` → `dist/Palimpsesto/` e `.zip` (~33 MB) |
| Analisar o projeto | `npm run analyze` (`-- --out=arquivo.md` grava; `-- --no-tests` é mais rápido) |

Requisitos: **Node 22+** (desenvolvido em 24) só para quem hospeda e desenvolve. Jogadores só precisam de um navegador.
`npm install` instala apenas o `jsdom` (dependência **de desenvolvimento**, usada nos testes de interface; sem ele
esses testes são pulados). O jogo em si **não tem dependências de execução**.

**Como uma partida em rede acontece:** uma pessoa abre `iniciar.bat` → “Criar sala” → mostra o **QR code** → os amigos
escaneiam (ou abrem o link / digitam o código de 4 letras) → o host escolhe as regras → “Começar partida”.
Não precisa de internet, só de todos na mesma rede Wi-Fi.

---

## 2. Regras como estão implementadas

### Fases de uma rodada
`escrevendo → (revelando → palpitando) × cada texto → denunciando → pontuando`, repetindo por `rodadas`, depois **fim de jogo**.

- Cada jogador recebe **uma vanguarda própria** (distintas enquanto houver vanguardas suficientes), um **tema**, um
  **tipo de texto** e, opcionalmente, um **modificador** e **palavras-chave**.
- **Botão Pronto** (em todas as fases de jogador): se **todos os conectados** marcarem, a fase avança na hora. Na escrita,
  Pronto **trava** o texto. Quem cai da conexão não segura a fase.
- O texto é capturado **como está** quando o tempo acaba (ou quando todos marcam Pronto).
- O resultado dos palpites fica **oculto** até a pontuação.

### Pontuação
- **+1** para cada jogador que acerta a vanguarda de um texto (no máximo 1 acerto por texto, mesmo com vários palpites).
- **+1** para o autor por cada pessoa que acertou.
- **Denúncia válida** (quórum de denunciantes, no máximo “jogadores − 1”): o autor **perde `reportPenalty` pontos** (padrão 2),
  com **piso em 0**. O autor denunciado ainda recebe os pontos dos acertos da rodada.
- Sem bônus de velocidade.

### Títulos de fim de jogo (só aparecem se a condição for cumprida)
| Título | Regra implementada |
|---|---|
| Fã do *X* | chutou a mesma vanguarda `fanThreshold` vezes (padrão 3); o título leva o nome da vanguarda |
| Fora da Realidade | autor(es) do texto com **mais denúncias** (mínimo 1) — não há voto “mais estranho” |
| Sniper | 1 erro ou menos na partida, **com pelo menos 1 acerto** |
| Mestre do Blefe | em algum texto, todos os outros (mínimo 2) chutaram e **ninguém acertou** |
| Zero Chute | passou uma rodada inteira sem usar nenhum palpite |
| Denunciado e Sobreviveu | teve denúncia válida e mesmo assim ninguém acertou a vanguarda |

### Configuração da sala (tudo editável pelo host)
Vanguardas em jogo (com presets *Todas / Modo fácil / Só europeias / Só brasileiras*), mínimo de **caracteres**
(0–3000), palavras-chave por tema (0–5), tipo de texto fixo ou sorteado, tipos permitidos, modificadores liga/desliga,
rodadas, palpites por texto, quórum e penalidade de denúncia, facilitador (autocomplete e/ou lista completa de nomes),
tempo de cada fase.

### Diferenças em relação à spec original
- **Mínimo de caracteres** em vez de mínimo de linhas (pedido do autor). O mínimo é **informativo** (contador e barra):
  o jogo **não bloqueia** nem pune quem fica abaixo dele; o mesmo vale para as **palavras-chave** (exibidas, não verificadas).
- **19 vanguardas:** a spec dizia 19 mas listava 18. A 19ª é o **Classicismo** (escolha minha; para trocar, editar uma
  entrada em `src/data/vanguards.js`).
- **Rede:** a spec previa um servidor WebSocket local que o host executa. Como navegadores não abrem servidores, a
  arquitetura ficou em **duas peças**: um **relay** leve em Node (`serve.mjs`) e o **host** (autoridade do jogo) rodando no
  navegador do jogador que criou a sala — o que permite **migração de host** (ver seção 4).
- **PWA offline** só funciona em `localhost`/HTTPS (limite do navegador); em `http://IP-da-rede` o service worker é ignorado.

---

## 3. Estrutura de arquivos

```
iniciar.bat · liberar-firewall.bat      atalhos para Windows
serve.mjs                               servidor: arquivos + relay WebSocket + /api/info (ETag, gzip)
index.html · sw.js · manifest · ícones  página, service worker (PWA), ícones PNG/SVG
fonts/                                  Cinzel, IM Fell English, Noto Sans Runic (licença OFL, locais)
src/
  brand.js                              nome, frase do anel, autoria, runas, chave de emojis
  engine/   motor PURO (sem DOM/rede/tempo global)
    engine.js  fases, ações, pontuação        config.js  padrões e normalização da sala
    titles.js  títulos                        view.js    visão filtrada por jogador (sigilo)
    rng.js     sorteio determinístico (semente serializável)
  net/      rede
    relay.js   salas, roteamento, relógio, migração, token, limites   ws-server.js  WebSocket (RFC 6455) sem dependências
    host.js    GameHost: autoridade do jogo, snapshot, expulsar        client.js     GameClient: conexão, relógio, vira host
  solo/     bots.js, solo.js        modo solo (mesmo motor, bots com texto pronto)
  data/     vanguards.js, themes.js, content.js     conteúdo
  ui/       app.js (menu) · game-views.js (fases) · net-mode.js · solo-mode.js · room-config.js
            icons.js (SVG) · fx.js (efeitos) · sound.js (áudio) · qr.js · theme.css · effects.css
  vendor/qrcode.mjs                     gerador de QR (qrcode-generator, MIT)
test/                                   60 testes (motor, rede, servidor, interface)
tools/                                  pack.mjs (empacotar) · analyze.mjs (analisador)
PROJETO.md                              este documento
```

---

## 4. Arquitetura

```
 navegador A (HOST) ──┐                                   ┌── navegador B (jogador)
   GameHost + motor   ├── WebSocket ── serve.mjs (Relay) ─┤
   (autoridade)       │       /ws      salas · relógio    └── navegador C (jogador)
```

**Separação de responsabilidades (regra central da spec, cumprida):** o **motor** é um conjunto de funções puras sobre um
estado 100% serializável em JSON; não conhece rede, DOM nem relógio (o tempo entra como argumento). O mesmo motor roda no
modo solo com bots e na partida real. O analisador verifica essa regra automaticamente.

- **Autoridade no host:** só o host aplica ações (`draft`, `guess`, `report`, `done`, `config`, `start`, `kick`, `rematch`),
  valida tudo e envia a **cada jogador a sua visão** (`view.js`): vanguardas, rascunhos e palpites alheios **não saem** do host.
- **Timer sincronizado por timestamp:** o host grava `phaseEndsAt` no **relógio do relay**; cada cliente calcula o tempo restante
  a partir dele, corrigindo a diferença de relógio com ping/pong (estilo NTP). Nenhum countdown local independente.
- **Resiliência:** o host nunca espera confirmação de cliente. Cliente que cai é marcado desconectado e o jogo segue; ao voltar
  (mesmo aparelho/aba) retoma o lugar. **“Voltar para a sala”** no menu recupera uma sala após F5/fechar a aba.
- **Migração de host:** o host envia um **snapshot** do estado ao relay a cada mudança. Se o host cair e **não voltar em 4 s**,
  o próximo jogador (ordem de entrada) é promovido e continua a partir do snapshot.
- **Protocolo (JSON):** cliente→relay `create|join|ping|act`; host→relay `to|sync`; relay→cliente `joined|msg|from|peer-join|
  peer-leave|promote|pong|error`. Mensagens do host ao jogador: `view`, `error`, `kicked`.
- **Segurança (implementada):** token secreto por jogador (o `id` é público nas visões; sem o token ninguém toma o lugar de
  outro), limite de 80 msgs/s por conexão, 16 jogadores por sala, 100 salas, mensagem WebSocket até 4 MB, derrubada de conexão
  sem sinal (45 s), servidor estático com **lista de arquivos permitidos**, configuração da sala **normalizada** no host,
  todo texto de jogador passa por `esc()` antes de virar HTML.

---

## 5. Conteúdo

- **19 vanguardas** em 3 grupos (pré-modernos, europeias, brasileiras), cada uma com explicação curta **só do estilo**
  (sem trechos protegidos). Aparecem em “Sobre as vanguardas” e como “Lembrete do estilo” na tela de escrita.
- **120 temas** (22–26 por tom: leves, médios, pesados, antigos, modernos), cada um com 3 palavras-chave. O sorteio escolhe o
  **tom primeiro** para misturar os tons na mesma rodada e evita repetir tema na partida.
- **16 modificadores** (intenção que o texto precisa carregar).
- Para expandir: acrescentar itens em `src/data/themes.js` (função `t('tom', [...])`) e `content.js`; existe teste que garante
  unicidade dos temas.

---

## 6. Interface

- **Identidade:** pergaminho escuro e dourado (a partir do menu de exemplo do autor), tipografia clássica **embutida**
  (funciona sem internet), nome do autor em **runas**, logotipo com anel rúnico dizendo *“Raspe · Reescreva · Adivinhe”*.
- **Telas:** menu (nome, cor do avatar, criar/entrar/solo, como jogar, sobre, créditos), sala de espera (código, **QR code**,
  link para copiar/compartilhar, jogadores, expulsar, configuração), escrita, revelação, palpite (autocomplete próprio),
  denúncias, pontuação, **pódio + títulos + antologia** (copiar tudo / baixar `.txt`).
- **Efeitos visuais:** marca-d’água giratória, poeira dourada, anel de tempo, texto revelado linha a linha, splash de fase,
  contagem 3-2-1, vinheta vermelha no fim do tempo, ondulação nos botões, confete, contagem de pontos, holofote no vencedor.
- **Sons** (sintetizados, sem arquivos): cliques, início de fase, folhear página, contagem, acerto/erro, gongo, fanfarra,
  “alguém ficou pronto”, arranhar de pena ao digitar e **música ambiente** gerada por código. Painel com volume, música e vibração.
- **Celular:** botão “Pronto” colado embaixo (alcance do polegar), áreas de toque ≥ 44 px, teclado que não cobre a barra,
  respeito às áreas seguras (notch), tela mantida acesa durante a partida, vibração em acerto/fim de tempo, sem zoom
  involuntário em campos, orientação horizontal tratada.
- **Acessibilidade:** foco visível, `aria-live` para mudanças de fase/tempo, `prefers-reduced-motion` respeitado, cor nunca é a
  única pista (ícones junto). Chave `BRAND.emoji` (`false` por padrão) liga/desliga emojis na interface.

---

## 7. Testes e qualidade

`npm test` — **60 testes, todos passando**:
motor (fases, pontuação, denúncia, títulos, Pronto, sigilo, imutabilidade), solo (partidas completas com relógio falso,
determinismo), relay (salas, promoção, token, limites, tolerância), rede real (3 jogadores por WebSocket, migração de host,
retardatário), servidor (arquivos públicos x privados, ETag/gzip), e **interface** com jsdom (menu, partida solo completa até
o pódio e antologia, criação de sala com QR, convite por link).

O que os testes **não** cobrem: aparência real, fontes, sons, toque e desempenho em celular — só teste manual em aparelhos.

---

## 8. Achados da análise que já foram corrigidos

- **Tomada de lugar:** os `id`s dos jogadores aparecem nas visões; quem os conhecesse podia reconectar como outro jogador → agora
  exige **token secreto**.
- **Config sem normalizar:** o host repassava o objeto de configuração bruto e os clientes o exibiam sem escape (XSS de host
  malicioso) → agora o host **normaliza** e a UI escapa.
- **Sem limites:** conexões podiam inundar o relay → limites de taxa, sala e servidor.
- **Migração instantânea:** um piscar de Wi-Fi trocava o host → tolerância de 4 s.
- **Carga:** todo carregamento baixava ~490 KB sem cache → ETag (304) + gzip (~148 KB estimados) + cache em memória.
- **Rascunho tardio** gerava erro visível ao jogador → agora é ignorado em silêncio.
- **Aviso duplicado** do servidor ao trocar de porta.

---

## 9. Métricas (analisador — regenere com `npm run analyze`)

- **36 arquivos próprios, ~4.200 linhas** de código (interface 1.460 · testes 930 · rede 580 · motor 470 · conteúdo 230 ·
  solo 140), mais 1 biblioteca de terceiros (QR).
- **Sem ciclos de importação, sem módulos órfãos**, motor sem DOM/rede/tempo global, sem `eval`, sem `TODO`.
- **Cobertura de testes:** ~79% de linhas no total; **motor e rede acima de 90%** (engine 97%, client 96%, host 91%,
  ws-server 90%); interface e áudio menos (o áudio é difícil de testar sem navegador: `sound.js` ~50%).
- **Carga:** ~494 KB servidos (200 KB de JS, 28 KB de CSS, 179 KB de fontes, 84 KB de ícones), ~148 KB com gzip.
- **Estado:** 20,9 KB por snapshot (8 jogadores); **3,4 KB** por visão enviada a cada jogador.
- **Desempenho do motor:** ~0,25 ms por ação; uma partida inteira de 8 jogadores × 3 rodadas simula em ~170 ms de CPU.

---

## 10. O que ainda falta / próximos passos (priorizado)

### Alta prioridade
1. **Testar em aparelhos reais** (Android e iPhone, Wi-Fi de verdade): layout, teclado virtual, sons (política de áudio do
   iOS), vibração, tela acesa, QR pela câmera, energia. Toda a validação visual até aqui foi por simulação.
2. **Revisar o conteúdo com o autor:** a 19ª vanguarda, as explicações de cada vanguarda (escritas por mim) e os 120 temas.
3. **Balanceamento com pessoas reais:** quórum (2), penalidade (2), limiar do título “Fã” (3), tempos das fases. Pode exigir ajuste.
4. **Perda de disco do relay:** se o computador do servidor fechar, as salas somem (o estado só fica na memória). Persistir o
   snapshot em arquivo permitiria retomar após reinício.

### Média prioridade
5. **Aplicar as palavras-chave de verdade:** hoje só são mostradas. Destacar no contador quais já foram usadas e, se quiser,
   permitir denúncia automática/sugestão quando faltarem.
6. **Perda dos últimos ~200 ms de digitação** quando o tempo acaba (envio de rascunho limitado a 5/s): enviar um rascunho final
   ao faltar ~1 s ou dar 300 ms de tolerância de captura no host.
7. **Reduzir o snapshot:** `content` (13 KB) é 62% do snapshot e é igual em todos os clientes; dá para omiti-lo e reconstruir
   localmente. Também enviar diferenças em vez do estado inteiro a cada ação.
8. **Cabeçalho `Content-Security-Policy`** no servidor (bloqueia scripts externos). Não foi ativado porque **não pude
   testar num navegador real** e uma política errada quebraria o jogo silenciosamente.
9. **HTTPS local** (certificado da rede, ex.: mkcert) para o PWA abrir offline e instalar no celular também pela LAN.
10. **Entrada no meio da partida / espectador** (hoje quem chega depois é recusado) e **reconexão por aparelho diferente**.
11. **Cobertura:** testes para `sound.js` com Web Audio falso e para telas de erro/reconexão.

### Baixa prioridade
12. **Acessibilidade avançada:** auditoria de contraste, opção de fonte maior, navegação completa por teclado nas telas de denúncia.
13. **Internacionalização:** todo o texto está em português, espalhado pelo código; centralizar em um dicionário.
14. **Minificar/empacotar** os 30+ arquivos JS (irrelevante em LAN; útil se hospedar em servidor remoto).
15. **Limpar exports sem uso:** `isMuted`, `reducedMotion`, `hue`, `MODIFIERS` (o analisador lista).
16. **Vanguardas < jogadores:** nesse caso duas pessoas recebem a mesma vanguarda (o modo fácil de 7 vanguardas com 8+ jogadores).
17. **Moderação de texto** (filtro de palavrões) e **limite de tempo de inatividade** do host.

### Riscos e pontos importantes
- **O host vê todos os segredos** da partida (vanguardas dos outros). É inerente ao modelo “host no navegador”; em jogo entre
  amigos é aceitável, mas não protege contra um host que queira trapacear.
- **Sem autenticação forte:** o token impede tomada de lugar acidental/simples, mas quem tem acesso à rede e ao código da sala
  pode entrar. O código muda a cada sala.
- **O computador do servidor é ponto único de falha** da sala (ver item 4).
- **Chave de nome e frase:** trocar `BRAND.name`/`BRAND.phrase` em `src/brand.js` refaz nome, logotipo e créditos; atualize também
  `index.html`, `manifest.webmanifest`, `serve.mjs`/`LEIA-ME` (textos fixos).

---

## 11. Decisões tomadas (histórico resumido)

- Cada jogador recebe **uma vanguarda diferente** (senão o palpite seria trivial).
- Denúncia válida tira 2 pontos (configurável), com piso em 0; acerto vale 1 por texto mesmo com vários palpites.
- JavaScript puro (módulos ES, **sem etapa de build**), motor testável em Node, WebSocket próprio sem bibliotecas.
- Nome **Palimpsesto** (manuscrito raspado e reescrito por cima, guardando os rastros do que havia antes).
- Interface **sem emojis** por padrão (ícones SVG e iniciais); religáveis por `BRAND.emoji`.
- “Pronto” em todas as fases de jogador, com avanço imediato quando todos os conectados confirmam.
- Fontes e QR embutidos para funcionar **sem internet**.
