const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const phaseLabel = document.getElementById("phaseLabel");
const statusLabel = document.getElementById("statusLabel");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");
const restartButton = document.getElementById("restartButton");

const WORLD_WIDTH = 3600;
const WORLD_HEIGHT = 720;
const GROUND_Y = 585;
const PLAYER_WIDTH = 34;
const PLAYER_HEIGHT = 60;
const CAMERA_LERP = 0.1;

const CONFIG = {
  playerSpeed: 260,
  ropeMaxLength: 180,
  minDistance: 34,
  finishLineX: 3430,
  levelLength: WORLD_WIDTH,
  warningDuration: 1.1,
  dropFallSpeed: 560,
  spikeWarningDuration: 0.85,
  spikeActiveDuration: 1.2,
  spikeCooldownDuration: 1.5,
  platformSpeed: 110,
};

const keys = new Set();

const stageDefinitions = [
  {
    name: "阶段 1 / 4",
    drops: [
      { x: 500, delay: 0.4 },
      { x: 780, delay: 1.7 },
      { x: 980, delay: 0.9 },
      { x: 1250, delay: 1.1 },
    ],
    spikes: [],
    pits: [],
  },
  {
    name: "阶段 2 / 4",
    drops: [
      { x: 1540, delay: 0.5 },
      { x: 1770, delay: 1.4 },
      { x: 1990, delay: 0.8 },
    ],
    spikes: [
      { x: 1650, width: 90, cycleOffset: 0.1 },
      { x: 1880, width: 80, cycleOffset: 0.8 },
      { x: 2120, width: 100, cycleOffset: 0.35 },
    ],
    pits: [],
  },
  {
    name: "阶段 3 / 4",
    drops: [],
    spikes: [
      { x: 2440, width: 90, cycleOffset: 0.2 },
    ],
    pits: [
      { x: 2560, width: 250, platformWidth: 100, moveRangeStart: 2580, moveRangeEnd: 2710, phase: 0 },
      { x: 2890, width: 230, platformWidth: 90, moveRangeStart: 2910, moveRangeEnd: 3030, phase: 0.5 },
    ],
  },
  {
    name: "阶段 4 / 4",
    drops: [
      { x: 3160, delay: 0.4 },
      { x: 3280, delay: 1.25 },
    ],
    spikes: [
      { x: 3090, width: 90, cycleOffset: 0.6 },
    ],
    pits: [
      { x: 3205, width: 150, platformWidth: 84, moveRangeStart: 3215, moveRangeEnd: 3280, phase: 0.15 },
    ],
  },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function createPlayer(id, color, x, controls) {
  return {
    id,
    color,
    x,
    y: GROUND_Y - PLAYER_HEIGHT,
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT,
    speed: 0,
    isAlive: true,
    isOnPlatform: false,
    reachedFinish: false,
    controls,
  };
}

function createGame() {
  const players = [
    createPlayer("A", "#227c9d", 100, { left: "KeyA", right: "KeyD" }),
    createPlayer("B", "#ef476f", 180, { left: "ArrowLeft", right: "ArrowRight" }),
  ];

  const drops = stageDefinitions.flatMap((stage) =>
    stage.drops.map((drop) => ({
      type: "drop",
      x: drop.x,
      y: -80,
      width: 58,
      height: 58,
      warningDuration: CONFIG.warningDuration,
      delay: drop.delay,
      timer: 0,
      state: "warning",
      hitRange: 42,
      settledTimer: 0,
    }))
  );

  const spikes = stageDefinitions.flatMap((stage) =>
    stage.spikes.map((spike) => ({
      type: "spike",
      x: spike.x,
      y: GROUND_Y - 10,
      width: spike.width,
      height: 24,
      timer: spike.cycleOffset,
      state: "warning",
    }))
  );

  const movingPlatforms = stageDefinitions.flatMap((stage) =>
    stage.pits.map((pit, index) => ({
      type: "platform",
      id: `${pit.x}-${index}`,
      pitX: pit.x,
      pitWidth: pit.width,
      x: pit.moveRangeStart + (pit.moveRangeEnd - pit.moveRangeStart - pit.platformWidth) * pit.phase,
      y: GROUND_Y - 18,
      width: pit.platformWidth,
      height: 18,
      moveRangeStart: pit.moveRangeStart,
      moveRangeEnd: pit.moveRangeEnd,
      moveSpeed: CONFIG.platformSpeed,
      direction: 1,
      phase: pit.phase,
    }))
  );

  const lavaPits = stageDefinitions.flatMap((stage) =>
    stage.pits.map((pit) => ({
      x: pit.x,
      width: pit.width,
    }))
  );

  return {
    players,
    obstacles: drops,
    spikes,
    movingPlatforms,
    lavaPits,
    gameState: "playing",
    levelLength: CONFIG.levelLength,
    finishLineX: CONFIG.finishLineX,
    cameraX: 0,
    elapsed: 0,
    failureReason: "",
  };
}

let game = createGame();
let lastTime = performance.now();

function getCurrentPhaseName() {
  const progress = Math.max(game.players[0].x, game.players[1].x);

  if (progress < 1400) return stageDefinitions[0].name;
  if (progress < 2400) return stageDefinitions[1].name;
  if (progress < 3080) return stageDefinitions[2].name;
  return stageDefinitions[3].name;
}

function getInputAxis(player) {
  const left = keys.has(player.controls.left) ? -1 : 0;
  const right = keys.has(player.controls.right) ? 1 : 0;
  return left + right;
}

function solveRopePositions(nextPositions) {
  let [nextA, nextB] = nextPositions;

  const intendedDistance = Math.abs(nextA - nextB);
  if (intendedDistance > CONFIG.ropeMaxLength) {
    if (nextA > nextB) {
      nextA = clamp(nextA, nextB + CONFIG.minDistance, nextB + CONFIG.ropeMaxLength);
      nextB = Math.max(nextB, nextA - CONFIG.ropeMaxLength);
    } else {
      nextB = clamp(nextB, nextA + CONFIG.minDistance, nextA + CONFIG.ropeMaxLength);
      nextA = Math.max(nextA, nextB - CONFIG.ropeMaxLength);
    }
  }

  if (Math.abs(nextA - nextB) < CONFIG.minDistance) {
    const midpoint = (nextA + nextB) / 2;
    nextA = midpoint - CONFIG.minDistance / 2;
    nextB = midpoint + CONFIG.minDistance / 2;
  }

  const worldMin = 24;
  const worldMax = game.levelLength - 24 - PLAYER_WIDTH;
  return [
    clamp(nextA, worldMin, worldMax),
    clamp(nextB, worldMin, worldMax),
  ];
}

function updatePlayers(deltaTime) {
  for (const player of game.players) {
    if (!player.isAlive || player.reachedFinish) {
      player.speed = 0;
      continue;
    }

    const input = getInputAxis(player);
    player.speed = input * CONFIG.playerSpeed;
  }

  const [nextA, nextB] = solveRopePositions(
    game.players.map((player) => player.x + player.speed * deltaTime)
  );

  game.players[0].x = nextA;
  game.players[1].x = nextB;
}

function updateDrops(deltaTime) {
  for (const drop of game.obstacles) {
    if (drop.state === "done") {
      continue;
    }

    drop.timer += deltaTime;

    if (drop.state === "warning") {
      if (drop.timer >= drop.warningDuration + drop.delay) {
        drop.state = "falling";
        drop.timer = 0;
      }
      continue;
    }

    if (drop.state === "falling") {
      drop.y += CONFIG.dropFallSpeed * deltaTime;
      if (drop.y + drop.height >= GROUND_Y) {
        drop.y = GROUND_Y - drop.height;
        drop.state = "settled";
        drop.timer = 0;
      }
      continue;
    }

    if (drop.state === "settled") {
      drop.settledTimer += deltaTime;
      if (drop.settledTimer > 0.8) {
        drop.state = "done";
      }
    }
  }
}

function updateSpikes(deltaTime) {
  const fullCycle = CONFIG.spikeWarningDuration + CONFIG.spikeActiveDuration + CONFIG.spikeCooldownDuration;

  for (const spike of game.spikes) {
    spike.timer = (spike.timer + deltaTime) % fullCycle;

    if (spike.timer < CONFIG.spikeWarningDuration) {
      spike.state = "warning";
    } else if (spike.timer < CONFIG.spikeWarningDuration + CONFIG.spikeActiveDuration) {
      spike.state = "active";
    } else {
      spike.state = "cooldown";
    }
  }
}

function updatePlatforms(deltaTime) {
  for (const platform of game.movingPlatforms) {
    const motion = platform.moveSpeed * deltaTime * platform.direction;
    platform.x += motion;

    if (platform.x <= platform.moveRangeStart) {
      platform.x = platform.moveRangeStart;
      platform.direction = 1;
    }

    if (platform.x + platform.width >= platform.moveRangeEnd) {
      platform.x = platform.moveRangeEnd - platform.width;
      platform.direction = -1;
    }
  }

  for (const player of game.players) {
    player.isOnPlatform = false;

    for (const platform of game.movingPlatforms) {
      const standingHorizontally =
        player.x + player.width > platform.x &&
        player.x < platform.x + platform.width;
      const inPlatformZone = Math.abs(player.y + player.height - platform.y) < 20;

      if (standingHorizontally && inPlatformZone && player.x + player.width / 2 > platform.pitX && player.x + player.width / 2 < platform.pitX + platform.pitWidth) {
        player.isOnPlatform = true;
        player.y = platform.y - player.height;
        player.x += platform.moveSpeed * deltaTime * platform.direction;
      }
    }

    if (!player.isOnPlatform) {
      player.y = GROUND_Y - player.height;
    }
  }

  const [nextA, nextB] = solveRopePositions(game.players.map((player) => player.x));
  game.players[0].x = nextA;
  game.players[1].x = nextB;
}

function killPlayer(player, reason) {
  if (!player.isAlive) return;
  player.isAlive = false;
  game.gameState = "failed";
  game.failureReason = `${player.id} 号角色${reason}`;
  statusLabel.textContent = "失败";
  overlay.classList.remove("hidden");
  overlayTitle.textContent = "挑战失败";
  overlayText.textContent = game.failureReason;
}

function checkCollisions() {
  for (const player of game.players) {
    if (!player.isAlive) continue;

    const playerRect = { x: player.x, y: player.y, width: player.width, height: player.height };

    for (const drop of game.obstacles) {
      if (drop.state !== "falling" && drop.state !== "settled") continue;
      const dropRect = { x: drop.x - drop.width / 2, y: drop.y, width: drop.width, height: drop.height };
      if (rectsOverlap(playerRect, dropRect)) {
        killPlayer(player, "被掉落障碍砸中了");
        return;
      }
    }

    for (const spike of game.spikes) {
      if (spike.state !== "active") continue;
      const spikeRect = { x: spike.x, y: GROUND_Y - 18, width: spike.width, height: 18 };
      if (rectsOverlap(playerRect, spikeRect)) {
        killPlayer(player, "踩到了激活状态的钉刺");
        return;
      }
    }

    for (const pit of game.lavaPits) {
      const centerX = player.x + player.width / 2;
      if (centerX > pit.x && centerX < pit.x + pit.width && !player.isOnPlatform) {
        killPlayer(player, "掉进了岩浆");
        return;
      }
    }

    if (player.x + player.width >= game.finishLineX) {
      player.reachedFinish = true;
    }
  }

  if (game.players.every((player) => player.reachedFinish && player.isAlive)) {
    game.gameState = "won";
    statusLabel.textContent = "胜利";
    overlay.classList.remove("hidden");
    overlayTitle.textContent = "通关成功";
    overlayText.textContent = "两名角色都抵达了终点。";
  }
}

function updateCamera() {
  const midpoint = (game.players[0].x + game.players[1].x) / 2;
  const target = clamp(midpoint - canvas.width / 2, 0, game.levelLength - canvas.width);
  game.cameraX += (target - game.cameraX) * CAMERA_LERP;
}

function update(deltaTime) {
  if (game.gameState !== "playing") {
    return;
  }

  game.elapsed += deltaTime;
  updatePlayers(deltaTime);
  updateDrops(deltaTime);
  updateSpikes(deltaTime);
  updatePlatforms(deltaTime);
  checkCollisions();
  updateCamera();

  phaseLabel.textContent = getCurrentPhaseName();
  statusLabel.textContent = "进行中";
}

function drawBackground() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-game.cameraX, 0);

  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 16; i += 1) {
    const x = 120 + i * 230;
    ctx.beginPath();
    ctx.ellipse(x, 120 + (i % 3) * 18, 68, 28, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#d9b07a";
  ctx.fillRect(0, GROUND_Y, game.levelLength, WORLD_HEIGHT - GROUND_Y);
  ctx.fillStyle = "#7a533d";
  ctx.fillRect(0, GROUND_Y - 18, game.levelLength, 18);

  for (const pit of game.lavaPits) {
    ctx.clearRect(pit.x, GROUND_Y - 18, pit.width, WORLD_HEIGHT - (GROUND_Y - 18));
    ctx.fillStyle = "#39251e";
    ctx.fillRect(pit.x, GROUND_Y - 2, pit.width, 6);
    ctx.fillStyle = "#ff6138";
    ctx.fillRect(pit.x, GROUND_Y + 4, pit.width, 110);
    ctx.fillStyle = "rgba(255, 185, 74, 0.35)";
    for (let x = pit.x + 8; x < pit.x + pit.width - 12; x += 28) {
      ctx.beginPath();
      ctx.arc(x, GROUND_Y + 30 + ((x / 9) % 4) * 9, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = "#f8f4ec";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(game.finishLineX, GROUND_Y - 150);
  ctx.lineTo(game.finishLineX, GROUND_Y);
  ctx.stroke();

  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? "#ff8c42" : "#ffffff";
    ctx.fillRect(game.finishLineX, GROUND_Y - 150 + i * 18, 48, 18);
  }

  ctx.restore();
}

function drawDrops() {
  for (const drop of game.obstacles) {
    if (drop.state === "done") continue;

    const x = drop.x - game.cameraX;

    if (drop.state === "warning") {
      const pulse = 0.5 + Math.sin((drop.timer + drop.delay) * 8) * 0.18;
      ctx.fillStyle = `rgba(214, 40, 57, ${0.25 + pulse * 0.35})`;
      ctx.beginPath();
      ctx.ellipse(x, GROUND_Y - 6, drop.hitRange, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(214, 40, 57, 0.45)";
      ctx.fillRect(x - 3, 92, 6, 48);
      continue;
    }

    ctx.fillStyle = "#7f5539";
    ctx.fillRect(x - drop.width / 2, drop.y, drop.width, drop.height);
    ctx.fillStyle = "#5e3d2b";
    ctx.fillRect(x - drop.width / 2 + 6, drop.y + 8, drop.width - 12, 10);
  }
}

function drawSpikes() {
  for (const spike of game.spikes) {
    const x = spike.x - game.cameraX;
    if (spike.state === "warning") {
      ctx.fillStyle = "rgba(214, 40, 57, 0.22)";
      ctx.fillRect(x, GROUND_Y - 12, spike.width, 12);
      ctx.strokeStyle = "rgba(214, 40, 57, 0.8)";
      ctx.strokeRect(x, GROUND_Y - 12, spike.width, 12);
      continue;
    }

    if (spike.state === "cooldown") {
      ctx.fillStyle = "#8d99ae";
      ctx.fillRect(x, GROUND_Y - 5, spike.width, 5);
      continue;
    }

    ctx.fillStyle = "#d62839";
    const toothCount = Math.floor(spike.width / 18);
    for (let i = 0; i < toothCount; i += 1) {
      const toothX = x + i * 18;
      ctx.beginPath();
      ctx.moveTo(toothX, GROUND_Y);
      ctx.lineTo(toothX + 9, GROUND_Y - 22);
      ctx.lineTo(toothX + 18, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawPlatforms() {
  for (const platform of game.movingPlatforms) {
    const x = platform.x - game.cameraX;
    ctx.fillStyle = "#4d908e";
    ctx.fillRect(x, platform.y, platform.width, platform.height);
    ctx.fillStyle = "#2a6f6d";
    ctx.fillRect(x + 6, platform.y + 4, platform.width - 12, 5);
  }
}

function drawPlayers() {
  const [playerA, playerB] = game.players;
  const ropeStartX = playerA.x + playerA.width / 2 - game.cameraX;
  const ropeEndX = playerB.x + playerB.width / 2 - game.cameraX;
  const ropeY = playerA.y + 20;

  ctx.strokeStyle = "#a98467";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(ropeStartX, ropeY);
  ctx.quadraticCurveTo((ropeStartX + ropeEndX) / 2, ropeY + 20, ropeEndX, playerB.y + 20);
  ctx.stroke();

  for (const player of game.players) {
    const x = player.x - game.cameraX;
    ctx.fillStyle = player.color;
    ctx.fillRect(x, player.y, player.width, player.height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillRect(x + 8, player.y + 10, player.width - 16, 10);
    if (player.reachedFinish) {
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 4, player.y - 4, player.width + 8, player.height + 8);
    }
  }
}

function drawRopeMeter() {
  const distance = Math.abs(game.players[0].x - game.players[1].x);
  const ratio = distance / CONFIG.ropeMaxLength;
  const barWidth = 240;
  const barHeight = 16;
  const x = canvas.width - barWidth - 30;
  const y = 28;

  ctx.fillStyle = "rgba(32, 48, 71, 0.15)";
  ctx.fillRect(x, y, barWidth, barHeight);
  ctx.fillStyle = ratio > 0.82 ? "#d62839" : "#a98467";
  ctx.fillRect(x, y, barWidth * clamp(ratio, 0, 1), barHeight);
  ctx.strokeStyle = "rgba(32, 48, 71, 0.22)";
  ctx.strokeRect(x, y, barWidth, barHeight);

  ctx.fillStyle = "#203047";
  ctx.font = "16px Microsoft YaHei UI";
  ctx.fillText(`绳长 ${Math.round(distance)} / ${CONFIG.ropeMaxLength}`, x, y - 8);
}

function draw() {
  drawBackground();
  drawDrops();
  drawSpikes();
  drawPlatforms();
  drawPlayers();
  drawRopeMeter();
}

function frame(time) {
  const deltaTime = Math.min((time - lastTime) / 1000, 0.033);
  lastTime = time;
  update(deltaTime);
  draw();
  requestAnimationFrame(frame);
}

function resetGame() {
  game = createGame();
  overlay.classList.add("hidden");
  statusLabel.textContent = "进行中";
  phaseLabel.textContent = stageDefinitions[0].name;
  lastTime = performance.now();
}

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

restartButton.addEventListener("click", resetGame);

phaseLabel.textContent = stageDefinitions[0].name;
requestAnimationFrame(frame);
