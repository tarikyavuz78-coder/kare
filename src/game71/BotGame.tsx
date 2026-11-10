import { useCallback, useEffect, useRef, useState } from 'react';
import { Action, GameState, RuleError, apply, checkTake, createGame } from '../engine/game';
import { botAction, botAnswersCift, botShouldDeclareCift } from '../engine/bot';
import { stepBot } from '../engine/runner';
import Table71, { ConfirmBox } from './Table71';

const BOT_NAMES = ['Ayşe', 'Mehmet', 'Zeynep'];

interface Props { playerName: string; players: number; onExit: () => void; onGameEnd?: (won: boolean) => void; }

export default function BotGame({ playerName, players, onExit, onGameEnd }: Props) {
  const newGame = useCallback(() => createGame([playerName, ...BOT_NAMES.slice(0, players - 1)], { bots: [false, true, true, true].slice(0, players) }), [playerName, players]);
  const [s, setS] = useState<GameState>(newGame);
  const [toast, setToast] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ bot: number; left: number } | null>(null);
  const reported = useRef(false);
  const [takeCift, setTakeCift] = useState(false);

  const say = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200); };
  const act = (a: Action, pi = 0) => {
    try { setS((cur) => apply(cur, pi, a)); }
    catch (e) { if (e instanceof RuleError) say(e.message); else throw e; }
  };
  // apply'ı güncel durumla senkron çalıştırıp hatayı yakalamak için
  const actNow = (a: Action, pi = 0) => {
    try { const next = apply(s, pi, a); setS(next); return next; }
    catch (e) { if (e instanceof RuleError) { say(e.message); return null; } throw e; }
  };

  // botların sırası
  useEffect(() => {
    if (s.phase !== 'playing' || s.current === 0 || ask) return;
    const t = setTimeout(() => {
      const pi = s.current;
      const me = s.players[pi];
      if (s.turn.phase === 'draw' && !me.cift && me.opened === 'none' && botShouldDeclareCift(s, pi)) { setS(apply(s, pi, { type: 'declareCift' })); return; }
      const a = botAction(s, pi);
      if (a.type === 'take') {
        const chk = checkTake(s, pi);
        if (chk.askPrevious === 0) { setAsk({ bot: pi, left: 5 }); return; }
      }
      setS(stepBot(s));
    }, 650);
    return () => clearTimeout(t);
  }, [s, ask]);

  // "Çifte Git?" sorusu: 5 saniye
  useEffect(() => {
    if (!ask) return;
    if (ask.left <= 0) { answer(false); return; }
    const t = setTimeout(() => setAsk((x) => (x ? { ...x, left: x.left - 1 } : x)), 1000);
    return () => clearTimeout(t);
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (yes: boolean) => {
    if (!ask) return;
    let next = s;
    if (yes) { next = apply(next, 0, { type: 'declareCift' }); next = apply(next, ask.bot, { type: 'draw' }); }
    else next = apply(next, ask.bot, { type: 'take' });
    setAsk(null);
    setS(next);
  };

  useEffect(() => {
    if (s.phase === 'gameOver' && !reported.current) { reported.current = true; onGameEnd?.(s.winner === 0); }
  }, [s.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // süre doldu: desteden çek, en soldaki kartı at
  const timeout = (cardId: string | null) => {
    try {
      let n = s;
      if (n.turn.taken) n = apply(n, 0, { type: 'undoTake' });
      if (n.turn.phase === 'draw') n = apply(n, 0, { type: 'draw' });
      const hand = n.players[0].hand;
      const drawn = n.turn.drawn;
      const id = drawn && hand.some((c) => c.id === drawn) ? drawn : cardId && hand.some((c) => c.id === cardId) ? cardId : hand[0].id;
      n = apply(n, 0, { type: 'discard', cardId: id });
      setS(n);
      say('Süre doldu: desteden kart çekildi ve çekilen kart atıldı.');
    } catch (e) { if (e instanceof RuleError) say(e.message); else throw e; }
  };

  const takeRequest = () => {
    const chk = checkTake(s, 0);
    if (!chk.allowed) { say(chk.reason!); return; }
    if (chk.needsCift) {
      setTakeCift(true);
      return;
    }
    if (chk.askPrevious !== null && botAnswersCift(s, chk.askPrevious)) {
      const next = apply(s, chk.askPrevious, { type: 'declareCift' });
      setS(next);
      say(`${s.players[chk.askPrevious].name} Çifte Git dedi. Bu kartı alamazsın.`);
      return;
    }
    actNow({ type: 'take' });
  };

  return (
    <>
      <Table71 s={s} me={0} act={(a) => act(a)} takeRequest={takeRequest} onExit={onExit} title="Bota karşı" onTimeout={timeout} paused={!!ask || takeCift} leaveText="Oyundan ayrılırsan bu oyun biter."
        onNewGame={() => { reported.current = false; setS(newGame()); }}
        waitingText={s.phase === 'playing' && s.current !== 0 ? `${s.players[s.current].name} oynuyor…` : null} />
      {ask && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Çifte Git sorusu">
          <div className="panel modal" style={{ maxWidth: 420 }}>
            <h2>Çifte Git?</h2>
            <p style={{ margin: 0 }}>{s.players[ask.bot].name} attığın kartı almak istiyor. Çifte Git dersen alamaz, ama sen bu el yalnızca çiftle açabilirsin.</p>
            <div className="row">
              <button className="btn btn-cift" onClick={() => answer(true)}>Çifte Git</button>
              <button className="btn" onClick={() => answer(false)}>Alsın ({ask.left})</button>
            </div>
          </div>
        </div>
      )}
      {takeCift && (
        <ConfirmBox title="Çifte Git" text="Önceki oyuncu Çifte Git dedi. Kartı almak için sen de Çifte Git demelisin. Bu el yalnızca çiftle açabilirsin."
          yes="Çifte Git ve al" onYes={() => { setTakeCift(false); actNow({ type: 'take', declareCift: true }); }} onNo={() => setTakeCift(false)} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
