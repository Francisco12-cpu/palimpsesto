# Palimpsesto

**O jogo das vanguardas literárias** — escreva no estilo, descubra a escola.

Cada jogador recebe em segredo uma vanguarda literária (Barroco, Surrealismo, Concretismo, Tropicalismo…), um tema e às
vezes um modificador. Todos escrevem ao mesmo tempo; depois os textos são revelados e cada um tenta adivinhar a vanguarda
dos outros. Jogo multiplayer em **rede local**, sem internet, feito para jogar com amigos pelo celular.

> Palimpsesto: manuscrito cujo texto foi raspado e reescrito por cima, guardando os rastros do que havia antes.

Criação: **Francisco Audir** — [@filho.af](https://instagram.com/filho.af)

## Como jogar

**Windows (mais fácil):** baixe o projeto, dê dois cliques em `iniciar.bat`, clique em **Criar sala** e mostre o **QR code**
para os amigos escanearem (mesma rede Wi-Fi). Se alguém não conseguir entrar, rode `liberar-firewall.bat` uma vez.

**Pelo terminal** (precisa de Node 22+):

```bash
npm run serve      # sobe o servidor e abre o navegador
npm test           # 60 testes
npm run pack       # gera dist/Palimpsesto (com o Node dentro) para levar num pendrive
npm run analyze    # analisador do projeto (tamanho, dependências, segurança, cobertura)
```

O jogo não tem dependências de execução. `npm install` só instala o `jsdom`, usado nos testes de interface.

## Documentação

Tudo sobre o estado atual — regras, arquitetura, protocolo, métricas, riscos e próximos passos — está em
[`PROJETO.md`](PROJETO.md).

## Licenças de terceiros

Fontes Cinzel, IM Fell English e Noto Sans Runic (SIL OFL, ver `fonts/`) e a biblioteca de QR code
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, em `src/vendor/`).
