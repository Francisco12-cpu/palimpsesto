// Vanguardas / movimentos literários + explicação curta (tela "Sobre as vanguardas").
// Descrições são só do ESTILO, escritas do zero — nada de trechos de obras protegidas.
//
// A spec original listava 18 nomes para "19 vanguardas"; a 19ª ficou sendo o Classicismo
// (bem distinta das demais). Para trocar, edite só a entrada abaixo.

export const VANGUARD_INFO = [
  // ---- Pré-modernos
  { name: 'Classicismo', emoji: '🏛️', group: 'Pré-modernos',
    about: 'Busca equilíbrio, clareza e proporção, inspirada na Antiguidade greco-latina. Linguagem nobre e contida, mitologia como referência, razão acima do impulso.' },
  { name: 'Barroco', emoji: '👑', group: 'Pré-modernos',
    about: 'Estilo dramático e ornamentado, cheio de contrastes: vida e morte, fé e prazer, céu e terra. Usa antíteses, paradoxos e metáforas rebuscadas, com sensação de angústia e efemeridade.' },
  { name: 'Arcadismo', emoji: '🌾', group: 'Pré-modernos',
    about: 'Elogia a vida simples no campo, a natureza serena e o equilíbrio. Pastores e pastoras, tom sereno e racional, lema de aproveitar o dia (carpe diem) sem exageros.' },
  { name: 'Romantismo', emoji: '🌹', group: 'Pré-modernos',
    about: 'Emoção acima da razão: amor idealizado, saudade, melancolia, natureza como espelho da alma. O "eu" é protagonista, e o sofrimento amoroso ou a morte aparecem com intensidade.' },
  { name: 'Realismo', emoji: '🔍', group: 'Pré-modernos',
    about: 'Retrata a vida cotidiana de forma objetiva e crítica, sem idealizar. Foca em relações sociais, hipocrisia e psicologia dos personagens, com ironia e descrição precisa.' },
  { name: 'Naturalismo', emoji: '🌿', group: 'Pré-modernos',
    about: 'Realismo levado ao extremo, com olhar quase científico: o ambiente e a biologia determinam o comportamento. Descreve miséria, instintos e o lado cru e animalesco das pessoas.' },
  { name: 'Parnasianismo', emoji: '💎', group: 'Pré-modernos',
    about: '"A arte pela arte": poesia impessoal, objetiva e perfeita na forma. Vocabulário culto, rimas ricas, métrica rigorosa, descrição de objetos e cenas como quem cinzela uma joia.' },
  { name: 'Simbolismo', emoji: '🌙', group: 'Pré-modernos',
    about: 'Sugere em vez de dizer: musicalidade, imagens vagas, misticismo e sensações que se misturam (sinestesia). Fala do subconsciente, do sonho e do indizível, com muitos símbolos.' },

  // ---- Vanguardas europeias
  { name: 'Futurismo', emoji: '🚀', group: 'Vanguardas europeias',
    about: 'Celebra a velocidade, a máquina, a cidade e o movimento. Rompe com o passado, dispensa pontuação e sintaxe tradicionais e usa frases curtas, onomatopeias e energia agressiva.' },
  { name: 'Cubismo literário', emoji: '🧩', group: 'Vanguardas europeias',
    about: 'Fragmenta a cena e mostra vários ângulos ao mesmo tempo, como um quadro cubista. Frases quebradas, colagem de imagens e tempo embaralhado, sem uma perspectiva única.' },
  { name: 'Dadaísmo', emoji: '🎲', group: 'Vanguardas europeias',
    about: 'Antiarte irônica e provocadora: o absurdo, o acaso e o nonsense contra a lógica e a tradição. Palavras soltas, humor sem sentido e recusa de qualquer regra.' },
  { name: 'Expressionismo', emoji: '🎭', group: 'Vanguardas europeias',
    about: 'Deforma a realidade para exprimir angústia interior. Tom intenso, gritado, visões sombrias da cidade e da sociedade, imagens distorcidas e emoção levada ao limite.' },
  { name: 'Surrealismo', emoji: '👁️', group: 'Vanguardas europeias',
    about: 'Explora o sonho e o inconsciente: escrita livre, associações inesperadas, imagens impossíveis e lógica de pesadelo. O estranho e o cotidiano se misturam sem explicação.' },
  { name: 'Imagismo', emoji: '📷', group: 'Vanguardas europeias',
    about: 'Poesia enxuta, direta e centrada em uma imagem nítida. Poucas palavras, nenhuma sobra, sem adjetivo decorativo: o instante capturado como uma fotografia em versos.' },

  // ---- Brasileiras
  { name: 'Modernismo', emoji: '🏙️', group: 'Brasileiras',
    about: 'Renova a literatura brasileira: verso livre, linguagem falada, humor e crítica. Valoriza o cotidiano, o país real e a liberdade de forma, sem se prender a regras antigas.' },
  { name: 'Antropofagismo', emoji: '🥥', group: 'Brasileiras',
    about: 'Propõe "devorar" a cultura estrangeira e transformá-la em algo brasileiro e original. Tom irreverente e debochado, mistura de referências, primitivismo assumido e frases-slogan.' },
  { name: 'Concretismo', emoji: '⬛', group: 'Brasileiras',
    about: 'A palavra vira objeto visual e sonoro: poesia com poucas palavras, repetição, disposição no espaço e jogo com a forma. Quase sem verbos ou sintaxe, o layout faz parte do sentido.' },
  { name: 'Poesia Marginal', emoji: '✏️', group: 'Brasileiras',
    about: 'Poesia informal, feita fora do circuito oficial: coloquial, curta, com humor, gíria e assunto do dia a dia. Espontânea, às vezes debochada, com cara de bilhete ou de anotação.' },
  { name: 'Tropicalismo', emoji: '🌴', group: 'Brasileiras',
    about: 'Mistura o brasileiro e o estrangeiro, o popular e o erudito, o arcaico e o moderno. Cheio de ironia, cores, colagem de referências e crítica social com clima festivo.' },
];

export const VANGUARDS = VANGUARD_INFO.map((v) => v.name);
export const EMOJI = Object.fromEntries(VANGUARD_INFO.map((v) => [v.name, v.emoji]));

/** Modo fácil: poucas vanguardas bem contrastantes (spec seção 3). */
export const VANGUARD_PRESETS = {
  todas: { label: 'Todas', names: VANGUARDS },
  facil: {
    label: 'Modo fácil (7 bem diferentes)',
    names: ['Barroco', 'Romantismo', 'Realismo', 'Futurismo', 'Dadaísmo', 'Surrealismo', 'Concretismo'],
  },
  europeias: { label: 'Só europeias', names: VANGUARD_INFO.filter((v) => v.group === 'Vanguardas europeias').map((v) => v.name) },
  brasileiras: { label: 'Só brasileiras', names: VANGUARD_INFO.filter((v) => v.group === 'Brasileiras').map((v) => v.name) },
};
