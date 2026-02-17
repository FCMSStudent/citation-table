import type { CanonicalPaper } from "./lit-search.ts";

export type ExtractionRunTrigger =
  | "initial_pipeline"
  | "initial_pipeline_cached"
  | "pdf_reextract"
  | "add_study"
  | "manual_rerun"
  | "backfill";

export type ExtractionRunStatus = "processing" | "completed" | "failed";
export type ExtractionRunEngine = "llm" | "scripted" | "hybrid" | "manual" | "unknown";

export interface ColumnInstruction {
  id: string;
  column_key: string;
  label: string;
  data_type: "text" | "number" | "integer" | "boolean" | "date" | "enum" | "json";
  extract_prompt: string;
  required: boolean;
  nullable: boolean;
  regex_pattern: string | null;
  enum_values: string[];
  source_priority: string[];
  normalizer: Record<string, unknown>;
  display_order: number;
  is_enabled: boolean;
}

export interface ExtractionRunSummary {
  id: string;
  report_id: string;
  run_index: number;
  parent_run_id: string | null;
  trigger: ExtractionRunTrigger;
  status: ExtractionRunStatus;
  engine: ExtractionRunEngine;
  created_at: string;
  completed_at: string | null;
  is_active: boolean;
}

export interface ExtractionRunDetail {
  run: Record<string, unknown>;
  columns: Record<string, unknown>[];
  rows: Array<Record<string, unknown> & { cells: Record<string, unknown>[] }>;
}

export interface PersistExtractionRunInput {
  reportId: string;
  userId?: string;
  trigger: ExtractionRunTrigger;
  status: ExtractionRunStatus;
  engine: ExtractionRunEngine;
  question?: string | null;
  normalizedQuery?: string | null;
  litRequest?: Record<string, unknown> | null;
  litResponse?: Record<string, unknown> | null;
  results?: unknown[] | null;
  partialResults?: unknown[] | null;
  evidenceTable?: unknown[] | null;
  briefJson?: Record<string, unknown> | null;
  coverageReport?: Record<string, unknown> | null;
  searchStats?: Record<string, unknown> | null;
  extractionStats?: Record<string, unknown> | null;
  canonicalPapers?: CanonicalPaper[] | null;
  errorMessage?: string | null;
  columnSetId?: string | null;
  parentRunId?: string | null;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string | null;
}

export interface PersistExtractionRunResult {
  runId: string;
  runIndex: number;
  columnSetId: string;
}

interface SupabaseErrorLike {
  message: string;
}

interface SupabaseResponse<T> {
  data: T | null;
  error: SupabaseErrorLike | null;
}

interface SupabaseQueryBuilder<T = unknown> extends PromiseLike<SupabaseResponse<T>> {
  select(columns: string, options?: Record<string, unknown>): SupabaseQueryBuilder<T>;
  eq(column: string, value: unknown): SupabaseQueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): SupabaseQueryBuilder<T>;
  limit(count: number): SupabaseQueryBuilder<T>;
  in(column: string, values: unknown[]): SupabaseQueryBuilder<T>;
  maybeSingle(): SupabaseQueryBuilder<T | null>;
  single(): SupabaseQueryBuilder<T>;
  upsert(values: unknown, options?: Record<string, unknown>): SupabaseQueryBuilder<T>;
  insert(values: unknown): SupabaseQueryBuilder<T>;
  update(values: unknown): SupabaseQueryBuilder<T>;
}

export interface SupabaseClientLike {
  from<T = unknown>(table: string): SupabaseQueryBuilder<T>;
  rpc<T = unknown>(fn: string, params?: Record<string, unknown>): Promise<SupabaseResponse<T>>;
}

const DEFAULT_COLUMN_SET_NAME = "canonical_evidence_v1";
const DEFAULT_COLUMN_SET_VERSION = 1;

type JsonRecord = Record<string, unknown>;

function asJsonRecord(input: unknown): JsonRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as JsonRecord;
}

function toJsonArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function scalarText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function toJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return value;
}

function canonicalByPaperId(canonicalPapers: CanonicalPaper[] | null | undefined): Map<string, CanonicalPaper> {
  const map = new Map<string, CanonicalPaper>();
  for (const paper of toJsonArray(canonicalPapers)) {
    if (paper?.paper_id) map.set(paper.paper_id, paper);
  }
  return map;
}

async function resolveDefaultColumnSetId(client: SupabaseClientLike): Promise<string> {
  const { data, error } = await client
    .from<{ id: string }>("extraction_column_sets")
    .select("id")
    .eq("scope", "system")
    .eq("name", DEFAULT_COLUMN_SET_NAME)
    .eq("version", DEFAULT_COLUMN_SET_VERSION)
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(`Default extraction column set not found (${DEFAULT_COLUMN_SET_NAME} v${DEFAULT_COLUMN_SET_VERSION})`);
  }

  return data.id;
}

async function getRunByIndex(
  client: SupabaseClientLike,
  reportId: string,
  runIndex: number,
): Promise<{ id: string; run_index: number } | null> {
  const { data, error } = await client
    .from<{ id: string; run_index: number }>("extraction_runs")
    .select("id,run_index")
    .eq("report_id", reportId)
    .eq("run_index", runIndex)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load extraction run by index: ${error.message}`);
  }

  return data || null;
}

async function allocateNextRunIndex(client: SupabaseClientLike, reportId: string): Promise<number> {
  const { data, error } = await client.rpc<number>("next_run_index", { p_report_id: reportId });
  if (error || typeof data !== "number" || !Number.isFinite(data) || data < 1) {
    throw new Error(`Failed to allocate extraction run index: ${error?.message || "invalid response"}`);
  }
  return data;
}

async function loadInstructions(client: SupabaseClientLike, columnSetId: string): Promise<ColumnInstruction[]> {
  const { data, error } = await client
    .from<ColumnInstruction>("extraction_column_instructions")
    .select("id,column_key,label,data_type,extract_prompt,required,nullable,regex_pattern,enum_values,source_priority,normalizer,display_order,is_enabled")
    .eq("set_id", columnSetId)
    .eq("is_enabled", true)
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to load extraction instructions: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

async function insertRunColumns(client: SupabaseClientLike, runId: string, instructions: ColumnInstruction[]): Promise<Array<ColumnInstruction & { run_column_id: string }>> {
  if (instructions.length === 0) {
    return [];
  }

  const payload = instructions.map((column) => ({
    run_id: runId,
    source_instruction_id: column.id,
    column_key: column.column_key,
    label: column.label,
    data_type: column.data_type,
    extract_prompt: column.extract_prompt,
    required: column.required,
    nullable: column.nullable,
    regex_pattern: column.regex_pattern,
    enum_values: column.enum_values || [],
    source_priority: column.source_priority || ["abstract", "metadata", "pdf"],
    normalizer: column.normalizer || {},
    display_order: column.display_order,
    is_enabled: column.is_enabled,
  }));

  const { error: insertError } = await client
    .from("extraction_run_columns")
    .insert(payload);

  if (insertError) {
    throw new Error(`Failed to insert extraction run columns: ${insertError.message}`);
  }

  const { data, error } = await client
    .from<Array<ColumnInstruction & { id: string }>>("extraction_run_columns")
    .select("id,column_key,label,data_type,extract_prompt,required,nullable,regex_pattern,enum_values,source_priority,normalizer,display_order,is_enabled")
    .eq("run_id", runId)
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to read extraction run columns: ${error.message}`);
  }

  return (data || []).map((column) => ({
    ...column,
    id: column.id,
    run_column_id: column.id,
  }));
}

async function insertRunRows(
  client: SupabaseClientLike,
  runId: string,
  evidenceTable: Record<string, unknown>[],
  canonicalPapers: CanonicalPaper[] | null | undefined,
): Promise<Array<{ id: string; row_rank: number; row: Record<string, unknown> }>> {
  if (evidenceTable.length === 0) {
    return [];
  }

  const canonicalById = canonicalByPaperId(canonicalPapers);
  const rowPayload = evidenceTable.map((row, index) => ({
    run_id: runId,
    row_rank: typeof row.rank === "number" && Number.isFinite(row.rank) && row.rank > 0 ? row.rank : index + 1,
    paper_id: typeof row.paper_id === "string" ? row.paper_id : null,
    canonical_paper: typeof row.paper_id === "string" && canonicalById.has(row.paper_id) ? canonicalById.get(row.paper_id) : {},
  }));

  const { error } = await client
    .from("extraction_run_rows")
    .insert(rowPayload);

  if (error) {
    throw new Error(`Failed to insert extraction run rows: ${error.message}`);
  }

  const { data: savedRows, error: readError } = await client
    .from<Array<{ id: string; row_rank: number }>>("extraction_run_rows")
    .select("id,row_rank")
    .eq("run_id", runId)
    .order("row_rank", { ascending: true });

  if (readError) {
    throw new Error(`Failed to read extraction run rows: ${readError.message}`);
  }

  const byRank = new Map<number, string>();
  for (const row of savedRows || []) {
    byRank.set(row.row_rank, row.id);
  }

  return rowPayload.map((row, index) => ({
    id: byRank.get(row.row_rank) || "",
    row_rank: row.row_rank,
    row: evidenceTable[index],
  })).filter((row) => Boolean(row.id));
}

async function insertRunCells(
  client: SupabaseClientLike,
  runColumns: Array<ColumnInstruction & { run_column_id: string }>,
  runRows: Array<{ id: string; row_rank: number; row: Record<string, unknown> }>,
): Promise<void> {
  if (runColumns.length === 0 || runRows.length === 0) return;

  const payload: JsonRecord[] = [];
  for (const row of runRows) {
    const rowObject = row.row;
    for (const column of runColumns) {
      const rawValue = rowObject[column.column_key];
      const missing = rawValue === undefined || rawValue === null;
      payload.push({
        row_id: row.id,
        run_column_id: column.run_column_id,
        value_text: missing ? null : scalarText(rawValue),
        value_number: typeof rawValue === "number" ? rawValue : null,
        value_boolean: typeof rawValue === "boolean" ? rawValue : null,
        value_json: missing ? null : toJsonValue(rawValue),
        value_null: missing,
        confidence: null,
        evidence: {},
        status: missing ? "missing" : "filled",
      });
    }
  }

  const chunkSize = 1000;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error } = await client.from("extraction_run_cells").insert(chunk);
    if (error) {
      throw new Error(`Failed to insert extraction run cells: ${error.message}`);
    }
  }
}

export async function persistExtractionRun(
  client: SupabaseClientLike,
  input: PersistExtractionRunInput,
): Promise<PersistExtractionRunResult> {
  const columnSetId = input.columnSetId || await resolveDefaultColumnSetId(client);
  const runIndex = await allocateNextRunIndex(client, input.reportId);
  const previousRun = runIndex > 1 && input.parentRunId === undefined
    ? await getRunByIndex(client, input.reportId, runIndex - 1)
    : null;
  const parentRunId = input.parentRunId === undefined ? previousRun?.id ?? null : input.parentRunId;

  const { data: runInsert, error: runError } = await client
    .from<{ id: string; run_index: number }>("extraction_runs")
    .insert({
      report_id: input.reportId,
      run_index: runIndex,
      parent_run_id: parentRunId,
      trigger: input.trigger,
      status: input.status,
      engine: input.engine,
      column_set_id: columnSetId,
      question: input.question ?? null,
      normalized_query: input.normalizedQuery ?? null,
      lit_request: input.litRequest ?? {},
      lit_response: input.litResponse ?? {},
      results: toJsonArray(input.results),
      partial_results: toJsonArray(input.partialResults),
      evidence_table: toJsonArray(input.evidenceTable),
      brief_json: input.briefJson ?? {},
      coverage_report: input.coverageReport ?? {},
      search_stats: input.searchStats ?? {},
      extraction_stats: input.extractionStats ?? {},
      canonical_papers: toJsonArray(input.canonicalPapers),
      error_message: input.errorMessage ?? null,
      created_by: input.userId ?? null,
      created_at: input.createdAt ?? new Date().toISOString(),
      started_at: input.startedAt ?? new Date().toISOString(),
      completed_at: input.completedAt ?? (input.status === "completed" ? new Date().toISOString() : null),
    })
    .select("id,run_index")
    .single();

  if (runError || !runInsert?.id) {
    throw new Error(`Failed to persist extraction run: ${runError?.message || "unknown"}`);
  }

  const runId = runInsert.id;
  const instructions = await loadInstructions(client, columnSetId);
  const runColumns = await insertRunColumns(client, runId, instructions);
  const evidenceRows = toJsonArray(input.evidenceTable).filter((row): row is Record<string, unknown> => {
    return !!row && typeof row === "object" && !Array.isArray(row);
  });
  const runRows = await insertRunRows(client, runId, evidenceRows, input.canonicalPapers);
  await insertRunCells(client, runColumns, runRows);

  const reportUpdate: JsonRecord = {
    active_extraction_run_id: runId,
    active_column_set_id: columnSetId,
    extraction_run_count: runInsert.run_index,
  };

  const { error: reportError } = await client
    .from("research_reports")
    .update(reportUpdate)
    .eq("id", input.reportId);

  if (reportError) {
    throw new Error(`Failed to update report active extraction run: ${reportError.message}`);
  }

  return {
    runId,
    runIndex: runInsert.run_index,
    columnSetId,
  };
}

export async function listExtractionRuns(
  client: SupabaseClientLike,
  reportId: string,
  activeRunId: string | null,
): Promise<ExtractionRunSummary[]> {
  const { data, error } = await client
    .from<Array<{
      id: string;
      report_id: string;
      run_index: number;
      parent_run_id: string | null;
      trigger: ExtractionRunTrigger;
      status: ExtractionRunStatus;
      engine: ExtractionRunEngine;
      created_at: string;
      completed_at: string | null;
    }>>("extraction_runs")
    .select("id,report_id,run_index,parent_run_id,trigger,status,engine,created_at,completed_at")
    .eq("report_id", reportId)
    .order("run_index", { ascending: false });

  if (error) {
    throw new Error(`Failed to list extraction runs: ${error.message}`);
  }

  return (data || []).map((run) => ({
    ...run,
    is_active: run.id === activeRunId,
  }));
}

export async function getExtractionRunDetail(
  client: SupabaseClientLike,
  reportId: string,
  runId: string,
): Promise<ExtractionRunDetail | null> {
  const { data: run, error: runError } = await client
    .from<Record<string, unknown>>("extraction_runs")
    .select("*")
    .eq("id", runId)
    .eq("report_id", reportId)
    .maybeSingle();

  if (runError) {
    throw new Error(`Failed to read extraction run: ${runError.message}`);
  }
  if (!run) return null;

  const { data: columns, error: colError } = await client
    .from<Record<string, unknown>[]>("extraction_run_columns")
    .select("id,column_key,label,data_type,extract_prompt,required,nullable,regex_pattern,enum_values,source_priority,normalizer,display_order,is_enabled")
    .eq("run_id", runId)
    .order("display_order", { ascending: true });

  if (colError) {
    throw new Error(`Failed to read extraction run columns: ${colError.message}`);
  }

  const { data: rows, error: rowError } = await client
    .from<Record<string, unknown>[]>("extraction_run_rows")
    .select("id,row_rank,paper_id,canonical_paper,created_at")
    .eq("run_id", runId)
    .order("row_rank", { ascending: true });

  if (rowError) {
    throw new Error(`Failed to read extraction run rows: ${rowError.message}`);
  }

  const rowIds = (rows || []).map((row) => String(row.id));
  const { data: cells, error: cellError } = rowIds.length === 0
    ? { data: [] as Record<string, unknown>[], error: null }
    : await client
      .from<Record<string, unknown>[]>("extraction_run_cells")
      .select("row_id,run_column_id,value_text,value_number,value_boolean,value_json,value_null,confidence,evidence,status,created_at")
      .in("row_id", rowIds);

  if (cellError) {
    throw new Error(`Failed to read extraction run cells: ${cellError.message}`);
  }

  const cellsByRow = new Map<string, Record<string, unknown>[]>();
  for (const cell of cells || []) {
    const rowId = String(cell.row_id || "");
    if (!cellsByRow.has(rowId)) cellsByRow.set(rowId, []);
    cellsByRow.get(rowId)!.push(cell);
  }

  const rowsWithCells = (rows || []).map((row) => ({
    ...row,
    cells: cellsByRow.get(String(row.id || "")) || [],
  }));

  return {
    run,
    columns: columns || [],
    rows: rowsWithCells,
  };
}
