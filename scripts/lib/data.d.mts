// Minimal typings so Vitest/TypeScript can import the data pipeline from tests.
import type { Atlas } from '../../src/data/types';
export declare const ROOT: string;
export declare const DATA_DIR: string;
export declare const MINIMUMS: { systems: number; events: number; factions: number; pivots: number };
export declare const SPEC_PIVOTS: string[];
export declare function loadRaw(): unknown;
export declare function validate(raw: unknown): { errors: string[]; warnings: string[]; counts: Record<string, unknown> };
export declare function normalize(raw: unknown): Atlas;
export declare function gridToWorld(grid: string, id: string): { x: number; y: number } | null;
export declare function parseGrid(grid: string): { col: number; row: number } | null;
export declare function normDate(d: unknown): { start: number; end: number; approx: boolean; uncertainty: number };
