/**
 * The action panel: everything the local player can do right now.
 *
 * It renders one "task" at a time, chosen by the engine's own `pending` /
 * `navigation.stage`, so the UI and the rules can never disagree about whose
 * turn it is. All dispatch goes through `moves.*`, which the shell stamps with
 * the caller's seat.
 */

import { useState } from 'react';
import type { PlayerView, NavCardId, PlayerId } from '@ftk/engine';
import {
  FACTION_ICON, FACTION_LABEL, PHASE_LABEL, RITUAL_LABEL,
} from './labels.js';
import { NavCardFace } from './NavCardFace.js';
import {
  eligibleTeam, iAmAppointing, iMayJumpOverboard, iMustContribute, iMustResolveLogbook,
  iOweMutinyPledge, myContributableCards, myLogbook, pickableTargets,
} from './actions.js';
import { navPickLine } from './status.js';

export interface ActionPanelProps {
  view: PlayerView;
  moves: Record<string, (...args: unknown[]) => void>;
  /** Reopen the minimized MutinyPrompt modal (the pledge input lives there). */
  onOpenMutiny: () => void;
}

const name = (view: PlayerView, id: PlayerId): string =>
  (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? id;

/** A two-card splitter: pick the card to keep — the other one is marked for
 *  the deep automatically. Tapping the kept card again clears the choice. */
function CardSplitter({
  cards, onConfirm, confirmLabel, cancel,
}: {
  cards: NavCardId[];
  onConfirm: (keep: NavCardId, discard: NavCardId) => void;
  confirmLabel: string;
  cancel?: () => void;
}) {
  const [keep, setKeep] = useState<number | null>(null);
  const [discard, setDiscard] = useState<number | null>(null);
  const choose = (i: number): void => {
    if (keep === i) { setKeep(null); setDiscard(null); return; }
    setKeep(i);
    setDiscard(i === 0 ? 1 : 0);
  };
  return (
    <div className="cardsplit">
      <p className="hint">选择要保留的牌（另一张自动弃入深海）</p>
      <div className="cardsplit__hand">
        {cards.map((c, i) => (
          <button
            key={`${c}-${i}`}
            className={
              'navcard' + (keep === i ? ' navcard--keep' : '') + (discard === i ? ' navcard--drop' : '')
            }
            onClick={() => choose(i)}
          >
            <NavCardFace card={c} />
            {keep === i && <span className="navcard__tag">保留</span>}
            {discard === i && <span className="navcard__tag navcard__tag--drop">弃掉</span>}
          </button>
        ))}
      </div>
      <div className="row">
        <button
          className="btn btn--primary"
          disabled={keep === null || discard === null}
          onClick={() => keep !== null && discard !== null && onConfirm(cards[keep]!, cards[discard]!)}
        >
          {confirmLabel}
        </button>
        {cancel && <button className="btn btn--ghost" onClick={cancel}>取消</button>}
      </div>
    </div>
  );
}

/** A read-only row of navigation cards. */
function CardList({ cards }: { cards: NavCardId[] }) {
  if (cards.length === 0) return <p className="hint">（无）</p>;
  return (
    <div className="cardsplit__hand">
      {cards.map((c, i) => (
        <div key={`${c}-${i}`} className="navcard navcard--static">
          <NavCardFace card={c} />
        </div>
      ))}
    </div>
  );
}

function TargetPicker({
  view, title, confirmLabel, excludeSelf, targets, onConfirm,
}: {
  view: PlayerView;
  title: string;
  confirmLabel: string;
  excludeSelf?: boolean;
  /** Optional explicit candidate list (defaults to all alive others). */
  targets?: PlayerId[];
  onConfirm: (target: PlayerId) => void;
}) {
  const [pick, setPick] = useState<PlayerId | null>(null);
  const list = targets ?? pickableTargets(view, excludeSelf ?? true);
  return (
    <div className="picker">
      <p className="hint">{title}</p>
      {list.length === 0 && <p className="hint">没有可选目标</p>}
      <div className="picker__grid">
        {list.map((id) => (
          <button
            key={id}
            className={'chip' + (pick === id ? ' chip--on' : '')}
            onClick={() => setPick(id)}
          >
            {name(view, id)}
          </button>
        ))}
      </div>
      <button className="btn btn--primary" disabled={!pick} onClick={() => pick && onConfirm(pick)}>
        {confirmLabel}
      </button>
    </div>
  );
}

export function ActionPanel({ view, moves, onOpenMutiny }: ActionPanelProps) {
  // 1. Appoint the team.
  if (iAmAppointing(view)) {
    return <AppointForm view={view} moves={moves} />;
  }

  // 2. Mutiny pledge — the INPUT lives in the MutinyPrompt modal (one
  //    button per gun). The panel only mirrors its state and offers the
  //    reopen, so there is exactly one pledge UI to keep in sync.
  if (view.phase === 'loyalty' && view.mutiny.active && view.you.alive &&
      view.officers.captain !== view.you.id) {
    const pledgedSet = new Set(view.mutiny.pledged);
    const roster = [view.you, ...view.others].filter(
      (p) => p.alive && !p.benched && p.id !== view.officers.captain,
    );
    const done = roster.filter((p) => pledgedSet.has(p.id)).length;
    return (
      <div className="panel panel--quiet">
        <p className="hint">忠诚提问进行中 · 已表态 {done} / {roster.length}</p>
        {iOweMutinyPledge(view) && (
          <button className="btn btn--primary" onClick={onOpenMutiny}>打开哗变表决</button>
        )}
      </div>
    );
  }

  // 3. Navigation contributions.
  if (iMustContribute(view)) {
    return (
      <CardSplitter
        cards={myContributableCards(view)}
        confirmLabel="确认"
        onConfirm={(keep, discard) => moves.navContribute!(keep, discard)}
      />
    );
  }
  if (iMustResolveLogbook(view)) {
    return (
      <div className="panel">
        <p className="hint">你是领航员：弃掉一张，留下的那张立即决定航向并生效。</p>
        <CardSplitter
          cards={myLogbook(view)}
          confirmLabel="确定航向"
          onConfirm={(keep, discard) => moves.navLogbook!(discard)}
        />
        {iMayJumpOverboard(view) && (
          <button className="btn btn--danger" onClick={() => moves.denialOfCommand!()}>
            🌊 跳海抗命
          </button>
        )}
      </div>
    );
  }

  // 4. Pendings that need a specific actor.
  const p = view.pending;
  if (p?.isYou && p.kind !== 'cardEffect') {
    return <PendingForm view={view} moves={moves} kind={p.kind} />;
  }

  // 5. Nothing actionable for this player right now. A pending with `by`
  // === null is a secret-actor pending (a ritual) — the actor's identity
  // must not reach the UI.
  return (
    <div className="panel panel--quiet">
      <p className="hint">
        {p
          ? p.by
            ? `等待 ${name(view, p.by)} 操作…`
            : '仪式进行中，请稍候…'
          : view.phase === 'appointTeam'
            ? `当前阶段，船长（${name(view, view.officers.captain ?? view.you.id)}）任命船员`
            : view.phase === 'navigation'
              ? `当前阶段：${PHASE_LABEL[view.phase]} · ${navPickLine(view) ?? ''}`
              : `当前阶段：${PHASE_LABEL[view.phase]}`}
      </p>
    </div>
  );
}

function AppointForm({ view, moves }: { view: PlayerView; moves: ActionPanelProps['moves'] }) {
  const eligible = eligibleTeam(view);
  const [lt, setLt] = useState<PlayerId | null>(null);
  const [nav, setNav] = useState<PlayerId | null>(null);
  const ok = lt && nav && lt !== nav;
  return (
    <div className="panel">
      <h3 className="panel__title">任命领航团队</h3>
      <p className="hint">选择大副</p>
      <div className="picker__grid">
        {eligible.map((id) => (
          <button key={id} className={'chip' + (lt === id ? ' chip--on' : '')} onClick={() => setLt(id)}>
            {name(view, id)}
          </button>
        ))}
      </div>
      <p className="hint">选择领航员</p>
      <div className="picker__grid">
        {eligible.filter((id) => id !== lt).map((id) => (
          <button key={id} className={'chip' + (nav === id ? ' chip--on' : '')} onClick={() => setNav(id)}>
            {name(view, id)}
          </button>
        ))}
      </div>
      <button className="btn btn--primary" disabled={!ok} onClick={() => ok && moves.appointTeam!(lt, nav)}>
        提交团队
      </button>
    </div>
  );
}

function PendingForm({
  view, moves, kind,
}: {
  view: PlayerView;
  moves: ActionPanelProps['moves'];
  kind: NonNullable<PlayerView['pending']>['kind'];
}) {
  const data = view.pendingData ?? {};
  switch (kind) {
    case 'emergencyNav':
      return (
        <TargetPicker
          view={view}
          title="紧急航行：指派一名紧急领航员（可选歇班中的玩家）"
          confirmLabel="指派"
          onConfirm={(target) => moves.emergencyNav!(target)}
        />
      );
    case 'mapAction':
      return (
        <MapActionForm view={view} moves={moves} icon={String(data['icon'] ?? 'none')} />
      );
    case 'mutinyTie': {
      const remaining = (data['remaining'] as PlayerId[] | undefined) ?? [];
      return (
        <TargetPicker
          view={view}
          title="哗变平局：请选择一名玩家弃权"
          confirmLabel="选择"
          excludeSelf={false}
          onConfirm={(target) => {
            void remaining;
            moves.mutinyTieBreak!(target);
          }}
        />
      );
    }
    case 'telescope':
      return data['step'] === 'choose' ? (
        <TargetPicker
          view={view}
          title="望远镜：选择一名玩家私下查看下一张航海卡"
          confirmLabel="让他查看"
          onConfirm={(target) => moves.telescopeChoose!(target)}
        />
      ) : (
        <div className="panel">
          <p className="hint">你看到的下一张航海卡：</p>
          <CardList cards={data['deckTop'] ? [data['deckTop'] as NavCardId] : []} />
          <div className="row">
            <button className="btn btn--primary" onClick={() => moves.telescopeDecide!('keep')}>留在牌堆</button>
            <button className="btn btn--danger" onClick={() => moves.telescopeDecide!('discard')}>弃入深海</button>
          </div>
        </div>
      );
    case 'mermaid':
      return data['step'] === 'choose' ? (
        <TargetPicker
          view={view}
          title="美人鱼：选择一名玩家私下查看最近弃掉的 3 张牌"
          confirmLabel="让他查看"
          onConfirm={(target) => moves.mermaidChoose!(target)}
        />
      ) : (
        <div className="panel">
          <p className="hint">最近弃掉的 3 张牌：</p>
          <CardList cards={(data['cards'] as NavCardId[] | undefined) ?? []} />
          <button className="btn btn--primary" onClick={() => moves.mermaidAck!()}>知道了</button>
        </div>
      );
    case 'ritual':
      return <RitualForm view={view} moves={moves} ritual={String(data['ritual'] ?? '')} />;
    default:
      return null;
  }
}

function MapActionForm({
  view, moves, icon,
}: {
  view: PlayerView;
  moves: ActionPanelProps['moves'];
  icon: string;
}) {
  if (icon === 'octopus') {
    return (
      <TargetPicker
        view={view}
        title="🐙 海怪：选择一名玩家献祭给海怪（若是邪教首领，邪教立即获胜）"
        confirmLabel="献祭"
        onConfirm={(target) => moves.mapActionFeedKraken!(target)}
      />
    );
  }
  return (
    <TargetPicker
      view={view}
      title="🔍 船舱搜查：选择一名玩家，你私下查看其阵营（该玩家将不再可被转化）"
      confirmLabel="搜查"
      onConfirm={(target) => moves.mapActionCabinSearch!(target)}
    />
  );
}

function RitualForm({
  view, moves, ritual,
}: {
  view: PlayerView;
  moves: ActionPanelProps['moves'];
  ritual: string;
}) {
  const [grants, setGrants] = useState<Record<PlayerId, number>>({});
  if (ritual === 'conversion') {
    // The actor IS the Cult Leader, and a cultist can never be re-converted.
    // The leader legitimately knows their flock (starting sight + every
    // conversion they performed — `knownCultists` is computed live), so
    // cultists are REMOVED from the list: picking one would be rejected by
    // the engine and leave the ritual stuck forever.
    const flock = new Set(view.you.knownCultists ?? []);
    const convertible = pickableTargets(view, true).filter((id) => !flock.has(id));
    if (convertible.length === 0) {
      // Nobody left to convert: the ritual ends without a convert (the
      // engine's ritualAck closes any ritual).
      return (
        <div className="panel">
          <h3 className="panel__title">邪教皈依</h3>
          <p className="hint">船上已无可转化的人。仪式无声地结束了…</p>
          <button className="btn btn--primary" onClick={() => moves.ritualAck!()}>
            结束仪式
          </button>
        </div>
      );
    }
    return (
      <TargetPicker
        view={view}
        targets={convertible}
        title="邪教皈依：选择一名可转化的玩家，使其成为邪教徒（邪教徒不可再转化）"
        confirmLabel="皈依"
        onConfirm={(target) => moves.ritualConversion!(target)}
      />
    );
  }
  if (ritual === 'gunsStash') {
    const total = Object.values(grants).reduce((a, b) => a + b, 0);
    const everyone: PlayerId[] = [view.you, ...view.others]
      .filter((p) => p.alive)
      .map((p) => p.id);
    return (
      <div className="panel">
        <h3 className="panel__title">{RITUAL_LABEL.gunsStash}</h3>
        <p className="hint">秘密分配 3 把枪（剩余 {3 - total}）</p>
        {everyone.map((id) => (
          <label key={id} className="slider">
            <span>{name(view, id)}：{grants[id] ?? 0}</span>
            <input
              type="range" min={0} max={3} value={grants[id] ?? 0}
              onChange={(e) => setGrants({ ...grants, [id]: Number(e.target.value) })}
            />
          </label>
        ))}
        <button
          className="btn btn--primary" disabled={total !== 3}
          onClick={() =>
            moves.ritualGunsStash!(
              Object.entries(grants).filter(([, g]) => g > 0).map(([to, g]) => ({ to, guns: g })),
            )
          }
        >
          确认分配
        </button>
      </div>
    );
  }
  // cultCabinSearch is private knowledge — just acknowledge.
  return (
    <div className="panel">
      <h3 className="panel__title">{RITUAL_LABEL.cultCabinSearch}</h3>
      <p className="hint">你已私下看到当前航行团队的阵营。</p>
      <RitualTeamPeek view={view} />
      <button className="btn btn--primary" onClick={() => moves.ritualAck!()}>知道了</button>
    </div>
  );
}

/** The cult leader's private view of the navigation team's factions. */
function RitualTeamPeek({ view }: { view: PlayerView }) {
  const team = [view.officers.captain, view.officers.lieutenant, view.officers.navigator]
    .filter((x): x is PlayerId => !!x);
  const known = new Map(view.knowledge.map((k) => [k.about, k.team]));
  return (
    <ul className="peek">
      {team.map((id) => {
        const t = known.get(id);
        return (
          <li key={id}>
            {name(view, id)}：{t ? `${FACTION_ICON[t]}${FACTION_LABEL[t]}` : '（未记录）'}
          </li>
        );
      })}
    </ul>
  );
}
