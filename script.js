function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function () {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rngSeedValue = Math.floor(Math.random() * 0xffffffff);
let random = createSeededRandom(rngSeedValue);

function reseedRandom(seedValue) {
  rngSeedValue = seedValue >>> 0;
  random = createSeededRandom(rngSeedValue);
}

const storedGridSize = Number(localStorage.getItem('spectrum-grid-size'));
let gridSize = [4, 5, 7].includes(storedGridSize) ? storedGridSize : 5;
let fixedPositions = getFixedPositions(gridSize);
const board = document.getElementById('board');
const movesElement = document.getElementById('moves');
const placedElement = document.getElementById('placed');
const statusText = document.getElementById('status-text');
const completion = document.getElementById('completion');
let tiles = [];
let selectedId = null;
let draggedId = null;
let dragStartPosition = null;
let dragPreviewPosition = null;
let pointerDragActive = false;
let pointerDragId = null;
let pointerStartX = 0;
let pointerStartY = 0;
let draggedElement = null;
let dragPlaceholder = null;
let suppressClick = false;
let moves = 0;
let gameStartTime = null;
let palette = [];
let completedLines = new Set();
let completionRevealTimer = null;
const completionStatsElement = document.getElementById('completion-stats');
const storedTheme = localStorage.getItem('spectrum-theme');
const storedPaletteMode = localStorage.getItem('spectrum-palette-mode');
let paletteMode = ['pastel', 'bold', 'mono'].includes(storedPaletteMode) ? storedPaletteMode : 'bold';
const completionDuration = 150;
const completionStagger = 37.5;

function getCompletionTiming() {
  const speedFactor = 1 - ((Math.min(9, Math.max(4, gridSize)) - 4) / 5) * 0.5;
  return { duration: completionDuration * speedFactor, stagger: completionStagger * speedFactor };
}

function formatCompletionStats() {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - gameStartTime) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = String(elapsedSeconds % 60).padStart(2, '0');
  const moveLabel = moves === 1 ? 'move' : 'moves';
  return `${moves} ${moveLabel} · ${minutes}:${seconds}`;
}

function getFixedPositions(size) {
  const last = size - 1;
  const middle = Math.floor(size / 2);
  const corners = [0, last, last * size, last * size + last];
  const positions = new Set(size === 4 ? pickRandomCorners(corners, 2) : corners);
  if (size % 2 === 1) positions.add(middle * size + middle);
  if (size % 2 === 0 && size >= 6) {
    const centerPair = [middle - 1, middle];
    for (let offset = 0; offset <= Math.floor((size - 6) / 2); offset += 1) {
      [offset, last - offset].forEach(row => centerPair.forEach(column => positions.add(row * size + column)));
      [offset, last - offset].forEach(column => centerPair.forEach(row => positions.add(row * size + column)));
    }
  }
  if (size % 2 === 1 && size >= 7) {
    for (let offset = 1; offset <= Math.floor((size - 5) / 2); offset += 1) {
      positions.add((middle - offset) * size + (middle - offset));
      positions.add((middle - offset) * size + (middle + offset));
      positions.add((middle + offset) * size + (middle - offset));
      positions.add((middle + offset) * size + (middle + offset));
    }
  }
  return positions;
}

function getTotalTiles() {
  return gridSize * gridSize;
}

function pickRandomCorners(corners, count) {
  const shuffled = [...corners];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled.slice(0, count);
}

function colourFor(index) {
  return palette[index];
}

const PALETTE_SEED_CODES = { pastel: 'p', bold: 'b', mono: 'm' };
const PALETTE_MODES_BY_CODE = { p: 'pastel', b: 'bold', m: 'mono' };

function encodeSeedCode() {
  return `${gridSize}${PALETTE_SEED_CODES[paletteMode] || 'b'}${rngSeedValue.toString(36)}`;
}

function decodeSeedCode(code) {
  const match = /^([457])([pbm])([0-9a-z]+)$/i.exec((code || '').trim());
  if (!match) return null;
  const size = Number(match[1]);
  const mode = PALETTE_MODES_BY_CODE[match[2].toLowerCase()];
  const seedValue = parseInt(match[3], 36);
  if (!mode || Number.isNaN(seedValue)) return null;
  return { size, mode, seedValue };
}

function updateSeedUI() {
  const code = encodeSeedCode();
  const url = new URL(window.location.href);
  url.searchParams.set('seed', code);
  window.history.replaceState(null, '', url);
  const seedField = document.getElementById('seed-code');
  if (seedField) seedField.value = code;
}

function applyPuzzleState(size, mode, seedValue) {
  gridSize = size;
  paletteMode = mode;
  localStorage.setItem('spectrum-grid-size', String(gridSize));
  localStorage.setItem('spectrum-palette-mode', paletteMode);
  reseedRandom(seedValue);
  fixedPositions = getFixedPositions(gridSize);
  moves = 0;
  gameStartTime = Date.now();
  selectedId = null;
  draggedId = null;
  shuffleMovable();
  board.style.setProperty('--grid-size', gridSize);
  document.querySelectorAll('[data-size]').forEach(option => option.classList.toggle('active', Number(option.dataset.size) === gridSize));
  document.querySelectorAll('[data-palette]').forEach(option => option.classList.toggle('active', option.dataset.palette === paletteMode));
  render();
  updateSeedUI();
}

function generatePalette() {
  const startingHue = Math.floor(random() * 360);
  const gridSeparation = gridSize === 4 ? 110 : 220 - (gridSize - 4) * 18;
  const gradientMagnitude = gridSeparation + Math.floor(random() * 16);
  // keep both axes at least half of the base magnitude so the gradient never collapses to near-horizontal or near-vertical
  const horizontalHueSpread = (random() < 0.5 ? 1 : -1) * gradientMagnitude * (0.5 + random() * 0.5);
  const verticalHueSpread = (random() < 0.5 ? 1 : -1) * gradientMagnitude * (0.5 + random() * 0.5);
  const pastelPalette = paletteMode === 'pastel';
  const monoPalette = paletteMode === 'mono';
  const saturation = pastelPalette ? 42 + Math.floor(random() * 10) : 58 + Math.floor(random() * 10);
  const lightness = pastelPalette ? 70 + Math.floor(random() * 7) : 48 + Math.floor(random() * 8);
  const monoSaturation = 35 + Math.floor(random() * 30);
  const monoCenterLightness = 46 + Math.floor(random() * 8);
  // randomize which corner is darkest/lightest instead of always top-left/bottom-right
  const horizontalLightnessSpread = (28 + Math.floor(random() * 10)) * (random() < 0.5 ? 1 : -1);
  const verticalLightnessSpread = (36 + Math.floor(random() * 10)) * (random() < 0.5 ? 1 : -1);
  const centerIndex = Math.floor(gridSize / 2) * gridSize + Math.floor(gridSize / 2);
  palette = Array.from({ length: getTotalTiles() }, (_, index) => {
    const row = Math.floor(index / gridSize);
    const column = index % gridSize;
    const baseHue = startingHue + (column / (gridSize - 1)) * horizontalHueSpread + (row / (gridSize - 1)) * verticalHueSpread;
    const hue = gridSize % 2 === 1 && index === centerIndex
      ? startingHue + horizontalHueSpread / 2 + verticalHueSpread / 2
      : baseHue;
    if (monoPalette) {
      const columnFactor = column / (gridSize - 1) - 0.5;
      const rowFactor = row / (gridSize - 1) - 0.5;
      const tileLightness = monoCenterLightness + columnFactor * horizontalLightnessSpread + rowFactor * verticalLightnessSpread + Math.floor(random() * 5) - 2;
      return `hsl(${startingHue}, ${monoSaturation}%, ${tileLightness}%)`;
    }
    const tileSaturation = saturation + Math.floor(random() * 7) - 3;
    const tileLightness = lightness + Math.floor(random() * 7) - 3;
    const rowSaturation = Math.max(30, tileSaturation - row * 2);
    const rowLightness = Math.min(84, tileLightness + row * 2);
    return `hsl(${hue}, ${rowSaturation}%, ${rowLightness}%)`;
  });
}

function hueDistance(firstHue, secondHue) {
  const distance = Math.abs((firstHue % 360) - (secondHue % 360));
  return Math.min(distance, 360 - distance);
}

function parseHsl(colour) {
  const [, h, s, l] = colour.match(/hsl\((-?[\d.]+), (-?[\d.]+)%, (-?[\d.]+)%\)/).map(Number);
  return { h, s, l };
}

function cornersAreDistinct() {
  const last = gridSize - 1;
  const corners = [0, last, last * gridSize, last * gridSize + last].map(index => parseHsl(palette[index]));
  for (let first = 0; first < corners.length; first += 1) {
    for (let second = first + 1; second < corners.length; second += 1) {
      const hueGap = hueDistance(corners[first].h, corners[second].h);
      const lightnessGap = Math.abs(corners[first].l - corners[second].l);
      if (hueGap < 18 && lightnessGap < 15) return false;
    }
  }
  return true;
}

function coloursAreSimilar(firstTarget, secondTarget) {
  const first = parseHsl(palette[firstTarget]);
  const second = parseHsl(palette[secondTarget]);
  return hueDistance(first.h, second.h) < 14 && Math.abs(first.l - second.l) < 10;
}

function countColourConflicts() {
  let conflicts = 0;
  for (let position = 0; position < getTotalTiles(); position += 1) {
    const row = Math.floor(position / gridSize);
    const column = position % gridSize;
    const neighbors = [];
    if (column < gridSize - 1) neighbors.push(position + 1);
    if (row < gridSize - 1) neighbors.push(position + gridSize);
    if (column < gridSize - 1 && row < gridSize - 1) neighbors.push(position + gridSize + 1);
    if (column > 0 && row < gridSize - 1) neighbors.push(position + gridSize - 1);
    neighbors.forEach(neighbor => {
      if (coloursAreSimilar(tiles[position].target, tiles[neighbor].target)) conflicts += 1;
    });
  }
  return conflicts;
}

function positionHasConflict(position) {
  const row = Math.floor(position / gridSize);
  const column = position % gridSize;
  const neighbors = [];
  if (column < gridSize - 1) neighbors.push(position + 1);
  if (column > 0) neighbors.push(position - 1);
  if (row < gridSize - 1) neighbors.push(position + gridSize);
  if (row > 0) neighbors.push(position - gridSize);
  if (column < gridSize - 1 && row < gridSize - 1) neighbors.push(position + gridSize + 1);
  if (column > 0 && row < gridSize - 1) neighbors.push(position + gridSize - 1);
  if (column < gridSize - 1 && row > 0) neighbors.push(position - gridSize + 1);
  if (column > 0 && row > 0) neighbors.push(position - gridSize - 1);
  return neighbors.some(neighbor => coloursAreSimilar(tiles[position].target, tiles[neighbor].target));
}

function reduceColourClusters(movablePositions) {
  let conflicts = countColourConflicts();
  const maxAttempts = Math.min(6000, movablePositions.length * 80);
  let attempts = 0;
  while (conflicts > 0 && attempts < maxAttempts) {
    attempts += 1;
    const conflicting = movablePositions.filter(positionHasConflict);
    if (conflicting.length === 0) break;
    const first = conflicting[Math.floor(random() * conflicting.length)];
    const second = movablePositions[Math.floor(random() * movablePositions.length)];
    if (first === second) continue;
    [tiles[first], tiles[second]] = [tiles[second], tiles[first]];
    if (isCorrect(tiles[first], first) || isCorrect(tiles[second], second)) {
      [tiles[first], tiles[second]] = [tiles[second], tiles[first]];
      continue;
    }
    const newConflicts = countColourConflicts();
    if (newConflicts <= conflicts) conflicts = newConflicts;
    else [tiles[first], tiles[second]] = [tiles[second], tiles[first]];
  }
}

function isCorrect(tile, position) {
  return tile.target === position;
}

function isLocked(position, tile = tiles[position]) {
  return fixedPositions.has(position) || isCorrect(tile, position);
}

function getCompletedLineAnimation(forceAll = false) {
  const animationSchedule = new Map();
  const { duration, stagger } = getCompletionTiming();
  let lineNumber = 0;
  const addLine = (positions, key) => {
    if (!positions.every(position => isCorrect(tiles[position], position))) return;
    if (!forceAll) {
      if (completedLines.has(key)) return;
      completedLines.add(key);
    }
    const lineDelay = lineNumber * (gridSize * stagger + duration);
    positions.forEach((position, index) => {
      const tileId = tiles[position].id;
      if (!animationSchedule.has(tileId)) animationSchedule.set(tileId, []);
      animationSchedule.get(tileId).push(lineDelay + index * stagger);
    });
    lineNumber += 1;
  };
  for (let row = 0; row < gridSize; row += 1) {
    addLine(Array.from({ length: gridSize }, (_, column) => row * gridSize + column), `row-${row}`);
  }
  for (let column = 0; column < gridSize; column += 1) {
    addLine(Array.from({ length: gridSize }, (_, row) => row * gridSize + column), `column-${column}`);
  }
  return animationSchedule;
}

function getCenterPulseAnimation() {
  const center = (gridSize - 1) / 2;
  const { duration, stagger } = getCompletionTiming();
  const lineDuration = gridSize * stagger + duration;
  const startDelay = gridSize * 2 * lineDuration;
  const positions = Array.from({ length: getTotalTiles() }, (_, position) => position)
    .sort((first, second) => {
      const firstDistance = Math.abs(first % gridSize - center) + Math.abs(Math.floor(first / gridSize) - center);
      const secondDistance = Math.abs(second % gridSize - center) + Math.abs(Math.floor(second / gridSize) - center);
      return firstDistance - secondDistance || first - second;
    });
  return new Map(positions.map((position, index) => [tiles[position].id, startDelay + index * stagger]));
}

function shuffleMovable() {
  let paletteAttempts = 0;
  do {
    generatePalette();
    paletteAttempts += 1;
  } while (!cornersAreDistinct() && paletteAttempts < 40);
  completedLines = new Set();
  const movable = Array.from({ length: getTotalTiles() }, (_, index) => index).filter(index => !fixedPositions.has(index));
  do {
    const values = movable.map(index => ({ id: index, target: index }));
    for (let index = values.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(random() * (index + 1));
      [values[index], values[randomIndex]] = [values[randomIndex], values[index]];
    }
    let movableIndex = 0;
    tiles = Array.from({ length: getTotalTiles() }, (_, index) => {
      if (fixedPositions.has(index)) return { id: index, target: index };
      return values[movableIndex++];
    });
  } while (tiles.some((tile, position) => !fixedPositions.has(position) && isCorrect(tile, position)));
  if (paletteMode !== 'mono') reduceColourClusters(movable);
}

function render(animate = false, animatedTileIds = null, animationOrder = new Map(), bounceTileIds = new Set(), centerPulseSchedule = new Map()) {
  const previousPositions = animate
    ? new Map(Array.from(board.querySelectorAll('.tile')).map(tile => [tile.dataset.id, tile.getBoundingClientRect()]))
    : new Map();
  board.innerHTML = '';
  let placed = 0;
  tiles.forEach((tile, position) => {
    const tileElement = document.createElement('button');
    const correct = isCorrect(tile, position);
    if (correct) placed += 1;
    tileElement.className = `tile${correct ? ' correct' : ''}${isLocked(position, tile) ? ' locked' : ''}${selectedId === tile.id ? ' selected' : ''}`;
    tileElement.style.backgroundColor = colourFor(tile.target);
    tileElement.dataset.id = tile.id;
    tileElement.dataset.position = position;
    tileElement.type = 'button';
    tileElement.draggable = false;
    tileElement.disabled = isLocked(position, tile);
    tileElement.style.gridRow = Math.floor(position / gridSize) + 1;
    tileElement.style.gridColumn = position % gridSize + 1;
    tileElement.setAttribute('aria-label', `Colour tile ${position + 1}, ${correct ? 'correct' : 'out of place'}`);
    tileElement.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      selectTile(tile.id, position);
    });
    tileElement.addEventListener('pointerdown', event => startPointerDrag(event, tile.id, position));
    tileElement.addEventListener('dragstart', event => startDrag(event, tile.id, position));
    tileElement.addEventListener('dragover', event => dragOver(event, position));
    tileElement.addEventListener('drop', event => dropTile(event, position));
    tileElement.addEventListener('dragend', endDrag);
    board.appendChild(tileElement);
    if (bounceTileIds.has(tile.id)) {
      tileElement.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.08)' },
          { transform: 'scale(.98)' },
          { transform: 'scale(1.02)' },
          { transform: 'scale(1)' }
        ],
        { duration: 520, easing: 'cubic-bezier(.2, .8, .2, 1)' }
      );
    }
    const shouldAnimate = animatedTileIds === null
      || (Array.isArray(animatedTileIds) ? animatedTileIds.includes(tile.id) : animatedTileIds === tile.id);
    if (animate && shouldAnimate && previousPositions.has(String(tile.id))) {
      const previousPosition = previousPositions.get(String(tile.id));
      const currentPosition = tileElement.getBoundingClientRect();
      const offsetX = previousPosition.left - currentPosition.left;
      const offsetY = previousPosition.top - currentPosition.top;
      const lineDelays = animationOrder.get(tile.id);
      const centerPulseDelay = centerPulseSchedule.get(tile.id);
      const isLineCelebration = lineDelays !== undefined;
      const isCenterPulse = centerPulseDelay !== undefined;
      if (offsetX || offsetY || isLineCelebration || isCenterPulse) {
        const keyframes = isLineCelebration || isCenterPulse
          ? [
              { transform: 'scale(1)', boxShadow: '0 0 0 rgba(255,255,255,0)' },
              { transform: 'scale(1.5)', boxShadow: '0 10px 22px rgba(255,255,255,.72), 0 0 26px rgba(255,255,255,.52)' },
              { transform: 'scale(1)', boxShadow: '0 0 0 rgba(255,255,255,0)' }
            ]
          : [
              { transform: `translate(${offsetX}px, ${offsetY}px)` },
              { transform: 'translate(0, 0)' }
            ];
        if (isLineCelebration) lineDelays.forEach(delay => tileElement.animate(
          keyframes,
          { duration: getCompletionTiming().duration, delay, easing: 'cubic-bezier(.2, .8, .2, 1)' }
        ));
        if (isCenterPulse) tileElement.animate(
          keyframes,
          { duration: getCompletionTiming().duration, delay: centerPulseDelay, easing: 'cubic-bezier(.2, .8, .2, 1)' }
        );
      }
    }
  });
  movesElement.textContent = moves;
  placedElement.textContent = placed;
  const finished = placed === getTotalTiles();
  statusText.textContent = finished ? 'A perfect spectrum' : `${getTotalTiles() - placed} colours to go`;
  placedElement.nextElementSibling.textContent = ` / ${getTotalTiles()}`;
  board.setAttribute('aria-label', `${gridSize} by ${gridSize} colour tile grid`);
  clearTimeout(completionRevealTimer);
  if (!finished) {
    completion.hidden = true;
  } else {
    const celebrationDelays = [...centerPulseSchedule.values()];
    const celebrationEnd = celebrationDelays.length ? Math.max(...celebrationDelays) + getCompletionTiming().duration : 0;
    completion.hidden = true;
    if (completionStatsElement) completionStatsElement.textContent = formatCompletionStats();
    completionRevealTimer = setTimeout(() => { completion.hidden = false; }, celebrationEnd);
  }
}

function selectTile(id, position) {
  if (isLocked(position)) return;
  if (selectedId === null) {
    selectedId = id;
  } else if (selectedId === id) {
    selectedId = null;
  } else {
    const first = tiles.findIndex(tile => tile.id === selectedId);
    const swappedTileIds = [selectedId, id];
    const previouslyCorrect = new Set(tiles.map((tile, tilePosition) => isCorrect(tile, tilePosition) ? tile.id : null).filter(tileId => tileId !== null));
    [tiles[first], tiles[position]] = [tiles[position], tiles[first]];
    const bounceTileIds = new Set(tiles.filter((tile, tilePosition) => isCorrect(tile, tilePosition) && !previouslyCorrect.has(tile.id)).map(tile => tile.id));
    selectedId = null;
    moves += 1;
    const completedLine = getCompletedLineAnimation();
    const finalCelebration = tiles.every((tile, tilePosition) => isCorrect(tile, tilePosition))
      ? getCompletedLineAnimation(true)
      : completedLine;
    const centerPulse = tiles.every((tile, tilePosition) => isCorrect(tile, tilePosition)) ? getCenterPulseAnimation() : new Map();
    render(true, finalCelebration.size ? [...finalCelebration.keys()] : swappedTileIds, finalCelebration, bounceTileIds, centerPulse);
    return;
  }
  render();
}

function startDrag(event, id, position) {
  if (isLocked(position)) { event.preventDefault(); return; }
  draggedId = id;
  dragStartPosition = position;
  dragPreviewPosition = position;
  event.currentTarget.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(id));
}

function startPointerDrag(event, id, position) {
  if (isLocked(position, tiles[position])) return;
  draggedId = id;
  dragStartPosition = position;
  dragPreviewPosition = position;
  pointerDragId = event.pointerId;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  pointerDragActive = false;
  event.currentTarget.setPointerCapture(event.pointerId);
}

function updateDragPreview(position) {
  if (draggedId === null || position === null || isLocked(position) || dragPreviewPosition === position || !dragPlaceholder) return;
  const movablePositions = tiles.map((tile, index) => index).filter(index => !isLocked(index, tiles[index]));
  const toIndex = movablePositions.indexOf(position);
  if (toIndex === -1) return;
  const movableElements = movablePositions
    .map(slot => board.querySelector(`.tile[data-position="${slot}"]`))
    .filter(element => element && element.dataset.id !== String(draggedId));
  const previousRects = new Map(movableElements.map(element => [element, element.getBoundingClientRect()]));
  movableElements.splice(toIndex, 0, dragPlaceholder);
  movableElements.forEach((element, index) => {
    if (element === dragPlaceholder) {
      setGridPosition(element, movablePositions[index]);
      return;
    }
    setGridPosition(element, movablePositions[index]);
    const previousRect = previousRects.get(element);
    const currentRect = element.getBoundingClientRect();
    const offsetX = previousRect.left - currentRect.left;
    const offsetY = previousRect.top - currentRect.top;
    if (offsetX || offsetY) {
      element.getAnimations().forEach(animation => animation.cancel());
      element.animate(
        [{ transform: `translate(${offsetX}px, ${offsetY}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 520, easing: 'cubic-bezier(.2, .8, .2, 1)' }
      );
    }
  });
  dragPreviewPosition = position;
}

function setGridPosition(element, position) {
  element.style.gridRow = Math.floor(position / gridSize) + 1;
  element.style.gridColumn = position % gridSize + 1;
}

function clearDragPreview() {
  tiles.forEach((tile, position) => {
    const tileElement = board.querySelector(`.tile[data-id="${tile.id}"]`);
    if (tileElement && tile.id !== draggedId) setGridPosition(tileElement, position);
  });
  if (dragPlaceholder) setGridPosition(dragPlaceholder, dragStartPosition);
  dragPreviewPosition = null;
}

function getPositionAtPoint(clientX, clientY) {
  const boardBounds = board.getBoundingClientRect();
  if (clientX < boardBounds.left || clientX > boardBounds.right || clientY < boardBounds.top || clientY > boardBounds.bottom) return null;
  const innerSize = boardBounds.width - 10;
  const column = Math.max(0, Math.min(gridSize - 1, Math.floor((clientX - boardBounds.left - 5) / (innerSize / gridSize))));
  const row = Math.max(0, Math.min(gridSize - 1, Math.floor((clientY - boardBounds.top - 5) / (innerSize / gridSize))));
  return row * gridSize + column;
}

document.addEventListener('pointermove', event => {
  if (draggedId === null || event.pointerId !== pointerDragId) return;
  const distance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);
  if (!pointerDragActive && distance > 2) {
    pointerDragActive = true;
    suppressClick = true;
    document.body.classList.add('is-dragging');
    draggedElement = board.querySelector(`.tile[data-id="${draggedId}"]`);
    if (draggedElement) {
      const bounds = draggedElement.getBoundingClientRect();
      draggedElement.classList.add('dragging');
      dragPlaceholder = document.createElement('div');
      dragPlaceholder.className = 'drag-placeholder';
      board.appendChild(dragPlaceholder);
      setGridPosition(dragPlaceholder, dragStartPosition);
      draggedElement.style.width = `${bounds.width}px`;
      draggedElement.style.height = `${bounds.height}px`;
    }
  }
  if (!pointerDragActive) return;
  if (draggedElement) {
    draggedElement.style.left = `${event.clientX}px`;
    draggedElement.style.top = `${event.clientY}px`;
  }
  const position = getPositionAtPoint(event.clientX, event.clientY);
  if (position === null) clearDragPreview();
  if (position !== null) updateDragPreview(position);
});

document.addEventListener('pointerup', event => {
  if (draggedId === null || event.pointerId !== pointerDragId) return;
  const position = getPositionAtPoint(event.clientX, event.clientY);
  if (pointerDragActive && position !== null) moveDraggedTile(position);
  endDrag();
});

function dragOver(event, position) {
  event.preventDefault();
  if (draggedId === null || isLocked(position)) return;
  event.dataTransfer.dropEffect = 'move';
  if (dragPreviewPosition === position) return;
  const toIndex = movablePositions.indexOf(position);
  if (fromIndex === -1 || toIndex === -1) return;
  const horizontalDirection = Math.sign((position % gridSize) - (dragStartPosition % gridSize));
  const verticalDirection = Math.sign(Math.floor(position / gridSize) - Math.floor(dragStartPosition / gridSize));
  const useVerticalShift = verticalDirection !== 0 && horizontalDirection === 0;
  document.querySelectorAll('.tile').forEach(tileElement => {
    const tilePosition = Number(tileElement.dataset.position);
    const tileIndex = movablePositions.indexOf(tilePosition);
    let shift = 0;
    if (fromIndex < toIndex && tileIndex > fromIndex && tileIndex <= toIndex) shift = -1;
    if (fromIndex > toIndex && tileIndex >= toIndex && tileIndex < fromIndex) shift = 1;
    tileElement.style.setProperty('--drag-shift-x', useVerticalShift ? 0 : shift);
    tileElement.style.setProperty('--drag-shift-y', useVerticalShift ? shift : 0);
  });
  dragPreviewPosition = position;
}

function dropTile(event, position) {
  event.preventDefault();
  moveDraggedTile(position);
}

function moveDraggedTile(position) {
  if (draggedId === null || isLocked(position)) return;
  const from = tiles.findIndex(tile => tile.id === draggedId);
  if (from === -1 || isLocked(from, tiles[from])) return;
  if (from === position) return;
  const movablePositions = tiles.map((tile, index) => index).filter(index => !isLocked(index, tiles[index]));
  const fromIndex = movablePositions.indexOf(from);
  const toIndex = movablePositions.indexOf(position);
  const movableTiles = movablePositions.map(index => tiles[index]);
  const movedTileId = draggedId;
  const previouslyCorrect = new Set(tiles.map((tile, tilePosition) => isCorrect(tile, tilePosition) ? tile.id : null).filter(tileId => tileId !== null));
  const [moved] = movableTiles.splice(fromIndex, 1);
  movableTiles.splice(toIndex, 0, moved);
  movablePositions.forEach((slot, index) => { tiles[slot] = movableTiles[index]; });
  const bounceTileIds = new Set(tiles.filter((tile, tilePosition) => isCorrect(tile, tilePosition) && !previouslyCorrect.has(tile.id)).map(tile => tile.id));
  moves += 1;
  draggedId = null;
  selectedId = null;
  const completedLine = getCompletedLineAnimation();
  const finalCelebration = tiles.every((tile, tilePosition) => isCorrect(tile, tilePosition))
    ? getCompletedLineAnimation(true)
    : completedLine;
  const centerPulse = tiles.every((tile, tilePosition) => isCorrect(tile, tilePosition)) ? getCenterPulseAnimation() : new Map();
  render(true, finalCelebration.size ? [...finalCelebration.keys()] : movedTileId, finalCelebration, bounceTileIds, centerPulse);
}

function endDrag() {
  draggedId = null;
  dragStartPosition = null;
  dragPreviewPosition = null;
  pointerDragActive = false;
  pointerDragId = null;
  draggedElement = null;
  if (dragPlaceholder) dragPlaceholder.remove();
  dragPlaceholder = null;
  document.body.classList.remove('is-dragging');
  document.querySelectorAll('.tile').forEach(tile => {
    tile.classList.remove('dragging');
    tile.style.removeProperty('transform');
    tile.style.removeProperty('position');
    tile.style.removeProperty('left');
    tile.style.removeProperty('top');
    tile.style.removeProperty('width');
    tile.style.removeProperty('height');
  });
}

document.getElementById('reset-button').addEventListener('click', () => {
  startNewGame();
});

// document.getElementById('solve-button').addEventListener('click', () => {
//   selectedId = null;
//   draggedId = null;
//   completedLines = new Set();
//   tiles = Array.from({ length: getTotalTiles() }, (_, index) => ({ id: index, target: index }));
//   const finalCelebration = getCompletedLineAnimation(true);
//   const centerPulse = getCenterPulseAnimation();
//   render(true, [...finalCelebration.keys()], finalCelebration, new Set(), centerPulse);
// });

document.getElementById('completion-restart').addEventListener('click', () => {
  startNewGame();
});

document.getElementById('completion-view').addEventListener('click', () => {
  clearTimeout(completionRevealTimer);
  completion.hidden = true;
});

function startNewGame() {
  applyPuzzleState(gridSize, paletteMode, Math.floor(Math.random() * 0xffffffff));
}

document.getElementById('size-options').addEventListener('click', event => {
  const button = event.target.closest('[data-size]');
  if (!button) return;
  const newSize = Number(button.dataset.size);
  if (newSize === gridSize) return;
  applyPuzzleState(newSize, paletteMode, Math.floor(Math.random() * 0xffffffff));
});

document.getElementById('theme-options').addEventListener('click', event => {
  const button = event.target.closest('[data-theme]');
  if (!button) return;
  document.body.dataset.theme = button.dataset.theme;
  localStorage.setItem('spectrum-theme', button.dataset.theme);
  document.querySelectorAll('[data-theme]').forEach(option => option.classList.toggle('active', option === button));
});

document.getElementById('palette-options').addEventListener('click', event => {
  const button = event.target.closest('[data-palette]');
  if (!button) return;
  const newPaletteMode = button.dataset.palette;
  if (newPaletteMode === paletteMode) return;
  applyPuzzleState(gridSize, newPaletteMode, Math.floor(Math.random() * 0xffffffff));
});

document.getElementById('seed-copy').addEventListener('click', () => {
  const seedField = document.getElementById('seed-code');
  seedField.select();
  navigator.clipboard?.writeText(seedField.value).catch(() => {});
});

document.getElementById('seed-load').addEventListener('click', () => {
  const seedInput = document.getElementById('seed-input');
  const decoded = decodeSeedCode(seedInput.value);
  if (!decoded) return;
  applyPuzzleState(decoded.size, decoded.mode, decoded.seedValue);
  seedInput.value = '';
});

document.getElementById('settings-toggle').addEventListener('click', event => {
  const button = event.currentTarget;
  const panel = document.getElementById('settings-panel');
  const isOpen = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!isOpen));
  button.title = isOpen ? 'Open settings' : 'Close settings';
  panel.hidden = isOpen;
});

document.addEventListener('click', event => {
  const toggle = document.getElementById('settings-toggle');
  const panel = document.getElementById('settings-panel');
  if (panel.hidden || toggle.contains(event.target) || panel.contains(event.target)) return;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.title = 'Open settings';
  panel.hidden = true;
});

  if (['obsidian', 'midnight', 'ember', 'terminal', 'mint', 'coral', 'newspaper'].includes(storedTheme)) {
  document.body.dataset.theme = storedTheme;
  document.querySelectorAll('[data-theme]').forEach(option => option.classList.toggle('active', option.dataset.theme === storedTheme));
}
const sharedSeed = decodeSeedCode(new URLSearchParams(window.location.search).get('seed'));
if (sharedSeed) {
  applyPuzzleState(sharedSeed.size, sharedSeed.mode, sharedSeed.seedValue);
} else {
  applyPuzzleState(gridSize, paletteMode, rngSeedValue);
}
