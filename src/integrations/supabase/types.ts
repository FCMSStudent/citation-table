export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      dedup_source_priority: {
        Row: {
          created_at: string
          id: string
          source: string
          trust_score: number
        }
        Insert: {
          created_at?: string
          id?: string
          source: string
          trust_score?: number
        }
        Update: {
          created_at?: string
          id?: string
          source?: string
          trust_score?: number
        }
        Relationships: []
      }
      extraction_column_instructions: {
        Row: {
          column_key: string
          created_at: string
          data_type: string
          display_order: number
          enum_values: Json | null
          extract_prompt: string
          id: string
          is_enabled: boolean
          label: string
          normalizer: Json | null
          nullable: boolean
          regex_pattern: string | null
          required: boolean
          set_id: string
          source_priority: Json | null
        }
        Insert: {
          column_key: string
          created_at?: string
          data_type?: string
          display_order?: number
          enum_values?: Json | null
          extract_prompt?: string
          id?: string
          is_enabled?: boolean
          label: string
          normalizer?: Json | null
          nullable?: boolean
          regex_pattern?: string | null
          required?: boolean
          set_id: string
          source_priority?: Json | null
        }
        Update: {
          column_key?: string
          created_at?: string
          data_type?: string
          display_order?: number
          enum_values?: Json | null
          extract_prompt?: string
          id?: string
          is_enabled?: boolean
          label?: string
          normalizer?: Json | null
          nullable?: boolean
          regex_pattern?: string | null
          required?: boolean
          set_id?: string
          source_priority?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_column_instructions_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "extraction_column_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_column_sets: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          scope: string
          version: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          scope?: string
          version?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          scope?: string
          version?: number
        }
        Relationships: []
      }
      extraction_run_cells: {
        Row: {
          confidence: number | null
          created_at: string
          evidence: Json | null
          id: string
          row_id: string
          run_column_id: string
          status: string | null
          value_boolean: boolean | null
          value_json: Json | null
          value_null: boolean | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          evidence?: Json | null
          id?: string
          row_id: string
          run_column_id: string
          status?: string | null
          value_boolean?: boolean | null
          value_json?: Json | null
          value_null?: boolean | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          evidence?: Json | null
          id?: string
          row_id?: string
          run_column_id?: string
          status?: string | null
          value_boolean?: boolean | null
          value_json?: Json | null
          value_null?: boolean | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_run_cells_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "extraction_run_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_run_cells_run_column_id_fkey"
            columns: ["run_column_id"]
            isOneToOne: false
            referencedRelation: "extraction_run_columns"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_run_columns: {
        Row: {
          column_key: string
          created_at: string
          data_type: string
          display_order: number | null
          enum_values: Json | null
          extract_prompt: string | null
          id: string
          is_enabled: boolean | null
          label: string
          normalizer: Json | null
          nullable: boolean | null
          regex_pattern: string | null
          required: boolean | null
          run_id: string
          source_instruction_id: string | null
          source_priority: Json | null
        }
        Insert: {
          column_key: string
          created_at?: string
          data_type?: string
          display_order?: number | null
          enum_values?: Json | null
          extract_prompt?: string | null
          id?: string
          is_enabled?: boolean | null
          label: string
          normalizer?: Json | null
          nullable?: boolean | null
          regex_pattern?: string | null
          required?: boolean | null
          run_id: string
          source_instruction_id?: string | null
          source_priority?: Json | null
        }
        Update: {
          column_key?: string
          created_at?: string
          data_type?: string
          display_order?: number | null
          enum_values?: Json | null
          extract_prompt?: string | null
          id?: string
          is_enabled?: boolean | null
          label?: string
          normalizer?: Json | null
          nullable?: boolean | null
          regex_pattern?: string | null
          required?: boolean | null
          run_id?: string
          source_instruction_id?: string | null
          source_priority?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_run_columns_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_run_rows: {
        Row: {
          canonical_paper: Json | null
          created_at: string
          id: string
          paper_id: string | null
          row_rank: number
          run_id: string
        }
        Insert: {
          canonical_paper?: Json | null
          created_at?: string
          id?: string
          paper_id?: string | null
          row_rank: number
          run_id: string
        }
        Update: {
          canonical_paper?: Json | null
          created_at?: string
          id?: string
          paper_id?: string | null
          row_rank?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_run_rows_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_runs: {
        Row: {
          brief_json: Json | null
          canonical_papers: Json | null
          column_set_id: string | null
          completed_at: string | null
          coverage_report: Json | null
          created_at: string
          created_by: string | null
          deterministic_flag: boolean | null
          engine: string
          error_message: string | null
          evidence_table: Json | null
          extraction_stats: Json | null
          extractor_version: string | null
          id: string
          lit_request: Json | null
          lit_response: Json | null
          model: string | null
          normalized_query: string | null
          parent_run_id: string | null
          partial_results: Json | null
          prompt_hash: string | null
          question: string | null
          report_id: string
          results: Json | null
          run_index: number
          search_stats: Json | null
          started_at: string | null
          status: string
          trigger: string
        }
        Insert: {
          brief_json?: Json | null
          canonical_papers?: Json | null
          column_set_id?: string | null
          completed_at?: string | null
          coverage_report?: Json | null
          created_at?: string
          created_by?: string | null
          deterministic_flag?: boolean | null
          engine?: string
          error_message?: string | null
          evidence_table?: Json | null
          extraction_stats?: Json | null
          extractor_version?: string | null
          id?: string
          lit_request?: Json | null
          lit_response?: Json | null
          model?: string | null
          normalized_query?: string | null
          parent_run_id?: string | null
          partial_results?: Json | null
          prompt_hash?: string | null
          question?: string | null
          report_id: string
          results?: Json | null
          run_index: number
          search_stats?: Json | null
          started_at?: string | null
          status?: string
          trigger: string
        }
        Update: {
          brief_json?: Json | null
          canonical_papers?: Json | null
          column_set_id?: string | null
          completed_at?: string | null
          coverage_report?: Json | null
          created_at?: string
          created_by?: string | null
          deterministic_flag?: boolean | null
          engine?: string
          error_message?: string | null
          evidence_table?: Json | null
          extraction_stats?: Json | null
          extractor_version?: string | null
          id?: string
          lit_request?: Json | null
          lit_response?: Json | null
          model?: string | null
          normalized_query?: string | null
          parent_run_id?: string | null
          partial_results?: Json | null
          prompt_hash?: string | null
          question?: string | null
          report_id?: string
          results?: Json | null
          run_index?: number
          search_stats?: Json | null
          started_at?: string | null
          status?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_runs_column_set_id_fkey"
            columns: ["column_set_id"]
            isOneToOne: false
            referencedRelation: "extraction_column_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_runs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "research_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      lit_paper_cache: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          paper_id: string
          paper_payload: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          paper_id: string
          paper_payload?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          paper_id?: string
          paper_payload?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      lit_query_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          id: string
          request_payload: Json | null
          response_payload: Json | null
          updated_at: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          id?: string
          request_payload?: Json | null
          response_payload?: Json | null
          updated_at?: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          id?: string
          request_payload?: Json | null
          response_payload?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      metadata_enrichment_cache: {
        Row: {
          confidence: number | null
          created_at: string
          doi_norm: string | null
          expires_at: string
          fetched_at: string | null
          id: string
          lookup_key: string
          lookup_kind: string
          provider_payloads: Json | null
          reason_codes: Json | null
          resolved_metadata: Json | null
          status: string
          title_fingerprint: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          doi_norm?: string | null
          expires_at: string
          fetched_at?: string | null
          id?: string
          lookup_key: string
          lookup_kind?: string
          provider_payloads?: Json | null
          reason_codes?: Json | null
          resolved_metadata?: Json | null
          status?: string
          title_fingerprint?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          doi_norm?: string | null
          expires_at?: string
          fetched_at?: string | null
          id?: string
          lookup_key?: string
          lookup_kind?: string
          provider_payloads?: Json | null
          reason_codes?: Json | null
          resolved_metadata?: Json | null
          status?: string
          title_fingerprint?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      metadata_enrichment_events: {
        Row: {
          confidence: number | null
          created_at: string
          fields_applied: Json | null
          function_name: string
          id: string
          latency_ms: number | null
          lookup_key: string | null
          mode: string
          outcome: string
          paper_id: string | null
          provider_statuses: Json | null
          providers_attempted: Json | null
          reason_codes: Json | null
          report_id: string | null
          search_id: string | null
          stack: string
          used_cache: boolean | null
          user_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          fields_applied?: Json | null
          function_name: string
          id?: string
          latency_ms?: number | null
          lookup_key?: string | null
          mode: string
          outcome: string
          paper_id?: string | null
          provider_statuses?: Json | null
          providers_attempted?: Json | null
          reason_codes?: Json | null
          report_id?: string | null
          search_id?: string | null
          stack: string
          used_cache?: boolean | null
          user_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          fields_applied?: Json | null
          function_name?: string
          id?: string
          latency_ms?: number | null
          lookup_key?: string | null
          mode?: string
          outcome?: string
          paper_id?: string | null
          provider_statuses?: Json | null
          providers_attempted?: Json | null
          reason_codes?: Json | null
          report_id?: string | null
          search_id?: string | null
          stack?: string
          used_cache?: boolean | null
          user_id?: string | null
        }
        Relationships: []
      }
      metadata_enrichment_jobs: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          max_attempts: number
          next_run_at: string
          payload: Json
          report_id: string | null
          search_id: string | null
          stack: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_run_at?: string
          payload?: Json
          report_id?: string | null
          search_id?: string | null
          stack: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_run_at?: string
          payload?: Json
          report_id?: string | null
          search_id?: string | null
          stack?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          client_ip: string
          created_at: string
          function_name: string
          id: string
        }
        Insert: {
          client_ip: string
          created_at?: string
          function_name: string
          id?: string
        }
        Update: {
          client_ip?: string
          created_at?: string
          function_name?: string
          id?: string
        }
        Relationships: []
      }
      research_jobs: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          payload: Json
          provider: string
          report_id: string
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          payload?: Json
          provider?: string
          report_id: string
          stage?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          payload?: Json
          provider?: string
          report_id?: string
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_jobs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "research_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      research_reports: {
        Row: {
          active_column_set_id: string | null
          active_extraction_run_id: string | null
          arxiv_count: number | null
          brief_json: Json | null
          completed_at: string | null
          coverage_report: Json | null
          created_at: string
          error_message: string | null
          evidence_table: Json | null
          extraction_run_count: number | null
          id: string
          lit_request: Json | null
          lit_response: Json | null
          narrative_synthesis: string | null
          normalized_query: string | null
          openalex_count: number | null
          pubmed_count: number | null
          question: string
          results: Json | null
          search_stats: Json | null
          semantic_scholar_count: number | null
          status: string
          total_papers_searched: number | null
          user_id: string | null
        }
        Insert: {
          active_column_set_id?: string | null
          active_extraction_run_id?: string | null
          arxiv_count?: number | null
          brief_json?: Json | null
          completed_at?: string | null
          coverage_report?: Json | null
          created_at?: string
          error_message?: string | null
          evidence_table?: Json | null
          extraction_run_count?: number | null
          id?: string
          lit_request?: Json | null
          lit_response?: Json | null
          narrative_synthesis?: string | null
          normalized_query?: string | null
          openalex_count?: number | null
          pubmed_count?: number | null
          question: string
          results?: Json | null
          search_stats?: Json | null
          semantic_scholar_count?: number | null
          status?: string
          total_papers_searched?: number | null
          user_id?: string | null
        }
        Update: {
          active_column_set_id?: string | null
          active_extraction_run_id?: string | null
          arxiv_count?: number | null
          brief_json?: Json | null
          completed_at?: string | null
          coverage_report?: Json | null
          created_at?: string
          error_message?: string | null
          evidence_table?: Json | null
          extraction_run_count?: number | null
          id?: string
          lit_request?: Json | null
          lit_response?: Json | null
          narrative_synthesis?: string | null
          normalized_query?: string | null
          openalex_count?: number | null
          pubmed_count?: number | null
          question?: string
          results?: Json | null
          search_stats?: Json | null
          semantic_scholar_count?: number | null
          status?: string
          total_papers_searched?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      research_run_events: {
        Row: {
          created_at: string
          duration: number | null
          duration_ms: number | null
          error_category: string | null
          error_code: string | null
          event_at: string
          event_type: string | null
          id: string
          input_hash: string | null
          message: string | null
          output_hash: string | null
          report_id: string | null
          run_id: string | null
          stage: string
          status: string
          trace_id: string | null
        }
        Insert: {
          created_at?: string
          duration?: number | null
          duration_ms?: number | null
          error_category?: string | null
          error_code?: string | null
          event_at: string
          event_type?: string | null
          id?: string
          input_hash?: string | null
          message?: string | null
          output_hash?: string | null
          report_id?: string | null
          run_id?: string | null
          stage: string
          status: string
          trace_id?: string | null
        }
        Update: {
          created_at?: string
          duration?: number | null
          duration_ms?: number | null
          error_category?: string | null
          error_code?: string | null
          event_at?: string
          event_type?: string | null
          id?: string
          input_hash?: string | null
          message?: string | null
          output_hash?: string | null
          report_id?: string | null
          run_id?: string | null
          stage?: string
          status?: string
          trace_id?: string | null
        }
        Relationships: []
      }
      study_pdfs: {
        Row: {
          created_at: string
          doi: string
          id: string
          public_url: string | null
          report_id: string
          status: string
          storage_path: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          doi: string
          id?: string
          public_url?: string | null
          report_id: string
          status?: string
          storage_path?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          doi?: string
          id?: string
          public_url?: string | null
          report_id?: string
          status?: string
          storage_path?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "study_pdfs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "research_reports"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      next_run_index: { Args: { p_report_id: string }; Returns: number }
      research_jobs_claim: {
        Args: {
          p_batch_size?: number
          p_lease_seconds?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          created_at: string
          dedupe_key: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          payload: Json
          provider: string
          report_id: string
          stage: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "research_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      research_jobs_complete: {
        Args: { p_job_id: string; p_worker_id: string }
        Returns: {
          attempts: number
          created_at: string
          dedupe_key: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          payload: Json
          provider: string
          report_id: string
          stage: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "research_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      research_jobs_enqueue: {
        Args: {
          p_dedupe_key: string
          p_max_attempts?: number
          p_payload: Json
          p_provider: string
          p_report_id: string
          p_stage: string
        }
        Returns: {
          attempts: number
          created_at: string
          dedupe_key: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          payload: Json
          provider: string
          report_id: string
          stage: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "research_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      research_jobs_fail: {
        Args: { p_error?: string; p_job_id: string; p_worker_id: string }
        Returns: {
          attempts: number
          created_at: string
          dedupe_key: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          payload: Json
          provider: string
          report_id: string
          stage: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "research_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
