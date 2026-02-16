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
      extraction_column_instructions: {
        Row: {
          column_key: string
          created_at: string
          data_type: string
          display_order: number
          enum_values: string[]
          extract_prompt: string
          id: string
          is_enabled: boolean
          label: string
          normalizer: Json
          nullable: boolean
          regex_pattern: string | null
          required: boolean
          set_id: string
          source_priority: string[]
          updated_at: string
        }
        Insert: {
          column_key: string
          created_at?: string
          data_type: string
          display_order?: number
          enum_values?: string[]
          extract_prompt: string
          id?: string
          is_enabled?: boolean
          label: string
          normalizer?: Json
          nullable?: boolean
          regex_pattern?: string | null
          required?: boolean
          set_id: string
          source_priority?: string[]
          updated_at?: string
        }
        Update: {
          column_key?: string
          created_at?: string
          data_type?: string
          display_order?: number
          enum_values?: string[]
          extract_prompt?: string
          id?: string
          is_enabled?: boolean
          label?: string
          normalizer?: Json
          nullable?: boolean
          regex_pattern?: string | null
          required?: boolean
          set_id?: string
          source_priority?: string[]
          updated_at?: string
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
          created_by: string | null
          domain: string
          id: string
          is_active: boolean
          name: string
          scope: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          domain?: string
          id?: string
          is_active?: boolean
          name: string
          scope: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          domain?: string
          id?: string
          is_active?: boolean
          name?: string
          scope?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      extraction_run_cells: {
        Row: {
          confidence: number | null
          created_at: string
          evidence: Json
          row_id: string
          run_column_id: string
          status: string
          value_boolean: boolean | null
          value_json: Json | null
          value_null: boolean
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          evidence?: Json
          row_id: string
          run_column_id: string
          status: string
          value_boolean?: boolean | null
          value_json?: Json | null
          value_null?: boolean
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          evidence?: Json
          row_id?: string
          run_column_id?: string
          status?: string
          value_boolean?: boolean | null
          value_json?: Json | null
          value_null?: boolean
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
          display_order: number
          enum_values: string[]
          extract_prompt: string
          id: string
          is_enabled: boolean
          label: string
          normalizer: Json
          nullable: boolean
          regex_pattern: string | null
          required: boolean
          run_id: string
          source_instruction_id: string | null
          source_priority: string[]
        }
        Insert: {
          column_key: string
          created_at?: string
          data_type: string
          display_order?: number
          enum_values?: string[]
          extract_prompt: string
          id?: string
          is_enabled?: boolean
          label: string
          normalizer?: Json
          nullable?: boolean
          regex_pattern?: string | null
          required?: boolean
          run_id: string
          source_instruction_id?: string | null
          source_priority?: string[]
        }
        Update: {
          column_key?: string
          created_at?: string
          data_type?: string
          display_order?: number
          enum_values?: string[]
          extract_prompt?: string
          id?: string
          is_enabled?: boolean
          label?: string
          normalizer?: Json
          nullable?: boolean
          regex_pattern?: string | null
          required?: boolean
          run_id?: string
          source_instruction_id?: string | null
          source_priority?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "extraction_run_columns_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_run_columns_source_instruction_id_fkey"
            columns: ["source_instruction_id"]
            isOneToOne: false
            referencedRelation: "extraction_column_instructions"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_run_rows: {
        Row: {
          canonical_paper: Json
          created_at: string
          id: string
          paper_id: string | null
          row_rank: number
          run_id: string
        }
        Insert: {
          canonical_paper?: Json
          created_at?: string
          id?: string
          paper_id?: string | null
          row_rank: number
          run_id: string
        }
        Update: {
          canonical_paper?: Json
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
          brief_json: Json
          canonical_papers: Json
          column_set_id: string
          completed_at: string | null
          coverage_report: Json
          created_at: string
          created_by: string | null
          engine: string
          error_message: string | null
          evidence_table: Json
          extraction_stats: Json
          id: string
          lit_request: Json
          lit_response: Json
          normalized_query: string | null
          parent_run_id: string | null
          partial_results: Json
          question: string | null
          report_id: string
          results: Json
          run_index: number
          search_stats: Json
          started_at: string
          status: string
          trigger: string
        }
        Insert: {
          brief_json?: Json
          canonical_papers?: Json
          column_set_id: string
          completed_at?: string | null
          coverage_report?: Json
          created_at?: string
          created_by?: string | null
          engine: string
          error_message?: string | null
          evidence_table?: Json
          extraction_stats?: Json
          id?: string
          lit_request?: Json
          lit_response?: Json
          normalized_query?: string | null
          parent_run_id?: string | null
          partial_results?: Json
          question?: string | null
          report_id: string
          results?: Json
          run_index: number
          search_stats?: Json
          started_at?: string
          status: string
          trigger: string
        }
        Update: {
          brief_json?: Json
          canonical_papers?: Json
          column_set_id?: string
          completed_at?: string | null
          coverage_report?: Json
          created_at?: string
          created_by?: string | null
          engine?: string
          error_message?: string | null
          evidence_table?: Json
          extraction_stats?: Json
          id?: string
          lit_request?: Json
          lit_response?: Json
          normalized_query?: string | null
          parent_run_id?: string | null
          partial_results?: Json
          question?: string | null
          report_id?: string
          results?: Json
          run_index?: number
          search_stats?: Json
          started_at?: string
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
            foreignKeyName: "extraction_runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
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
      research_reports: {
        Row: {
          active_column_set_id: string | null
          active_extraction_run_id: string | null
          arxiv_count: number | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          extraction_run_count: number
          id: string
          narrative_synthesis: string | null
          normalized_query: string | null
          openalex_count: number | null
          pubmed_count: number | null
          question: string
          results: Json | null
          semantic_scholar_count: number | null
          status: string
          total_papers_searched: number | null
          user_id: string | null
        }
        Insert: {
          active_column_set_id?: string | null
          active_extraction_run_id?: string | null
          arxiv_count?: number | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          extraction_run_count?: number
          id?: string
          narrative_synthesis?: string | null
          normalized_query?: string | null
          openalex_count?: number | null
          pubmed_count?: number | null
          question: string
          results?: Json | null
          semantic_scholar_count?: number | null
          status?: string
          total_papers_searched?: number | null
          user_id?: string | null
        }
        Update: {
          active_column_set_id?: string | null
          active_extraction_run_id?: string | null
          arxiv_count?: number | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          extraction_run_count?: number
          id?: string
          narrative_synthesis?: string | null
          normalized_query?: string | null
          openalex_count?: number | null
          pubmed_count?: number | null
          question?: string
          results?: Json | null
          semantic_scholar_count?: number | null
          status?: string
          total_papers_searched?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_reports_active_column_set_id_fkey"
            columns: ["active_column_set_id"]
            isOneToOne: false
            referencedRelation: "extraction_column_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_reports_active_extraction_run_id_fkey"
            columns: ["active_extraction_run_id"]
            isOneToOne: false
            referencedRelation: "extraction_runs"
            referencedColumns: ["id"]
          },
        ]
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
      [_ in never]: never
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
