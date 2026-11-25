const game = new Chess();

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const sideSelect = document.getElementById('sideSelect');
const difficultySelect = document.getElementById('difficultySelect');
const promoModal = document.getElementById('promoModal');
const promoChoices = document.getElementById('promoChoices');
const whiteCapturedEl = document.getElementById('whiteCaptured');
const blackCapturedEl = document.getElementById('blackCaptured');
const whiteMaterialEl = document.getElementById('whiteMaterial');
const blackMaterialEl = document.getElementById('blackMaterial');

let dragSource = null;
let dragDropHandled = false;
let ignoreNextClick = false;

let selectedSquare = null;
let lastMove = null;
let playerColor = 'w';
let pendingPromotion = null;
let aiThinking = false;
let searchToken = 0;
let transpositionTable = new Map();
let searchDeadline = 0;

const SEARCH_TIMEOUT = Symbol('search timeout');
const HARD_THINK_TIME_MS = 3200;
const MEDIUM_THINK_TIME_MS = 250;
const HARD_MAX_DEPTH = 5;

const pieceSymbols = {
  p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚',
  // Use filled glyphs for both sides; CSS controls the piece colour.
  P: '♟', R: '♜', N: '♞', B: '♝', Q: '♛', K: '♚'
};

const pieceValues = { p: 10, n: 30, b: 30, r: 50, q: 90, k: 900 };

function getKingSquares() {
  const board = game.board();
  const kings = { w: null, b: null };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];

      if (piece && piece.type === 'k') {
        kings[piece.color] = String.fromCharCode(97 + c) + (8 - r);
      }
    }
  }

  return kings;
}

function renderMaterial() {
  const captured = { w: [], b: [] };

  game.history({ verbose: true }).forEach(move => {
    if (move.captured) {
      captured[move.color].push(move.captured);
    }
  });

  function showCaptured(color, element, scoreElement) {
    const capturedColor = color === 'w' ? 'b' : 'w';
    const score = captured[color]
      .reduce((total, piece) => total + pieceValues[piece], 0);

    element.innerHTML = captured[color]
      .map(piece => {
        const symbolKey = capturedColor === 'w'
          ? piece.toUpperCase()
          : piece;

        const pieceClass = capturedColor === 'w'
          ? 'white-piece'
          : 'black-piece';

        return `<span class="captured-piece ${pieceClass}">${pieceSymbols[symbolKey]}</span>`;
      })
      .join('');

    scoreElement.textContent = '';
  }

  showCaptured('w', whiteCapturedEl, whiteMaterialEl);
  showCaptured('b', blackCapturedEl, blackMaterialEl);

  const whiteScore = captured.w
    .reduce((total, piece) => total + pieceValues[piece], 0);

  const blackScore = captured.b
    .reduce((total, piece) => total + pieceValues[piece], 0);

  const difference = whiteScore - blackScore;

  whiteMaterialEl.textContent =
    difference > 0 ? `+${difference / 10}` : '';

  blackMaterialEl.textContent =
    difference < 0 ? `+${Math.abs(difference) / 10}` : '';
}

function showDragHighlights(from) {
  const legalSquares = game.moves({
    square: from,
    verbose: true
  }).map(move => move.to);

  boardEl.querySelectorAll('.square').forEach(square => {
    if (legalSquares.includes(square.dataset.square)) {
      square.classList.add('highlight');
    }
  });
}

function clearDragHighlights() {
  boardEl.querySelectorAll('.square').forEach(square => {
    square.classList.remove(
      'highlight',
      'selected',
      'drag-source'
    );
  });
}

function isLegalDragTarget(from, to) {
  return game.moves({
    square: from,
    verbose: true
  }).some(move => move.to === to);
}

function renderBoard() {
  boardEl.innerHTML = '';

  const board = game.board();
  const legalMoves = selectedSquare
    ? game.moves({ square: selectedSquare, verbose: true }).map(m => m.to)
    : [];

  const kings = getKingSquares();
  const turn = game.turn();
  const isCheckmate = game.in_checkmate();
  const isDraw = game.in_draw();
  const isCheck = game.in_check();

  // Reverse both axes when playing as Black so the board is rotated.
  const rows = playerColor === 'w'
    ? [0, 1, 2, 3, 4, 5, 6, 7]
    : [7, 6, 5, 4, 3, 2, 1, 0];

  const cols = playerColor === 'w'
    ? [0, 1, 2, 3, 4, 5, 6, 7]
    : [7, 6, 5, 4, 3, 2, 1, 0];

  for (const r of rows) {
    for (const c of cols) {
      const squareName = String.fromCharCode(97 + c) + (8 - r);
      const sqEl = document.createElement('div');
      sqEl.dataset.square = squareName;

      sqEl.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');

      if (lastMove && (lastMove.from === squareName || lastMove.to === squareName)) {
        sqEl.classList.add('last-move');
      }

      if (selectedSquare === squareName) sqEl.classList.add('selected');
      if (legalMoves.includes(squareName)) sqEl.classList.add('highlight');

      if (isCheckmate) {
        const loserSquare = kings[turn];
        const winnerSquare = kings[turn === 'w' ? 'b' : 'w'];

        if (squareName === loserSquare) sqEl.classList.add('king-loser');
        if (squareName === winnerSquare) sqEl.classList.add('king-winner');
      } else if (isDraw) {
        if (squareName === kings.w || squareName === kings.b) {
          sqEl.classList.add('king-draw');
        }
      } else if (isCheck && squareName === kings[turn]) {
        sqEl.classList.add('in-check');
      }

      const piece = board[r][c];

      if (piece) {
        const key = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
        sqEl.classList.add(piece.color === 'w' ? 'white-piece' : 'black-piece');
        sqEl.classList.add(`${piece.color}-piece-${piece.type}`);
        sqEl.textContent = pieceSymbols[key];
      }

      sqEl.onclick = () => {
        if (!ignoreNextClick) {
          onSquareClick(squareName);
        }
      };

      const canDragPiece =
        piece &&
        piece.color === playerColor &&
        !aiThinking &&
        !pendingPromotion &&
        game.turn() === playerColor;

      if (canDragPiece) {
        sqEl.draggable = true;

        sqEl.addEventListener('dragstart', event => {
          dragSource = squareName;
          dragDropHandled = false;

          sqEl.classList.add('drag-source');
          showDragHighlights(squareName);

          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', squareName);

          // Make the floating drag image contain only the piece, not its square.
          const dragGhost = document.createElement('span');

          dragGhost.className =
            `drag-ghost ` +
            `${piece.color === 'w' ? 'white-piece' : 'black-piece'} ` +
            `${piece.color}-piece-${piece.type}`;

          dragGhost.textContent = sqEl.textContent;

          document.body.appendChild(dragGhost);

          event.dataTransfer.setDragImage(dragGhost, 21, 21);

          setTimeout(() => {
            dragGhost.remove();
          }, 0);
        });

        sqEl.addEventListener('dragend', () => {
          clearDragHighlights();

          if (!dragDropHandled) {
            selectedSquare = null;
            renderBoard();
          }

          dragSource = null;
          dragDropHandled = false;

          ignoreNextClick = true;
          setTimeout(() => {
            ignoreNextClick = false;
          }, 50);
        });
      }

      sqEl.addEventListener('dragover', event => {
        if (
          dragSource &&
          isLegalDragTarget(dragSource, squareName)
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }
      });

      sqEl.addEventListener('drop', event => {
        event.preventDefault();

        if (!dragSource) return;

        const from = dragSource;
        dragDropHandled = true;
        clearDragHighlights();

        if (!isLegalDragTarget(from, squareName)) {
          selectedSquare = null;
          renderBoard();
          return;
        }

        selectedSquare = from;
        onSquareClick(squareName);
      });

      boardEl.appendChild(sqEl);
    }
  }

  renderMaterial();
  updateStatus();
}

function startThinking() {
  aiThinking = true;

  const text = 'Thinking';

  statusEl.innerHTML = [...text]
    .map((letter, index) => {
      const safeLetter = letter === ' ' ? '&nbsp;' : letter;
      return `<span style="--letter-index: ${index}">${safeLetter}</span>`;
    })
    .join('');

  statusEl.classList.add('thinking-status');
}

function stopThinking() {
  aiThinking = false;
  statusEl.classList.remove('thinking-status');
}

function showPromotionDialog(from, to) {
  pendingPromotion = { from, to };
  promoChoices.innerHTML = '';

  const options = ['q', 'r', 'b', 'n'];

  options.forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';

    const key = playerColor === 'w' ? type.toUpperCase() : type;
    btn.textContent = pieceSymbols[key];
    btn.onclick = () => completePromotion(type);

    promoChoices.appendChild(btn);
  });

  promoModal.style.display = 'flex';
}

function completePromotion(pieceType) {
  promoModal.style.display = 'none';
  if (!pendingPromotion) return;

  const move = game.move({
    from: pendingPromotion.from,
    to: pendingPromotion.to,
    promotion: pieceType
  });

  pendingPromotion = null;
  selectedSquare = null;

  if (move) {
    lastMove = { from: move.from, to: move.to };
    renderBoard();

    if (!game.game_over()) {
      startThinking();
      setTimeout(makeAIMove, 0);
    }
  }
}

function onSquareClick(square) {
  if (
    aiThinking ||
    game.game_over() ||
    game.turn() !== playerColor ||
    pendingPromotion
  ) {
    return;
  }
  

  if (selectedSquare) {
    const matchingMoves = game.moves({ square: selectedSquare, verbose: true })
      .filter(m => m.to === square);

    if (matchingMoves.length > 0 && matchingMoves[0].flags.includes('p')) {
      showPromotionDialog(selectedSquare, square);
      return;
    }

    const move = game.move({ from: selectedSquare, to: square });
    selectedSquare = null;

    if (move) {
      lastMove = { from: move.from, to: move.to };
      renderBoard();

      if (!game.game_over()) {
        startThinking();
        setTimeout(makeAIMove, 0);
      }
    } else {
      const piece = game.get(square);
      if (piece && piece.color === playerColor) selectedSquare = square;
      renderBoard();
    }
  } else {
    const piece = game.get(square);

    if (piece && piece.color === playerColor) {
      selectedSquare = square;
      renderBoard();
    }
  }
}

function kingSafetyScore(board, color) {
  const kingRow = color === 'w' ? 7 : 0;
  const pawnRow = color === 'w' ? 6 : 1;
  let kingCol = -1;

  for (let col = 0; col < 8; col++) {
    if (
      board[kingRow][col] &&
      board[kingRow][col].type === 'k' &&
      board[kingRow][col].color === color
    ) {
      kingCol = col;
      break;
    }
  }

  if (kingCol === -1) return 0;

  let score = 0;
  const hasCastled = kingCol === 2 || kingCol === 6;

  if (hasCastled) {
    score += 24;

    const shieldFiles = kingCol === 6
      ? [5, 6, 7]
      : [1, 2, 3];

    for (const file of shieldFiles) {
      const piece = board[pawnRow][file];

      if (piece && piece.type === 'p' && piece.color === color) {
        score += 7;
      } else {
        score -= 13;
      }
    }
  } else if (game.history().length > 14) {
    // Encourage getting the king safe once the opening is over.
    score -= 18;
  }

  return score;
}

function evaluateBoard(aiColor) {
  if (game.in_checkmate()) return game.turn() === aiColor ? -1000000 : 1000000;
  if (game.in_draw()) return 0;

  let total = 0;
  const board = game.board();
  const pawnFiles = { w: Array(8).fill(0), b: Array(8).fill(0) };

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const sign = piece.color === aiColor ? 1 : -1;
      const centerDistance = Math.abs(3.5 - r) + Math.abs(3.5 - c);
      let value = pieceValues[piece.type];

      if (piece.type === 'p') {
        pawnFiles[piece.color][c]++;
        const advancement = piece.color === 'w' ? 6 - r : r - 1;
        value += advancement * 4;
        if (c === 3 || c === 4) value += 8;
      } else if (piece.type === 'n' || piece.type === 'b') {
        value += Math.max(0, 4 - centerDistance) * 8;
      } else if (piece.type === 'r') {
        const hasPawnOnFile = board.some(row => row[c]?.type === 'p' && row[c]?.color === piece.color);
        if (!hasPawnOnFile) value += 18;
      }

      total += sign * value;
    }
  }

  // Prefer active positions and discourage moving rooks/queens too early.
  const mobility = game.moves().length;
  total += (game.turn() === aiColor ? mobility : -mobility) * 2;
  if (game.history().length < 12) {
    board.flat().forEach(piece => {
      if (!piece || piece.color !== aiColor) return;
      if (piece.type === 'r' && piece.square !== undefined) total -= 4;
    });
  }
  const aiKingSafety = kingSafetyScore(board, aiColor);
  const opponentColor = aiColor === 'w' ? 'b' : 'w';
  const opponentKingSafety = kingSafetyScore(board, opponentColor);

  total += aiKingSafety - opponentKingSafety;
  
  return total;
}

function orderMoves(moves) {
  const scoredMoves = moves.map(move => {
    let value = 0;

    if (move.captured) {
      value += 10 * pieceValues[move.captured];
      value -= pieceValues[move.piece];
    }

    if (move.promotion) {
      value += 800;
    }

    if (move.flags.includes('k') || move.flags.includes('q')) {
      value += 35;
    }

    // chess.js includes + or # in SAN notation for checks/checkmates.
    if (move.san.includes('#')) {
      value += 100000;
    } else if (move.san.includes('+')) {
      value += 500;
    }

    return { move, value };
  });

  scoredMoves.sort((a, b) => b.value - a.value);

  return scoredMoves.map(item => item.move);
}

function quiescenceSearch(depth, alpha, beta, isMaximizing, aiColor) {
  if (performance.now() >= searchDeadline) return SEARCH_TIMEOUT;

  if (game.in_checkmate()) {
    return game.turn() === aiColor
      ? -1000000 - depth
      : 1000000 + depth;
  }

  if (game.in_draw()) return 0;

  const standPat = evaluateBoard(aiColor);

  if (depth === 0) return standPat;

  const inCheck = game.in_check();
  let moves = game.moves({ verbose: true });

  if (!inCheck) {
    moves = moves.filter(move =>
      move.captured ||
      move.promotion ||
      move.san.includes('+') ||
      move.san.includes('#')
    );
  }

  moves = orderMoves(moves);

  if (isMaximizing) {
    let best = standPat;
    alpha = Math.max(alpha, best);

    for (const move of moves) {
      game.move(move);

      const value = quiescenceSearch(
        depth - 1,
        alpha,
        beta,
        false,
        aiColor
      );

      game.undo();

      if (value === SEARCH_TIMEOUT) return SEARCH_TIMEOUT;

      best = Math.max(best, value);
      alpha = Math.max(alpha, value);

      if (beta <= alpha) break;
    }

    return best;
  }

  let best = standPat;
  beta = Math.min(beta, best);

  for (const move of moves) {
    game.move(move);

    const value = quiescenceSearch(
      depth - 1,
      alpha,
      beta,
      true,
      aiColor
    );

    game.undo();

    if (value === SEARCH_TIMEOUT) return SEARCH_TIMEOUT;

    best = Math.min(best, value);
    beta = Math.min(beta, value);

    if (beta <= alpha) break;
  }

  return best;
}

function getPositionKey(depth, isMaximizing, aiColor) {
  // Includes board layout, side to move, castling rights,
  // and en-passant information.
  const position = game.fen().split(' ').slice(0, 4).join(' ');

  return `${position}|${depth}|${isMaximizing}|${aiColor}`;
}

function minimax(depth, alpha, beta, isMaximizing, aiColor) {
  if (performance.now() >= searchDeadline) return SEARCH_TIMEOUT;

  if (game.in_checkmate()) {
    return game.turn() === aiColor
      ? -1000000 - depth
      : 1000000 + depth;
  }

  if (game.game_over()) {
    return evaluateBoard(aiColor);
  }

  if (depth === 0) {
    return quiescenceSearch(
      1,
      alpha,
      beta,
      isMaximizing,
      aiColor
    );
  }

  const key = getPositionKey(depth, isMaximizing, aiColor);
  const rememberedScore = transpositionTable.get(key);

  if (rememberedScore !== undefined) {
    return rememberedScore;
  }

  const moves = orderMoves(game.moves({ verbose: true }));
  let result = isMaximizing ? -Infinity : Infinity;
  let cutOff = false;

  for (const move of moves) {
    game.move(move);

    const score = minimax(
      depth - 1,
      alpha,
      beta,
      !isMaximizing,
      aiColor
    );

    game.undo();

    if (score === SEARCH_TIMEOUT) return SEARCH_TIMEOUT;

    if (isMaximizing) {
      result = Math.max(result, score);
      alpha = Math.max(alpha, result);
    } else {
      result = Math.min(result, score);
      beta = Math.min(beta, result);
    }

    if (beta <= alpha) {
      cutOff = true;
      break;
    }
  }

  if (!cutOff) {
    if (transpositionTable.size > 50000) {
      transpositionTable.clear();
    }

    transpositionTable.set(key, result);
  }

  return result;
}
const openingBook = {
  //  AI IS WHITE 
  '': ['e4', 'd4'], // Removed Nf3 to keep White's plan direct
  
  // 1. e4 lines (Italian Game focus)
  'e4 e5': ['Nf3'],
  'e4 e5 Nf3 Nc6': ['Bc4'],
  'e4 c5': ['Nf3'],          // Anti-Sicilian: simple development
  'e4 c5 Nf3 d6': ['d4'],
  'e4 c5 Nf3 Nc6': ['d4'],
  'e4 c6': ['d4'],           // vs Caro-Kann
  'e4 e6': ['d4'],           // vs French
  'e4 d5': ['exd5'],         // vs Scandinavian (just take the free center pawn)
  'e4 d5 exd5 Qxd5':['Nc3'],

  // 1. d4 lines (Queen's Gambit / London focus)
  'd4 d5': ['c4', 'Bf4'],
  'd4 Nf6': ['Nf3', 'Bf4'],

  // === AI IS BLACK ===
  // vs 1. e4 (Stick to symmetrical e5 or solid Caro-Kann c6)
  'e4': ['e5', 'c6'],
  'e4 e5 Nf3': ['Nc6','Nf6'],
  'e4 e5 Nf3 Nc6 Bc4': ['Bc5', 'Nf6'],
  'e4 e5 Nf3 Nc6 Bb5': ['Nf6','a6'],
  'e4 c6': ['d4'],
  //carokann
  'e4 c6 d4': ['d5'],
  'e4 c6 d4 d5': ['exd5', 'Nc3'],
  'e4 c6 d4 d5 exd5': ['cxd5'],
  'e4 c6 d4 d5 e5': ['Bf5'],
  'e4 c6 d4 d5 Nc3': ['dxe4'],
  'e4 c6 d4 d5 exd5 cxd5 Nc3': ['Bf5', 'Nf6'],
  'e4 c6 e5': ['Bf5'],

  // vs 1. d4 (Stick to symmetrical d5 or solid Nf6)
  'd4': ['d5', 'Nf6'],
  'd4 d5 c4': ['e6', 'c6'],  // QGD or Slav (super solid)
  'd4 d5 Bf4': ['Nf6', 'e6'],
  'd4 Nf6 c4': ['e6'],       // Avoids sharp King's Indian (g6)

  // vs 1. Nf3 (Mirror the center)
  'Nf3': ['d5', 'Nf6'],
  'Nf3 d5 c4': ['e6', 'c6'],
  'Nf3 d5 g3': ['Nf6']
};


function getOpeningBookMove() {
  if (game.history().length > 14) return null;

  const options = openingBook[game.history().join(' ')];
  if (!options) return null;

  const legalMoves = game.moves();
  const available = options.filter(move => legalMoves.includes(move));
  return available.length ? available[Math.floor(Math.random() * available.length)] : null;
}

function finishAIMove(chosenMove, token = null) {
  // Reject an old or cancelled search.
  if (token !== null && token !== searchToken) return;

  // Never move if it is not currently the AI's turn.
  if (!aiThinking || game.game_over() || game.turn() === playerColor) {
    return;
  }

  stopThinking();

  if (!chosenMove) {
    renderBoard();
    return;
  }

  const moveObj = game.move(chosenMove);

  if (moveObj) {
    lastMove = {
      from: moveObj.from,
      to: moveObj.to
    };
  }

  renderBoard();
}

function findMateInOne(moves) {
  for (const move of moves) {
    game.move(move);
    const isMate = game.in_checkmate();
    game.undo();

    if (isMate) return move;
  }

  return null;
}

function opponentHasMateInOne() {
  const replies = game.moves({ verbose: true });

  for (const reply of replies) {
    game.move(reply);
    const isMate = game.in_checkmate();
    game.undo();

    if (isMate) return true;
  }

  return false;
}

function sacrificeRiskPenalty(move) {
  const valuablePiece = ['n', 'b', 'r'].includes(move.piece);

  if (!valuablePiece) return 0;

  const movingPieceValue = pieceValues[move.piece];
  const capturedValue = move.captured
    ? pieceValues[move.captured]
    : 0;

  // Winning an equal-or-more-valuable piece is not a sacrifice.
  if (capturedValue >= movingPieceValue) return 0;

  // The candidate move has already been played at this point.
  // Can the opponent simply capture the moved piece?
  const captures = game.moves({ verbose: true }).filter(reply =>
    reply.to === move.to &&
    reply.captured === move.piece
  );

  if (captures.length === 0) return 0;

  for (const capture of captures) {
    game.move(capture);

    const followUps = game.moves({ verbose: true });

    const hasMate = followUps.some(reply => reply.san.includes('#'));

    // Can Tuffish immediately win back the piece which captured it?
    const canRecapture = followUps.some(reply =>
      reply.to === capture.to && reply.captured
    );

    // A sacrifice is only allowed some freedom if it creates
    // several forcing checks after the opponent accepts it.
    const checkingReplies = followUps.filter(reply =>
      reply.san.includes('+')
    ).length;

    game.undo();

    // The opponent only needs one safe way to accept the sacrifice.
    if (!hasMate && !canRecapture && checkingReplies < 2) {
      return movingPieceValue * 3;
    }
  }

  return 0;
}

function openingDisciplinePenalty(move, aiColor) {
  // Only apply opening rules during the first eight full moves.
  if (
    game.history().length > 16 ||
    move.captured ||
    move.san.includes('+')
  ) {
    return 0;
  }

  let penalty = 0;

  const minorPieceStarts = aiColor === 'w'
    ? ['b1', 'g1', 'c1', 'f1']
    : ['b8', 'g8', 'c8', 'f8'];

  // Developing one piece twice wastes time unless it is tactical.
  if (
    (move.piece === 'n' || move.piece === 'b') &&
    !minorPieceStarts.includes(move.from)
  ) {
    penalty += 12;
  }

  // Never wander with the king in the opening. Castling is allowed.
  if (
    move.piece === 'k' &&
    !move.flags.includes('k') &&
    !move.flags.includes('q')
  ) {
    penalty += 70;
  }

  // Do not put a bishop in front of an unmoved centre pawn.
  const blockedPawnSquares = aiColor === 'w'
    ? { d3: 'd2', e3: 'e2' }
    : { d6: 'd7', e6: 'e7' };

  if (move.piece === 'b' && blockedPawnSquares[move.to]) {
    const pawn = game.get(blockedPawnSquares[move.to]);

    if (pawn && pawn.type === 'p' && pawn.color === aiColor) {
      penalty += 22;
    }
  }

  // Reward claiming the four central squares with a pawn.
  if (
    move.piece === 'p' &&
    ['d4', 'e4', 'd5', 'e5'].includes(move.to)
  ) {
    penalty -= 14;
  }

  return penalty;
}
function freePiecePenalty() {
  // At this point the candidate AI move has already been played,
  // so game.moves() gives the opponent's legal replies.
  const enemyCaptures = game.moves({ verbose: true }).filter(move =>
    move.captured &&
    pieceValues[move.captured] >= pieceValues.n
  );

  let worstLoss = 0;

  for (const capture of enemyCaptures) {
    const lostValue = pieceValues[capture.captured];

    game.move(capture);

    // Can Tuffish capture the attacking piece back?
    const recaptures = game.moves({ verbose: true }).filter(reply =>
      reply.to === capture.to && reply.captured
    );

    const recoveredValue = recaptures.reduce(
      (highest, reply) =>
        Math.max(highest, pieceValues[reply.captured] || 0),
      0
    );

    game.undo();

    // A knight taken by a pawn, then recapturing that pawn,
    // still loses 20 points of material.
    const netLoss = Math.max(0, lostValue - recoveredValue);

    worstLoss = Math.max(worstLoss, netLoss * 2);
  }

  return worstLoss;
}

function knightForkScore(knightSquare, victimColor) {
  const file = knightSquare.charCodeAt(0) - 97;
  const rank = Number(knightSquare[1]) - 1;

  const jumps = [
    [1, 2], [2, 1], [2, -1], [1, -2],
    [-1, -2], [-2, -1], [-2, 1], [-1, 2]
  ];

  const targets = [];

  for (const [fileChange, rankChange] of jumps) {
    const newFile = file + fileChange;
    const newRank = rank + rankChange;

    if (newFile < 0 || newFile > 7 || newRank < 0 || newRank > 7) {
      continue;
    }

    const square =
      String.fromCharCode(97 + newFile) +
      String(newRank + 1);

    const piece = game.get(square);

    if (!piece || piece.color !== victimColor) continue;

    // A fork must attack important pieces, not merely two pawns.
    if (piece.type === 'k') {
      targets.push(50);
    } else if (piece.type !== 'p') {
      targets.push(pieceValues[piece.type]);
    }
  }

  if (targets.length < 2) return 0;

  targets.sort((a, b) => b - a);

  // Only count the two best targets.
  return Math.min(80, targets[0] + targets[1]);
}

function ownKnightForkBonus(move, aiColor) {
  if (move.piece !== 'n') return 0;

  const opponentColor = aiColor === 'w' ? 'b' : 'w';

  return knightForkScore(move.to, opponentColor);
}

function opponentKnightForkPenalty(aiColor) {
  const opponentMoves = game.moves({ verbose: true })
    .filter(move => move.piece === 'n');

  let worstFork = 0;

  for (const move of opponentMoves) {
    game.move(move);

    const forkScore = knightForkScore(move.to, aiColor);

    game.undo();

    worstFork = Math.max(worstFork, forkScore);
  }

  return worstFork;
}

function searchBestMoveAsync(
  moves,
  index,
  bestValue,
  bestMove,
  searchDepth,
  aiColor,
  token,
  onComplete
) {
  if (token !== searchToken) return;

  if (performance.now() >= searchDeadline) {
    onComplete(bestMove, false);
    return;
  }

  if (index >= moves.length) {
    onComplete(bestMove, true);
    return;
  }

  const move = moves[index];

  game.move(move);

  const openingPenalty = openingDisciplinePenalty(move, aiColor);
  const hangingPiecePenalty = freePiecePenalty();
  const forkBonus = ownKnightForkBonus(move, aiColor);
  const forkThreatPenalty = opponentKnightForkPenalty(aiColor);

  const earlyQueenMove =
    move.piece === 'q' &&
    game.history().length < 10 &&
    !move.captured &&
    !move.promotion;

  const queenPenalty =
    earlyQueenMove && !game.in_check()
      ? 18
      : 0;

  const earlyRookPenalty =
    move.piece === 'r' && game.history().length < 8
      ? 35
      : 0;

  let castlingPenalty = 0;

  if (move.flags.includes('k') || move.flags.includes('q')) {
    const pawnRank = aiColor === 'w' ? '2' : '7';

    const exposedFiles = move.flags.includes('k')
      ? ['f', 'g']
      : ['b', 'c', 'd'];

    for (const file of exposedFiles) {
      const piece = game.get(file + pawnRank);

      if (!piece || piece.type !== 'p' || piece.color !== aiColor) {
        castlingPenalty += 25;
      }
    }
  }

  const mateThreat = opponentHasMateInOne();
  const sacrificePenalty = sacrificeRiskPenalty(move);

  const searchScore = mateThreat
    ? -999999
    : minimax(searchDepth, -Infinity, Infinity, false, aiColor);

  game.undo();

  if (searchScore === SEARCH_TIMEOUT) {
    onComplete(bestMove, false);
    return;
  }

  const boardValue =
    searchScore -
    castlingPenalty -
    earlyRookPenalty -
    queenPenalty -
    sacrificePenalty -
    openingPenalty -
    hangingPiecePenalty +
    forkBonus -
    forkThreatPenalty;

  const nextBestValue =
    boardValue > bestValue ? boardValue : bestValue;

  const nextBestMove =
    boardValue > bestValue ? move : bestMove;

  setTimeout(() => {
    searchBestMoveAsync(
      moves,
      index + 1,
      nextBestValue,
      nextBestMove,
      searchDepth,
      aiColor,
      token,
      onComplete
    );
  }, 0);
}

function runIterativeSearch(
  moves,
  depth,
  lastCompletedMove,
  aiColor,
  token
) {
  if (token !== searchToken) return;

  if (
    performance.now() >= searchDeadline ||
    depth > HARD_MAX_DEPTH
  ) {
    finishAIMove(lastCompletedMove || moves[0], token);
    return;
  }

  searchBestMoveAsync(
    moves,
    0,
    -Infinity,
    null,
    depth,
    aiColor,
    token,
    (bestMove, completed) => {
      if (token !== searchToken) return;

      const safeMove = bestMove || lastCompletedMove || moves[0];

      if (!completed) {
        finishAIMove(lastCompletedMove || safeMove, token);
        return;
      }

      setTimeout(() => {
        runIterativeSearch(
          moves,
          depth + 1,
          safeMove,
          aiColor,
          token
        );
      }, 0);
    }
  );
}

function makeAIMove() {
  if (!aiThinking || game.turn() === playerColor) {
    return;
  }

  const moves = game.moves();
  const mateMove = findMateInOne(game.moves({ verbose: true }));

  if (mateMove) {
    finishAIMove(mateMove);
    return;
  }
  if (moves.length === 0) return;

  const difficulty = difficultySelect.value;
  const aiColor = playerColor === 'w' ? 'b' : 'w';
  let chosenMove = null;

  if (difficulty === 'easy') {
    chosenMove = moves[Math.floor(Math.random() * moves.length)];
  } else {
    if (difficulty === 'hard') chosenMove = getOpeningBookMove();
    if (chosenMove) {
      // Use the book move while the current position is familiar.
    } else {
      const orderedMoves = orderMoves(
        game.moves({ verbose: true })
      );

      if (difficulty === 'medium') {
        orderedMoves.sort(() => Math.random() - 0.5);
      }

      transpositionTable.clear();

      const token = ++searchToken;

      if (difficulty === 'hard') {
        searchDeadline = performance.now() + HARD_THINK_TIME_MS;

        runIterativeSearch(
          orderedMoves,
          1,
          null,
          aiColor,
          token
        );
      } else {
        searchDeadline = performance.now() + MEDIUM_THINK_TIME_MS;

        searchBestMoveAsync(
          orderedMoves,
          0,
          -Infinity,
          null,
          1,
          aiColor,
          token,
          bestMove => finishAIMove(bestMove || orderedMoves[0], token)
        );
      }

      return;
    }
  }

  if (!chosenMove) {
    stopThinking();
    return;
  }

  finishAIMove(chosenMove);
}

function updateStatus() {
  const isPlayerTurn = game.turn() === playerColor;

  if (game.in_checkmate()) {
    statusEl.textContent = isPlayerTurn
      ? 'Checkmate! AI wins.'
      : 'Checkmate! You win!';
  } else if (game.in_draw()) {
    statusEl.textContent = 'Game Over: Draw!';
  } else {
    const turnLabel = isPlayerTurn ? 'Your turn' : 'AI turn';
    statusEl.textContent = turnLabel + (game.in_check() ? ' - CHECK!' : '');
  }
}

function resetGame() {
  searchToken++;
  searchDeadline = 0;
  transpositionTable.clear();
  stopThinking();

  game.reset();
  promoModal.style.display = 'none';
  pendingPromotion = null;
  playerColor = sideSelect.value;
  selectedSquare = null;
  lastMove = null;

  renderBoard();

  if (playerColor === 'b') {
    startThinking();
    setTimeout(makeAIMove, 0);
  }
}

document.querySelectorAll('.difficulty-option').forEach(button => {
  button.addEventListener('click', () => {
    difficultySelect.value = button.dataset.level;
    document.querySelectorAll('.difficulty-option').forEach(option => option.classList.remove('active'));
    button.classList.add('active');
  });
});

renderBoard();
window.testGame = game;
window.testRender = renderBoard;