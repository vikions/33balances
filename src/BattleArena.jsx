import { useCallback, useEffect, useRef, useState } from "react";

const CHARACTER_POOL = [
  {
    id: "trump",
    name: "Donald Trump",
    description: "45th & 47th President",
    image: "/battle/characters/trump.png",
  },
  {
    id: "cz",
    name: "CZ (Changpeng Zhao)",
    description: "Former Binance CEO",
    image: "/battle/characters/cz.png",
  },
  {
    id: "elon-musk",
    name: "Elon Musk",
    description: "Tesla & SpaceX CEO",
    image: "/battle/characters/elon-mask.png",
  },
  {
    id: "satoshi",
    name: "Satoshi Nakamoto",
    description: "Bitcoin Creator",
    image: "/battle/characters/satoshi.png",
  },
  {
    id: "vitalik",
    name: "Vitalik Buterin",
    description: "Ethereum Co-Founder",
    image: "/battle/characters/vitalik.png",
  },
  {
    id: "sbf",
    name: "Sam Bankman-Fried",
    description: "FTX Founder",
    image: "/battle/characters/sbf.png",
  },
  {
    id: "michael-saylor",
    name: "Michael Saylor",
    description: "MicroStrategy CEO",
    image: "/battle/characters/michael-saylor.png",
  },
  {
    id: "gary-gensler",
    name: "Gary Gensler",
    description: "Former SEC Chair",
    image: "/battle/characters/gary-gensler.png",
  },
  {
    id: "jerome-powell",
    name: "Jerome Powell",
    description: "Federal Reserve Chair",
    image: "/battle/characters/jerome-powell.png",
  },
  {
    id: "kanye-west",
    name: "Kanye West (Ye)",
    description: "Crypto Enthusiast",
    image: "/battle/characters/kanye-west.png",
  },
];

const COINS = [
  {
    id: "btc",
    name: "Bitcoin",
    label: "BTC",
    color: "#f7931a",
    icon: "/battle/coins/btc.svg",
    symbol: "BTC",
  },
  {
    id: "eth",
    name: "Ethereum",
    label: "ETH",
    color: "#627eea",
    icon: "/battle/coins/eth.svg",
    symbol: "ETH",
  },
  {
    id: "sol",
    name: "Solana",
    label: "SOL",
    color: "#14f195",
    icon: "/battle/coins/sol.svg",
    symbol: "SOL",
  },
  {
    id: "doge",
    name: "Dogecoin",
    label: "DOGE",
    color: "#c2a633",
    icon: "/battle/coins/doge.svg",
    symbol: "DOGE",
  },
  {
    id: "base",
    name: "Base",
    label: "BASE",
    color: "#0052ff",
    icon: "/battle/coins/base.svg",
    symbol: "BASE",
  },
];

const MAX_LIVES = 5;
const BALL_SIZE = 58;
const BALL_RADIUS = BALL_SIZE / 2;
const COIN_SIZE = 34;
const COIN_RADIUS = COIN_SIZE / 2;
const PLAYER_RING = "#4b6bff";
const OPPONENT_RING = "#ff4b6b";
const PLAYER_MAX_SPEED = 2.6;
const OPPONENT_MAX_SPEED = 2.2;
const CONTROL_SPEED = 3.0;
const COIN_HOLD_DURATION = 6000;
const COIN_RESPAWN_DELAY = 2000;
const INTRO_DURATION = 1400;

export default function BattleArenaScreen({ onEnterMatch, onShareResult }) {
  const [entryStatus, setEntryStatus] = useState({
    loading: false,
    message: "",
  });
  const [phase, setPhase] = useState("select");
  const [player, setPlayer] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [playerLives, setPlayerLives] = useState(MAX_LIVES);
  const [opponentLives, setOpponentLives] = useState(MAX_LIVES);
  const [winner, setWinner] = useState(null);
  const [roundId, setRoundId] = useState(0);
  const [fieldSize, setFieldSize] = useState({ width: 0, height: 0 });
  const [coinState, setCoinState] = useState({
    owner: null,
    active: false,
    type: COINS[0],
    position: { x: 0, y: 0 },
  });

  const fieldRef = useRef(null);
  const playerRef = useRef(null);
  const opponentRef = useRef(null);
  const coinRef = useRef(null);
  const runningRef = useRef(false);
  const introTimerRef = useRef(null);
  const controlRef = useRef({
    active: false,
    targetX: 0,
    targetY: 0,
    pointerId: null,
  });
  const positionsRef = useRef({
    player: { x: 0, y: 0, vx: 0, vy: 0 },
    opponent: { x: 0, y: 0, vx: 0, vy: 0 },
  });
  const coinStateRef = useRef({
    owner: null,
    active: false,
    type: COINS[0],
    position: { x: 0, y: 0 },
    respawnAt: 0,
    ownerExpiresAt: 0,
  });
  const playerLivesRef = useRef(MAX_LIVES);
  const opponentLivesRef = useRef(MAX_LIVES);
  const hitCooldownRef = useRef(0);

  useEffect(() => {
    return () => {
      if (introTimerRef.current) {
        clearTimeout(introTimerRef.current);
      }
    };
  }, []);

  const updateCoinState = useCallback((next) => {
    coinStateRef.current = { ...coinStateRef.current, ...next };
    setCoinState((prev) => ({ ...prev, ...next }));
  }, []);

  const setPlayerLivesSafe = useCallback((value) => {
    playerLivesRef.current = value;
    setPlayerLives(value);
  }, []);

  const setOpponentLivesSafe = useCallback((value) => {
    opponentLivesRef.current = value;
    setOpponentLives(value);
  }, []);

  const prepareMatch = useCallback(
    (selected) => {
      const chosen = selected ?? player;
      if (!chosen) return;
      const nextOpponent = pickOpponent(chosen.id);
      setPlayer(chosen);
      setOpponent(nextOpponent);
      setPlayerLivesSafe(MAX_LIVES);
      setOpponentLivesSafe(MAX_LIVES);
      setWinner(null);
      setEntryStatus({ loading: false, message: "" });
      updateCoinState({ owner: null, active: false });
      coinStateRef.current.respawnAt = 0;
      coinStateRef.current.ownerExpiresAt = 0;
      hitCooldownRef.current = 0;
      setPhase("intro");
    },
    [player, setEntryStatus, setOpponentLivesSafe, setPlayerLivesSafe, updateCoinState]
  );

  const beginFight = useCallback(() => {
    setPhase("playing");
    setRoundId((prev) => prev + 1);
  }, []);

  const resetToSelect = useCallback(() => {
    runningRef.current = false;
    setWinner(null);
    setEntryStatus({ loading: false, message: "" });
    setPhase("select");
    updateCoinState({ owner: null, active: false });
    coinStateRef.current.ownerExpiresAt = 0;
    if (introTimerRef.current) {
      clearTimeout(introTimerRef.current);
    }
  }, [setEntryStatus, updateCoinState]);

  const handleSelectCharacter = useCallback(
    async (character) => {
      if (!character || entryStatus.loading) return;

      if (!onEnterMatch) {
        prepareMatch(character);
        if (introTimerRef.current) clearTimeout(introTimerRef.current);
        introTimerRef.current = setTimeout(beginFight, INTRO_DURATION);
        return;
      }

      setEntryStatus({ loading: true, message: "" });

      try {
        const result = await onEnterMatch(character);
        if (!result?.ok) {
          setEntryStatus({
            loading: false,
            message: result?.message || "Entry failed. Try again.",
          });
          return;
        }
      } catch (error) {
        setEntryStatus({
          loading: false,
          message: "Entry failed. Try again.",
        });
        return;
      }

      setEntryStatus({ loading: false, message: "" });
      prepareMatch(character);
      if (introTimerRef.current) clearTimeout(introTimerRef.current);
      introTimerRef.current = setTimeout(beginFight, INTRO_DURATION);
    },
    [beginFight, entryStatus.loading, onEnterMatch, prepareMatch, setEntryStatus]
  );

  const handleShare = useCallback(() => {
    if (!onShareResult || !winner || !player || !opponent) return;
    onShareResult({
      winner,
      player,
      opponent,
      coin: coinState.type,
    });
  }, [coinState.type, onShareResult, opponent, player, winner]);

  const spawnCoin = useCallback(() => {
    if (!fieldSize.width || !fieldSize.height) return;
    const type = randomFrom(COINS);
    const centerX = fieldSize.width / 2 + randBetween(-40, 40);
    const centerY = fieldSize.height / 2 + randBetween(-40, 40);
    const position = {
      x: clamp(centerX, COIN_RADIUS, fieldSize.width - COIN_RADIUS),
      y: clamp(centerY, COIN_RADIUS, fieldSize.height - COIN_RADIUS),
    };
    updateCoinState({
      owner: null,
      active: true,
      type,
      position,
    });
  }, [fieldSize.height, fieldSize.width, updateCoinState]);

  useEffect(() => {
    const fieldEl = fieldRef.current;
    if (!fieldEl) return;

    const update = () => {
      const rect = fieldEl.getBoundingClientRect();
      setFieldSize({ width: rect.width, height: rect.height });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(fieldEl);
    return () => observer.disconnect();
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing" || !fieldSize.width || !fieldSize.height) return;
    if (!player || !opponent) return;

    runningRef.current = true;

    const bounds = { width: fieldSize.width, height: fieldSize.height };
    const playerStart = {
      x: bounds.width * 0.25,
      y: bounds.height * 0.6,
    };
    const opponentStart = {
      x: bounds.width * 0.75,
      y: bounds.height * 0.4,
    };

    const playerVelocity = randomVelocity(PLAYER_MAX_SPEED * 0.6);
    const opponentVelocity = randomVelocity(OPPONENT_MAX_SPEED * 0.6);

    positionsRef.current.player = {
      ...playerStart,
      ...playerVelocity,
    };
    positionsRef.current.opponent = {
      ...opponentStart,
      ...opponentVelocity,
    };

    applyPosition(playerRef.current, playerStart.x, playerStart.y, BALL_RADIUS);
    applyPosition(
      opponentRef.current,
      opponentStart.x,
      opponentStart.y,
      BALL_RADIUS
    );

    spawnCoin();

    let rafId = 0;
    let lastTime = performance.now();

    const loop = (now) => {
      if (!runningRef.current) return;
      const delta = Math.min(2.5, (now - lastTime) / 16.67);
      lastTime = now;

      tick(delta, now, bounds);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      runningRef.current = false;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [fieldSize.height, fieldSize.width, opponent, phase, player, roundId, spawnCoin]);

  const tick = useCallback(
    (delta, now, bounds) => {
      const playerState = positionsRef.current.player;
      const opponentState = positionsRef.current.opponent;

      if (controlRef.current.active) {
        const { targetX, targetY } = controlRef.current;
        const dx = targetX - playerState.x;
        const dy = targetY - playerState.y;
        const dist = Math.hypot(dx, dy) || 1;
        const targetVx = (dx / dist) * CONTROL_SPEED;
        const targetVy = (dy / dist) * CONTROL_SPEED;
        playerState.vx = lerp(playerState.vx, targetVx, 0.18);
        playerState.vy = lerp(playerState.vy, targetVy, 0.18);
      } else if (Math.random() < 0.05) {
        playerState.vx += (Math.random() - 0.5) * 0.35;
        playerState.vy += (Math.random() - 0.5) * 0.35;
      }

      const activeCoin = coinStateRef.current;
      if (activeCoin.owner && coinStateRef.current.ownerExpiresAt) {
        if (now >= coinStateRef.current.ownerExpiresAt) {
          updateCoinState({ owner: null, active: false });
          coinStateRef.current.ownerExpiresAt = 0;
          coinStateRef.current.respawnAt = now + COIN_RESPAWN_DELAY;
          return;
        }
      }

      if (activeCoin.owner === "opponent") {
        const dx = playerState.x - opponentState.x;
        const dy = playerState.y - opponentState.y;
        const dist = Math.hypot(dx, dy) || 1;
        const targetVx = (dx / dist) * OPPONENT_MAX_SPEED;
        const targetVy = (dy / dist) * OPPONENT_MAX_SPEED;
        opponentState.vx = lerp(opponentState.vx, targetVx, 0.18);
        opponentState.vy = lerp(opponentState.vy, targetVy, 0.18);
      } else if (activeCoin.active && !activeCoin.owner) {
        const dx = activeCoin.position.x - opponentState.x;
        const dy = activeCoin.position.y - opponentState.y;
        const dist = Math.hypot(dx, dy) || 1;
        const targetVx = (dx / dist) * OPPONENT_MAX_SPEED;
        const targetVy = (dy / dist) * OPPONENT_MAX_SPEED;
        opponentState.vx = lerp(opponentState.vx, targetVx, 0.12);
        opponentState.vy = lerp(opponentState.vy, targetVy, 0.12);
      } else if (Math.random() < 0.08) {
        opponentState.vx += (Math.random() - 0.5) * 0.4;
        opponentState.vy += (Math.random() - 0.5) * 0.4;
      }

      clampSpeed(playerState, PLAYER_MAX_SPEED);
      clampSpeed(opponentState, OPPONENT_MAX_SPEED);

      moveEntity(playerState, bounds, BALL_RADIUS, delta);
      moveEntity(opponentState, bounds, BALL_RADIUS, delta);

      applyPosition(playerRef.current, playerState.x, playerState.y, BALL_RADIUS);
      applyPosition(
        opponentRef.current,
        opponentState.x,
        opponentState.y,
        BALL_RADIUS
      );

      if (activeCoin.active && coinRef.current) {
        applyPosition(
          coinRef.current,
          activeCoin.position.x,
          activeCoin.position.y,
          COIN_RADIUS
        );
      }

      if (activeCoin.active && !activeCoin.owner) {
        const playerDistance = distance(
          playerState.x,
          playerState.y,
          activeCoin.position.x,
          activeCoin.position.y
        );
        const opponentDistance = distance(
          opponentState.x,
          opponentState.y,
          activeCoin.position.x,
          activeCoin.position.y
        );
        if (playerDistance <= BALL_RADIUS + COIN_RADIUS) {
          updateCoinState({ owner: "player", active: false });
          coinStateRef.current.ownerExpiresAt = now + COIN_HOLD_DURATION;
          return;
        }
        if (opponentDistance <= BALL_RADIUS + COIN_RADIUS) {
          updateCoinState({ owner: "opponent", active: false });
          coinStateRef.current.ownerExpiresAt = now + COIN_HOLD_DURATION;
          return;
        }
      }

      if (activeCoin.owner) {
        const ballDistance = distance(
          playerState.x,
          playerState.y,
          opponentState.x,
          opponentState.y
        );
        if (ballDistance <= BALL_RADIUS * 2) {
          if (now - hitCooldownRef.current > 800) {
            hitCooldownRef.current = now;
            handleHit(activeCoin.owner, now);
          }
        }
      }

      if (!activeCoin.active && !activeCoin.owner && activeCoin.respawnAt) {
        if (now >= activeCoin.respawnAt) {
          activeCoin.respawnAt = 0;
          spawnCoin();
        }
      }
    },
    [spawnCoin, updateCoinState]
  );

  const handleHit = useCallback(
    (owner, now) => {
      if (owner === "player") {
        const nextLives = Math.max(0, opponentLivesRef.current - 1);
        setOpponentLivesSafe(nextLives);
        if (nextLives === 0) {
          setWinner("player");
          setPhase("ended");
          runningRef.current = false;
        }
      } else {
        const nextLives = Math.max(0, playerLivesRef.current - 1);
        setPlayerLivesSafe(nextLives);
        if (nextLives === 0) {
          setWinner("opponent");
          setPhase("ended");
          runningRef.current = false;
        }
      }

      updateCoinState({ owner: null, active: false });
      coinStateRef.current.ownerExpiresAt = 0;
      coinStateRef.current.respawnAt = now + COIN_RESPAWN_DELAY;
    },
    [setOpponentLivesSafe, setPlayerLivesSafe, updateCoinState]
  );

  const handlePointerDown = useCallback(
    (event) => {
      if (phase !== "playing") return;
      if (!fieldRef.current) return;
      event.preventDefault();
      const rect = fieldRef.current.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, BALL_RADIUS, rect.width - BALL_RADIUS);
      const y = clamp(event.clientY - rect.top, BALL_RADIUS, rect.height - BALL_RADIUS);

      controlRef.current.active = true;
      controlRef.current.targetX = x;
      controlRef.current.targetY = y;
      controlRef.current.pointerId = event.pointerId;

      const playerState = positionsRef.current.player;
      const dx = x - playerState.x;
      const dy = y - playerState.y;
      const dist = Math.hypot(dx, dy) || 1;
      playerState.vx = (dx / dist) * CONTROL_SPEED;
      playerState.vy = (dy / dist) * CONTROL_SPEED;

      fieldRef.current.setPointerCapture(event.pointerId);
    },
    [phase]
  );

  const handlePointerMove = useCallback((event) => {
    if (!controlRef.current.active) return;
    if (controlRef.current.pointerId !== event.pointerId) return;
    if (!fieldRef.current) return;
    event.preventDefault();
    const rect = fieldRef.current.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, BALL_RADIUS, rect.width - BALL_RADIUS);
    const y = clamp(event.clientY - rect.top, BALL_RADIUS, rect.height - BALL_RADIUS);
    controlRef.current.targetX = x;
    controlRef.current.targetY = y;
  }, []);

  const handlePointerUp = useCallback((event) => {
    if (controlRef.current.pointerId !== event.pointerId) return;
    controlRef.current.active = false;
    controlRef.current.pointerId = null;
    if (fieldRef.current?.hasPointerCapture(event.pointerId)) {
      fieldRef.current.releasePointerCapture(event.pointerId);
    }
  }, []);

  const activeCoinLabel = coinState.owner ? `Holding ${coinState.type.label}` : "";

  return (
    <div className="battleScreen">
      {phase === "select" && (
        <div className="battleSelect" data-loading={entryStatus.loading ? "1" : "0"}>
          <div className="battleSelectHeader">
            <div>
              <div className="battleTitle">Choose Your Fighter</div>
              <div className="battleSubtitle">
                Tap a character to enter the battle arena.
              </div>
            </div>
          </div>
          {(entryStatus.loading || entryStatus.message) && (
            <div className="battleEntryStatus">
              {entryStatus.loading ? "Awaiting signature..." : entryStatus.message}
            </div>
          )}
          <div className="battleGrid">
            {CHARACTER_POOL.map((character) => (
              <button
                key={character.id}
                type="button"
                className="battleCard"
                onClick={() => handleSelectCharacter(character)}
                disabled={entryStatus.loading}
              >
                <div
                  className="battleAvatar"
                  data-has-image={character.image ? "1" : "0"}
                  style={{ "--avatar-bg": getAvatarBackground(character) }}
                >
                  <span className="battleInitials">
                    {getInitials(character.name)}
                  </span>
                </div>
                <div>
                  <div className="battleName">{character.name}</div>
                  <div className="battleDesc">{character.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === "intro" && player && opponent && (
        <div className="battleIntro">
          <div className="battleIntroCard">
            <div className="battleIntroSide" data-side="left">
              <div
                className="battleIntroAvatar"
                style={{ "--avatar-bg": getAvatarBackground(player) }}
              />
              <div className="battleIntroName">{player.name}</div>
            </div>
            <div className="battleIntroVs">VS</div>
            <div className="battleIntroSide" data-side="right">
              <div
                className="battleIntroAvatar"
                style={{ "--avatar-bg": getAvatarBackground(opponent) }}
              />
              <div className="battleIntroName">{opponent.name}</div>
            </div>
          </div>
          <div className="battleIntroText">Fight!</div>
        </div>
      )}

      {phase !== "select" && phase !== "intro" && player && opponent && (
        <div className="battleArena">
          <div className="battleHud">
            <div className="battleHudSide">
              <div className="battleHudLabel">You - {player.name}</div>
              <div className="battleHearts" data-team="player">
                {Array.from({ length: MAX_LIVES }).map((_, index) => (
                  <span
                    key={`p-heart-${index}`}
                    className="battleHeart"
                    data-dead={index >= playerLives ? "1" : "0"}
                  >
                    {"\u2665"}
                  </span>
                ))}
              </div>
            </div>
            <div className="battleHudVs">VS</div>
            <div className="battleHudSide" data-align="right">
              <div className="battleHudLabel">{opponent.name}</div>
              <div className="battleHearts" data-team="opponent">
                {Array.from({ length: MAX_LIVES }).map((_, index) => (
                  <span
                    key={`o-heart-${index}`}
                    className="battleHeart"
                    data-dead={index >= opponentLives ? "1" : "0"}
                  >
                    {"\u2665"}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div
            className="battleField"
            ref={fieldRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <div
              className="battleBall"
              ref={playerRef}
              data-team="player"
              style={{ "--ring-color": PLAYER_RING }}
              aria-label="Player"
            >
              <div
                className="battleAvatarInner"
                data-has-image={player.image ? "1" : "0"}
                style={{ "--avatar-bg": getAvatarBackground(player) }}
              >
                <span className="battleInitials">
                  {getInitials(player.name)}
                </span>
              </div>
              {coinState.owner === "player" && (
                <div className="battleOrbit" data-coin={coinState.type.id}>
                  <div className="battleOrbitIcon">
                    {coinState.type.icon ? (
                      <img
                        className="battleOrbitImg"
                        src={coinState.type.icon}
                        alt={coinState.type.label}
                      />
                    ) : (
                      <span className="battleOrbitSymbol">
                        {coinState.type.symbol}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div
              className="battleBall"
              ref={opponentRef}
              data-team="opponent"
              style={{ "--ring-color": OPPONENT_RING }}
              aria-label="Opponent"
            >
              <div
                className="battleAvatarInner"
                data-has-image={opponent.image ? "1" : "0"}
                style={{ "--avatar-bg": getAvatarBackground(opponent) }}
              >
                <span className="battleInitials">
                  {getInitials(opponent.name)}
                </span>
              </div>
              {coinState.owner === "opponent" && (
                <div className="battleOrbit" data-coin={coinState.type.id}>
                  <div className="battleOrbitIcon">
                    {coinState.type.icon ? (
                      <img
                        className="battleOrbitImg"
                        src={coinState.type.icon}
                        alt={coinState.type.label}
                      />
                    ) : (
                      <span className="battleOrbitSymbol">
                        {coinState.type.symbol}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {coinState.active && (
              <div
                className="battleCoin"
                ref={coinRef}
                style={{ "--coin-color": coinState.type.color }}
                aria-label={`${coinState.type.name} coin`}
              >
                <div className="battleCoinInner">
                  <div className="battleCoinSymbol">
                    {coinState.type.icon ? (
                      <img
                        className="battleCoinIcon"
                        src={coinState.type.icon}
                        alt={coinState.type.label}
                      />
                    ) : (
                      <span>{coinState.type.symbol}</span>
                    )}
                  </div>
                  <div className="battleCoinLabel">{coinState.type.label}</div>
                </div>
              </div>
            )}

            {phase === "ended" && (
              <div className="battleOverlay">
                <div className="battleResultCard">
                  <div className="battleResultTitle">
                    {winner === "player" ? "You Win!" : "You Lose"}
                  </div>
                  <div className="battleResultSubtitle">
                    {winner === "player"
                      ? "Arena dominance secured."
                      : "Your opponent claimed the coin."}
                  </div>
                  <div className="battleResultActions">
                    <button
                      type="button"
                      className="battleBtn primary"
                      onClick={() => handleSelectCharacter(player)}
                    >
                      Play Again
                    </button>
                    {onShareResult && (
                      <button
                        type="button"
                        className="battleBtn"
                        onClick={handleShare}
                      >
                        Share Result
                      </button>
                    )}
                    <button
                      type="button"
                      className="battleBtn"
                      onClick={resetToSelect}
                    >
                      Change Fighter
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="battleHint">
            {phase === "playing"
              ? "Drag or tap to steer your fighter. Grab the coin and collide!"
              : ""}
          </div>
          {activeCoinLabel && (
            <div className="battleCoinStatus">{activeCoinLabel}</div>
          )}
        </div>
      )}

      <style>{battleArenaCss}</style>
    </div>
  );
}

const battleArenaCss = `
.battleScreen {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.battleSelectHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.battleSelect[data-loading="1"] {
  opacity: 0.7;
}

.battleEntryStatus {
  font-size: 11px;
  color: #ffd27a;
  text-align: center;
  margin-bottom: 8px;
}

.battleIntro {
  background: rgba(10, 12, 18, 0.85);
  border: 1px solid #2a2e36;
  border-radius: 18px;
  padding: 18px 16px;
  display: grid;
  gap: 14px;
  place-items: center;
  text-align: center;
  box-shadow: 0 20px 40px rgba(4, 6, 12, 0.6);
}

.battleIntroCard {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.battleIntroSide {
  display: grid;
  gap: 8px;
  justify-items: center;
}

.battleIntroAvatar {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  background-image: var(--avatar-bg);
  background-size: cover;
  background-position: center;
  box-shadow: 0 0 0 4px rgba(75, 107, 255, 0.4);
  animation: introLeft 1.1s ease both;
}

.battleIntroSide[data-side="right"] .battleIntroAvatar {
  box-shadow: 0 0 0 4px rgba(255, 75, 107, 0.4);
  animation: introRight 1.1s ease both;
}

.battleIntroName {
  font-size: 12px;
  font-weight: 700;
}

.battleIntroVs {
  font-size: 20px;
  font-weight: 800;
  opacity: 0.7;
}

.battleIntroText {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #ffd27a;
}

@keyframes introLeft {
  0% {
    transform: translateX(-40px) scale(0.6);
    opacity: 0;
  }
  60% {
    transform: translateX(6px) scale(1.05);
    opacity: 1;
  }
  100% {
    transform: translateX(0) scale(1);
  }
}

@keyframes introRight {
  0% {
    transform: translateX(40px) scale(0.6);
    opacity: 0;
  }
  60% {
    transform: translateX(-6px) scale(1.05);
    opacity: 1;
  }
  100% {
    transform: translateX(0) scale(1);
  }
}

.battleTitle {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.3px;
}

.battleSubtitle {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 4px;
}

.battleGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.battleCard {
  display: flex;
  gap: 10px;
  align-items: center;
  text-align: left;
  background: rgba(16, 18, 24, 0.9);
  border: 1px solid #2a2e36;
  border-radius: 14px;
  padding: 10px;
  color: #eaeef7;
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
}

.battleCard:hover {
  transform: translateY(-1px);
  border-color: #4b6bff;
  background: rgba(20, 24, 32, 0.95);
}

.battleCard:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.battleAvatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background-image: var(--avatar-bg);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.08);
  flex: 0 0 auto;
}

.battleAvatarInner {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background-image: var(--avatar-bg);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.08);
}

.battleInitials {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.6px;
}

.battleAvatar[data-has-image="1"] .battleInitials,
.battleAvatarInner[data-has-image="1"] .battleInitials {
  opacity: 0;
}

.battleName {
  font-size: 12px;
  font-weight: 700;
}

.battleDesc {
  font-size: 10px;
  opacity: 0.65;
  margin-top: 2px;
}

.battleArena {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.battleHud {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
}

.battleHudSide {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.battleHudSide[data-align="right"] {
  align-items: flex-end;
  text-align: right;
}

.battleHudLabel {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.battleHudVs {
  font-size: 12px;
  font-weight: 800;
  opacity: 0.65;
  text-transform: uppercase;
}

.battleHearts {
  display: flex;
  gap: 4px;
}

.battleHeart {
  font-size: 14px;
  transition: opacity 0.2s ease;
}

.battleHearts[data-team="player"] .battleHeart {
  color: #4b6bff;
}

.battleHearts[data-team="opponent"] .battleHeart {
  color: #ff4b6b;
}

.battleHeart[data-dead="1"] {
  opacity: 0.25;
  filter: grayscale(1);
}

.battleField {
  position: relative;
  width: 100%;
  min-height: 360px;
  aspect-ratio: 3 / 4;
  background: #0a0a0a;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  touch-action: none;
}

.battleBall {
  position: absolute;
  width: ${BALL_SIZE}px;
  height: ${BALL_SIZE}px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #1b1f27, #0b0d12 70%);
  border: 2px solid #0c0f15;
  display: grid;
  place-items: center;
  box-shadow: 0 0 0 3px var(--ring-color), 0 0 18px color-mix(in srgb, var(--ring-color), transparent 60%);
  will-change: transform;
}

.battleCoin {
  position: absolute;
  width: ${COIN_SIZE}px;
  height: ${COIN_SIZE}px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #fff2c7, var(--coin-color));
  border: 1px solid rgba(255, 255, 255, 0.15);
  display: grid;
  place-items: center;
  color: #1b1200;
  font-weight: 700;
  box-shadow: 0 0 14px color-mix(in srgb, var(--coin-color), transparent 60%);
  will-change: transform;
}

.battleCoinInner {
  display: grid;
  place-items: center;
  gap: 1px;
  text-align: center;
  animation: coinSpin 6s linear infinite;
}

.battleCoinSymbol {
  font-size: 14px;
  line-height: 1;
  display: grid;
  place-items: center;
}

.battleCoinLabel {
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.battleOrbit {
  position: absolute;
  inset: -10px;
  pointer-events: none;
  animation: orbitSpin 1.1s linear infinite;
}

.battleOrbitIcon {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(15, 15, 15, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.18);
  display: grid;
  place-items: center;
  transform: translate(-50%, -50%) translateX(28px);
}

.battleOrbitSymbol {
  font-size: 10px;
  font-weight: 700;
}

.battleOrbitImg {
  width: 12px;
  height: 12px;
  display: block;
}

.battleCoinIcon {
  width: 16px;
  height: 16px;
  display: block;
}

.battleOverlay {
  position: absolute;
  inset: 0;
  background: rgba(5, 6, 10, 0.7);
  display: grid;
  place-items: center;
  backdrop-filter: blur(2px);
}

.battleResultCard {
  background: rgba(12, 15, 19, 0.95);
  border: 1px solid #2a2e36;
  border-radius: 16px;
  padding: 18px;
  text-align: center;
  width: min(90%, 300px);
  box-shadow: 0 0 30px rgba(0, 0, 0, 0.4);
}

.battleResultTitle {
  font-size: 20px;
  font-weight: 800;
}

.battleResultSubtitle {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 6px;
}

.battleResultActions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.battleBtn {
  border-radius: 12px;
  border: 1px solid #2a2e36;
  background: rgba(18, 21, 27, 0.9);
  color: #eaeef7;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.battleBtn.primary {
  background: linear-gradient(90deg, #4b6bff, #7fb1ff);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 10px 24px rgba(75, 107, 255, 0.35);
}

.battleHint {
  font-size: 11px;
  opacity: 0.65;
  text-align: center;
}

.battleCoinStatus {
  font-size: 11px;
  text-align: center;
  color: #ffd27a;
}

@media (min-width: 480px) {
  .battleGrid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@keyframes coinSpin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes orbitSpin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
`;

function pickOpponent(playerId) {
  const options = CHARACTER_POOL.filter((character) => character.id !== playerId);
  return options[Math.floor(Math.random() * options.length)];
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomVelocity(speed) {
  const angle = Math.random() * Math.PI * 2;
  return {
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  };
}

function moveEntity(entity, bounds, radius, delta) {
  entity.x += entity.vx * delta;
  entity.y += entity.vy * delta;

  if (entity.x < radius) {
    entity.x = radius;
    entity.vx = Math.abs(entity.vx);
  }
  if (entity.x > bounds.width - radius) {
    entity.x = bounds.width - radius;
    entity.vx = -Math.abs(entity.vx);
  }
  if (entity.y < radius) {
    entity.y = radius;
    entity.vy = Math.abs(entity.vy);
  }
  if (entity.y > bounds.height - radius) {
    entity.y = bounds.height - radius;
    entity.vy = -Math.abs(entity.vy);
  }
}

function clampSpeed(entity, maxSpeed) {
  const speed = Math.hypot(entity.vx, entity.vy);
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    entity.vx *= scale;
    entity.vy *= scale;
  }
  if (speed < 0.4) {
    const scale = 0.4 / (speed || 1);
    entity.vx *= scale;
    entity.vy *= scale;
  }
}

function applyPosition(element, x, y, radius) {
  if (!element) return;
  element.style.transform = `translate(${x - radius}px, ${y - radius}px)`;
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function getInitials(name) {
  if (!name) return "?";
  const cleaned = name.replace(/[()]/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts[0].length <= 3 && parts[0] === parts[0].toUpperCase()) {
    return parts[0].slice(0, 3);
  }
  return parts
    .slice(0, 3)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getAvatarGradient(name) {
  const palette = [
    ["#3b82f6", "#1e40af"],
    ["#8b5cf6", "#4c1d95"],
    ["#ec4899", "#9d174d"],
    ["#22c55e", "#15803d"],
    ["#eab308", "#a16207"],
    ["#14b8a6", "#0f766e"],
    ["#f97316", "#c2410c"],
  ];
  const index = Math.abs(hashString(name)) % palette.length;
  const [start, end] = palette[index];
  return `linear-gradient(140deg, ${start}, ${end})`;
}

function getAvatarBackground(character) {
  const gradient = getAvatarGradient(character?.name ?? "");
  if (character?.image) {
    return `url("${character.image}"), ${gradient}`;
  }
  return gradient;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}



