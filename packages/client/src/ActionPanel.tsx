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
  COLOR_GLYPH, FACTION_ICON, FACTION_LABEL, NAV_CARD_LABEL, PHASE_LABEL, RITUAL_LABEL,
} from './labels.js';
import {
  eligibleTeam, iAmAppointing, iMayJumpOverboard, iMustContribute, iMustResolveLogbook,
  iMustReveal, iOweMutinyPledge, myContributableCards, myLogbook, pickableTargets,
} from './actions.js';

export interface ActionPanelProps {
  view: PlayerView;
  moves: Record<string, (...args: unknown[]) => void>;
}

const name = (view: PlayerView, id: PlayerId): string =>
  (id === view.you.id ? view.you : view.others.find((p) => p.id === id))?.name ?? id;

/** A two-card splitter: click one to keep, one to discard. */
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
  return (
    <div className="cardsplit">
      <p className="hint">选择要保留的牌（另一张将被弃入深海）</p>
      <div className="cardsplit__hand">
        {cards.map((c, i) => (
          <button
            key={`${c}-${i}`}
            className={
              'navcard' + (keep === i ? ' navcard--keep' : '') + (discard === i ? ' navcard--drop' : '')
            }
            onClick={() => {
              if (keep === i) { setKeep(null); return; }
              if (discard === i) { setDiscard(null); return; }
              if (keep === null) setKeep(i);
              else if (discard === null) setDiscard(i);
              else { setDiscard(i); }
            }}
          >
            <span className="navcard__glyph">{COLOR_GLYPH[cardColor(c)]}</span>
            <span className="navcard__name">{NAV_CARD_LABEL[c]}</span>
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

/** Colour is encoded in the card id; keep the mapping local to the card UI. */
function cardColor(id: NavCardId): 'yellow' | 'blue' | 'red' {
  switch (id) {
    case 'cultUprising': return 'yellow';
    case 'blueDrunk':
    case 'disarmed': return 'blue';
    default: return 'red';
  }
}

/** A read-only row of navigation cards. */
function CardList({ cards }: { cards: NavCardId[] }) {
  if (cards.length === 0) return <p className="hint">（无）</p>;
  return (
    <div className="cardsplit__hand">
      {cards.map((c, i) => (
        <div key={`${c}-${i}`} className="navcard navcard--static">
          <span className="navcard__glyph">{COLOR_GLYPH[cardColor(c)]}</span>
          <span className="navcard__name">{NAV_CARD_LABEL[c]}</span>
        </div>
      ))}
    </div>
  );
}

function TargetPicker({
  view, title, confirmLabel, excludeSelf, onConfirm,
}: {
  view: PlayerView;
  title: string;
  confirmLabel: string;
  excludeSelf?: boolean;
  onConfirm: (target: PlayerId) => void;
}) {
  const [pick, setPick] = useState<PlayerId | null>(null);
  const targets = pickableTargets(view, excludeSelf ?? true);
  return (
    <div className="picker">
      <p className="hint">{title}</p>
      <div className="picker__grid">
        {targets.map((id) => (
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

export function ActionPanel({ view, moves }: ActionPanelProps) {
  // 1. Appoint the team.
  if (iAmAppointing(view)) {
    return <AppointForm view={view} moves={moves} />;
  }

  // 2. Mutiny pledge.
  if (iOweMutinyPledge(view)) {
    return <MutinyForm view={view} moves={moves} />;
  }
  // Pledged and waiting for the rest of the crew's fists to open.
  if (view.phase === 'loyalty' && view.mutiny.active && view.you.alive &&
      view.officers.captain !== view.you.id) {
    return (
      <div className="panel panel--quiet">
        <p className="hint">你已亮牌，等待其他船员…</p>
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
        <p className="hint">你是领航员：从船长与中尉的牌中弃掉一张，留下的一张将决定航向。</p>
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
  if (iMustReveal(view)) {
    return (
      <div className="panel">
        <p className="hint">翻开最终的航海卡并移动船。</p>
        <button className="btn btn--primary" onClick={() => moves.revealAndExecute!()}>
          翻开航海卡
        </button>
      </div>
    );
  }

  // 4. Pendings that need a specific actor.
  const p = view.pending;
  if (p?.isYou && p.kind !== 'cardEffect') {
    return <PendingForm view={view} moves={moves} kind={p.kind} />;
  }

  // 5. Host escape hatch.
  if (view.isHost) {
    return (
      <div className="panel panel--quiet">
        <p className="hint">
          {p
            ? `等待 ${name(view, p.by)} 操作…`
            : '等待其他玩家…'}
        </p>
        <button className="btn btn--ghost" onClick={() => moves.forceAdvance!()}>
          ⏭ 房主强制推进
        </button>
      </div>
    );
  }

  return (
    <div className="panel panel--quiet">
      <p className="hint">{p ? `等待 ${name(view, p.by)} 操作…` : `当前阶段：${PHASE_LABEL[view.phase]}`}</p>
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
      <p className="hint">选择中尉</p>
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

function MutinyForm({ view, moves }: { view: PlayerView; moves: ActionPanelProps['moves'] }) {
  const max = view.you.guns;
  const [guns, setGuns] = useState(0);
  return (
    <div className="panel">
      <h3 className="panel__title">忠诚提问 · 哗变</h3>
      <p className="hint">
        船长已任命 {name(view, view.officers.lieutenant ?? '')} 与 {name(view, view.officers.navigator ?? '')}。
        不满意可以亮枪哗变（阈值 {view.mutiny.threshold}）。
      </p>
      <label className="slider">
        <span>亮出 {guns} 把枪（你有 {max} 把）</span>
        <input
          type="range" min={0} max={max} value={guns}
          onChange={(e) => setGuns(Number(e.target.value))}
        />
      </label>
      <button className="btn btn--primary" onClick={() => moves.mutinyPledge!(guns)}>
        {guns === 0 ? '宣誓忠诚（不哗变）' : `亮出 ${guns} 把枪`}
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
          title="紧急航行：指派一名紧急领航员（可选轮休中的玩家）"
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
    // The actor IS the Cult Leader (already Cult), so they can never be a legal
    // target. Other already-converted cultists stay in the list because teams
    // are secret — a real player cannot know either.
    return (
      <TargetPicker
        view={view}
        title="邪教皈依：选择一名可转化的玩家，使其成为邪教徒"
        confirmLabel="皈依"
        onConfirm={(target) => moves.ritualConversion!(target)}
      />
    );
  }
  if (ritual === 'gunsStash') {
    const total = Object.values(grants).reduce((a, b) => a + b, 0);
    const everyone: PlayerId[] = [view.you.id, ...view.others.map((p) => p.id)];
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
