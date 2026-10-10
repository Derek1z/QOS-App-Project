import type { Hypothesis } from '../../../shared/api'

/** One row of the Cell Investigation root-cause window. */
export interface RcaRow {
  title: string
  confidence: Hypothesis['confidence']
  /** 0..100, for the bar */
  score: number
  verdict: Hypothesis['verdict']
  /** how many observations support / contradict the hypothesis */
  supporting: number
  contradicting: number
}

/** The cell's real hypotheses, strongest first (the window used to draw a
 *  fixed 50/30/20 ring with no data behind it). */
export function rcaBreakdown(hypotheses: Hypothesis[]): RcaRow[] {
  return hypotheses
    .map((h) => ({
      title: h.title,
      confidence: h.confidence,
      score: Math.max(0, Math.min(100, Math.round(h.score))),
      verdict: h.verdict,
      supporting: h.supporting?.length ?? 0,
      contradicting: h.contradicting?.length ?? 0
    }))
    .sort((a, b) => b.score - a.score)
}
