import { useEffect, useState } from 'react';
import { kernelRecommend } from '../lib/client';
import type { Rec, Stats } from '../lib/types';
import Card from './Card';

/**
 * "Where you're heading" — the session kernel's recommendations.
 *
 * One rail: the kernel's top picks, ranked in this tab from what you have played
 * and rated. It used to carry a second rail narrowing the SAME weights to the other
 * publisher; with a single publisher that rail could never render, so it is gone
 * (`git log` has it if a second namespace is ever folded in — the mechanism was
 * `kernelRecommend(6, otherOwner)`, a filter over the identical ranking, never a
 * re-rank).
 */
export default function KernelRail({
  railVersion,
}: { railVersion: number; stats: Stats }) {
  const [recs, setRecs] = useState<Rec[]>([]);

  // Keyed on railVersion, not version: starting a track feeds the kernel but must
  // not re-rank the grid under the click that started it. See KernelCtx.
  useEffect(() => {
    let live = true;
    void kernelRecommend(12).then((r) => { if (live) setRecs(r); });
    return () => { live = false; };
  }, [railVersion]);

  if (!recs.length) return null;

  return (
    <>
      <div className="section-head">
        <h2>For you</h2>
        <span className="count">from what you've finished and rated, computed in your browser</span>
      </div>
      <div className="grid">
        {recs.map((r) => <Card key={r.id} rec={r} queue={recs} />)}
      </div>
    </>
  );
}
