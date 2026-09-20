# Palimpsesto

**O jogo das vanguardas literárias** — escreva no estilo, descubra a escola.

Cada jogador recebe em segredo uma vanguarda literária (Barroco, Surrealismo, Concretismo, Tropicalismo…), um tema e às
vezes um modificador. Todos escrevem ao mesmo tempo; depois os textos são revelados e cada um tenta adivinhar a vanguarda
dos outros. Multiplayer, feito para jogar com amigos **pelo celular**.

> Palimpsesto: manuscrito cujo texto foi raspado e reescrito por cima, guardando os rastros do que havia antes.

Criação: **Francisco Audir** — [@filho.af](https://instagram.com/filho.af)

## Jogar

### ▶ Online, sem instalar nada — https://francisco12-cpu.github.io/palimpsesto/

Abra o link, digite seu nome, **Criar sala** e mostre o **QR code**; os amigos escaneiam com a câmera do celular e entram.
Precisa de internet (as mensagens passam por um broker público, **criptografadas** com uma chave derivada do código da sala).

### Sem internet (mesmo Wi-Fi)

Baixe o projeto e dê dois cliques em `iniciar.bat` (ou `npm run serve`); crie a sala e mostre o QR code. Se alguém não conseguir
entrar, rode `liberar-firewall.bat` uma vez. `npm run pack` gera uma pasta com o Node dentro para levar num pendrive.

## Para desenvolver

```bash
npm install         # só dependências de desenvolvimento (jsdom, puppeteer-core)
npm test            # 84 testes rápidos
npm run test:e2e    # testes em navegador real (Edge/Chrome), com dois "aparelhos"
npm run verify:pages  # joga uma partida online completa no site publicado
npm run analyze     # analisador: tamanho, dependências, segurança, cobertura, desempenho
```

Publicar: `git push` — o GitHub Pages republica sozinho em ~20 s. O jogo em si não tem dependências de execução.

## Documentação

Tudo sobre o estado atual — regras, arquitetura (rede local × online), segurança, métricas, riscos e próximos passos — está em
[`PROJETO.md`](PROJETO.md).

## Licenças de terceiros

Fontes Cinzel, IM Fell English e Noto Sans Runic (SIL OFL, ver `fonts/`) e a biblioteca de QR code
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, em `src/vendor/`).
