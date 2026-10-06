import type {
  AnalysisLimits,
  AnalysisReport,
  CompositionReport,
  Design,
  DiffReport,
  ModelBundle,
  SynthesisReport,
  Witness,
  WitnessReplayResult,
} from '../model/types';

/** Reproducibility identifiers (SHA-256 over canonical JSON). Not certification. */
export interface ReportHashes {
  algorithm: string;
  modelHash: string;
  designHash: string;
  policyHash: string;
}

interface Base {
  requestId: number;
  /** Validated serializable bundle (before variants are applied). */
  bundle: ModelBundle;
  variantIds: string[];
  caseIds: string[];
  limits: AnalysisLimits;
}

export type ReasonerRequest =
  | (Base & { kind: 'analyze'; design: Design })
  | (Base & { kind: 'compare'; baseline: Design; candidate: Design })
  | (Base & { kind: 'composition'; candidateIds: string[] })
  | (Base & { kind: 'synthesize'; design: Design; objective: 'least_disruption' | 'maximum_value' })
  | (Base & { kind: 'replay'; design: Design; witness: Witness });

export type ReasonerResultData =
  | { kind: 'analyze'; report: AnalysisReport }
  | { kind: 'compare'; diff: DiffReport }
  | { kind: 'composition'; composition: CompositionReport }
  | { kind: 'synthesize'; synthesis: SynthesisReport }
  | { kind: 'replay'; replay: WitnessReplayResult };

export type ReasonerResponse =
  | { type: 'progress'; requestId: number; completed: number; total: number; label: string }
  | { type: 'result'; requestId: number; data: ReasonerResultData; hashes: ReportHashes; durationMs: number }
  | { type: 'error'; requestId: number; message: string };
